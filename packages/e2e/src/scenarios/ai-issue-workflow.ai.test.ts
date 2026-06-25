/**
 * AI-Driven E2E Test: Issue Workflow
 *
 * Tests the full issue lifecycle using Claude CLI with natural language prompts.
 * Verifies: create issue → generate plan → database state
 *
 * These tests invoke the real Claude CLI and cost money (~$0.10-0.30 per test).
 * Run with: pnpm --filter @dev-workflow/e2e test:ai
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { E2ETestHarness } from "../harness/test-harness.js";
import { ClaudeRunner, isClaudeAvailable } from "../harness/claude-runner.js";

describe("AI E2E: Issue Workflow", () => {
  let harness: E2ETestHarness;
  let runner: ClaudeRunner;
  let testPassed = false;

  beforeAll(async () => {
    // Check if Claude CLI is available
    const available = await isClaudeAvailable();
    if (!available) {
      console.log("⚠️ Claude CLI not available, skipping AI tests");
      return;
    }

    harness = new E2ETestHarness({
      keepOnSuccess: false,
    });
    await harness.setup();
    runner = new ClaudeRunner(harness);
  }, 120000); // 2 min setup timeout

  afterAll(async () => {
    harness?.cleanup(testPassed);
  });

  it("should create and plan an issue via natural language", async () => {
    if (!runner) {
      console.log("⚠️ Skipping test - Claude CLI not available");
      return;
    }

    // Run Claude with a natural language prompt
    const result = await runner.run(
      `Create an issue to add user authentication to the API.

The feature should:
- Allow users to register with email/password
- Allow users to login and receive a token
- Protect API routes with authentication

After creating the issue, generate an implementation plan with tasks.
Do NOT start working on tasks - just create the issue and plan.`,
      {
        model: "sonnet",
        maxBudgetUsd: 1.0,
        timeout: 300000, // 5 minutes
      }
    );

    console.log("\n📋 Claude output:", result.stdout.slice(0, 500), "...\n");

    expect(result.success).toBe(true);

    // Verify database state
    const db = harness.getDb();
    try {
      // Check issue was created
      const issue = db
        .prepare("SELECT * FROM issues WHERE project_id = ? AND number = 1")
        .get(harness.databaseProjectId) as
        | {
            id: string;
            title: string;
            status: string;
            description: string;
          }
        | undefined;

      expect(issue).toBeDefined();
      expect(issue!.status).toBe("PLANNED");
      expect(issue!.title.toLowerCase()).toContain("auth");

      // Check plan was generated
      const plan = db.prepare("SELECT * FROM plans WHERE issue_id = ?").get(issue!.id) as
        | { id: string; summary: string }
        | undefined;

      expect(plan).toBeDefined();
      expect(plan!.summary).toBeTruthy();

      // Check tasks were created
      const tasks = db.prepare("SELECT * FROM tasks WHERE plan_id = ?").all(plan!.id) as Array<{
        id: string;
        title: string;
        status: string;
      }>;

      expect(tasks.length).toBeGreaterThan(0);
      console.log(`✅ Created issue #1 with ${tasks.length} tasks`);

      // All tasks should be in PLANNED status
      for (const task of tasks) {
        expect(task.status).toBe("PLANNED");
      }
    } finally {
      db.close();
    }

    testPassed = true;
  }, 360000); // 6 min test timeout
});

describe("AI E2E: Search and Query", () => {
  let harness: E2ETestHarness;
  let runner: ClaudeRunner;
  let testPassed = false;

  beforeAll(async () => {
    const available = await isClaudeAvailable();
    if (!available) {
      console.log("⚠️ Claude CLI not available, skipping AI tests");
      return;
    }

    harness = new E2ETestHarness({
      keepOnSuccess: false,
    });
    await harness.setup();
    runner = new ClaudeRunner(harness);

    // Pre-create some issues for searching
    const db = harness.getDb();
    try {
      // Insert test issues directly
      const now = new Date().toISOString();
      db.prepare(
        `
        INSERT INTO issues (id, project_id, number, title, description, type, status, priority, created_at, updated_at)
        VALUES (?, ?, 1, 'Add login page', 'Create a login form', 'FEATURE', 'PLANNED', 'MEDIUM', ?, ?)
      `
      ).run(crypto.randomUUID(), harness.databaseProjectId, now, now);

      db.prepare(
        `
        INSERT INTO issues (id, project_id, number, title, description, type, status, priority, created_at, updated_at)
        VALUES (?, ?, 2, 'Fix logout bug', 'Users are not being logged out', 'BUG', 'PLANNED', 'HIGH', ?, ?)
      `
      ).run(crypto.randomUUID(), harness.databaseProjectId, now, now);

      db.prepare(
        `
        INSERT INTO issues (id, project_id, number, title, description, type, status, priority, created_at, updated_at)
        VALUES (?, ?, 3, 'Add password reset', 'Allow users to reset password', 'FEATURE', 'PLANNED', 'LOW', ?, ?)
      `
      ).run(crypto.randomUUID(), harness.databaseProjectId, now, now);
    } finally {
      db.close();
    }
  }, 120000);

  afterAll(async () => {
    harness?.cleanup(testPassed);
  });

  it("should search for issues via natural language", async () => {
    if (!runner) {
      console.log("⚠️ Skipping test - Claude CLI not available");
      return;
    }

    const result = await runner.run(
      `Search for issues related to "login". Tell me what you find.`,
      {
        model: "sonnet",
        maxBudgetUsd: 0.5,
        timeout: 120000,
      }
    );

    console.log("\n📋 Claude output:", result.stdout.slice(0, 500), "...\n");

    expect(result.success).toBe(true);

    // Output should mention the login-related issues
    const output = result.stdout.toLowerCase();
    expect(output).toMatch(/login|#1|#2/);

    testPassed = true;
  }, 180000);
});
