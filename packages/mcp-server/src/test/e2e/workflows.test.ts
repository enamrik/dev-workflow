/**
 * E2E Workflow Tests
 *
 * These tests run actual Claude CLI commands against an isolated test environment.
 * They verify that agent actions produce expected outcomes by checking database state.
 *
 * IMPORTANT:
 * - These tests are slow (use real AI)
 * - These tests cost money (API calls)
 * - Run with: pnpm test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { E2ETestHarness } from "./test-harness.js";
import { runClaude, isClaudeAvailable } from "./claude-runner.js";

describe("E2E: Full Workflow", () => {
  let harness: E2ETestHarness;
  let testPassed = false;
  let claudeAvailable = false;

  beforeAll(async () => {
    // Check if claude CLI is available
    claudeAvailable = await isClaudeAvailable();
    if (!claudeAvailable) {
      console.log("⚠️ Claude CLI not available, E2E tests will be skipped");
      return;
    }

    harness = new E2ETestHarness({ useLocalBuild: true });
    await harness.setup();
  }, 180000); // 3 min for setup

  afterAll(() => {
    if (harness) {
      harness.cleanup(testPassed);
    }
  });

  it("should create an issue via MCP tool", async () => {
    if (!claudeAvailable) {
      console.log("Skipping: Claude CLI not available");
      return;
    }

    // Run agent to create issue
    const result = await runClaude(
      "Create an issue titled 'Add user authentication' with description 'Implement OAuth2 login flow'. Use the create_issue tool.",
      {
        cwd: harness.testDir,
        allowedTools: ["mcp__dev-workflow-tracker__create_issue"],
        timeout: 60000,
      }
    );

    expect(result.exitCode).toBe(0);

    // Verify issue in database
    const db = new Database(harness.dbPath);
    try {
      const issues = db.prepare("SELECT * FROM issues").all() as Array<{
        id: string;
        number: number;
        title: string;
        description: string;
        status: string;
      }>;

      expect(issues.length).toBeGreaterThanOrEqual(1);

      const latestIssue = issues[issues.length - 1];
      expect(latestIssue).toBeDefined();
      expect(latestIssue.title.toLowerCase()).toContain("authentication");
      expect(latestIssue.status).toBe("OPEN");

      console.log(`✓ Created issue #${latestIssue.number}: ${latestIssue.title}`);
    } finally {
      db.close();
    }

    testPassed = true;
  }, 120000);

  it("should generate a plan for an issue", async () => {
    if (!claudeAvailable) {
      console.log("Skipping: Claude CLI not available");
      return;
    }

    // First, get the issue number
    const db = new Database(harness.dbPath);
    let issueNumber: number;
    try {
      const issues = db.prepare("SELECT * FROM issues ORDER BY number DESC LIMIT 1").all() as Array<{
        id: string;
        number: number;
      }>;

      if (issues.length === 0) {
        // Create an issue first
        const createResult = await runClaude(
          "Create an issue titled 'Test feature' with description 'A test feature to plan'",
          {
            cwd: harness.testDir,
            allowedTools: ["mcp__dev-workflow-tracker__create_issue"],
            timeout: 60000,
          }
        );
        expect(createResult.exitCode).toBe(0);

        const newIssues = db.prepare("SELECT * FROM issues ORDER BY number DESC LIMIT 1").all() as Array<{
          number: number;
        }>;
        issueNumber = newIssues[0]?.number ?? 1;
      } else {
        issueNumber = issues[0]?.number ?? 1;
      }
    } finally {
      db.close();
    }

    // Run agent to generate plan
    const result = await runClaude(
      `Generate an implementation plan for issue #${issueNumber} with 3 tasks. Use the generate_plan tool.`,
      {
        cwd: harness.testDir,
        allowedTools: ["mcp__dev-workflow-tracker__generate_plan"],
        timeout: 90000,
      }
    );

    expect(result.exitCode).toBe(0);

    // Verify plan and tasks in database
    const db2 = new Database(harness.dbPath);
    try {
      const plans = db2.prepare("SELECT * FROM plans").all() as Array<{
        id: string;
        issue_id: string;
        summary: string;
      }>;

      expect(plans.length).toBeGreaterThanOrEqual(1);

      const latestPlan = plans[plans.length - 1];
      expect(latestPlan).toBeDefined();

      const tasks = db2
        .prepare("SELECT * FROM tasks WHERE plan_id = ?")
        .all(latestPlan.id) as Array<{
          id: string;
          title: string;
          status: string;
        }>;

      expect(tasks.length).toBeGreaterThanOrEqual(1);
      console.log(`✓ Created plan with ${tasks.length} tasks`);

      // All tasks should start as PENDING
      for (const task of tasks) {
        expect(task.status).toBe("PENDING");
      }
    } finally {
      db2.close();
    }

    testPassed = true;
  }, 120000);

  it("should list issues", async () => {
    if (!claudeAvailable) {
      console.log("Skipping: Claude CLI not available");
      return;
    }

    const result = await runClaude(
      "List all open issues using the list_issues tool",
      {
        cwd: harness.testDir,
        allowedTools: ["mcp__dev-workflow-tracker__list_issues"],
        timeout: 60000,
      }
    );

    expect(result.exitCode).toBe(0);
    // The response should mention the issues we created
    expect(
      result.stdout.toLowerCase().includes("issue") ||
      result.stdout.toLowerCase().includes("authentication") ||
      result.stdout.toLowerCase().includes("#1")
    ).toBe(true);

    testPassed = true;
  }, 120000);

  it("should update task status", async () => {
    if (!claudeAvailable) {
      console.log("Skipping: Claude CLI not available");
      return;
    }

    // Get a task ID
    const db = new Database(harness.dbPath);
    let taskId: string | undefined;
    try {
      const tasks = db.prepare("SELECT * FROM tasks WHERE status = 'PENDING' LIMIT 1").all() as Array<{
        id: string;
        title: string;
      }>;

      if (tasks.length === 0) {
        console.log("⚠️ No pending tasks found, skipping test");
        testPassed = true;
        return;
      }

      taskId = tasks[0]?.id;
    } finally {
      db.close();
    }

    if (!taskId) {
      console.log("⚠️ No task ID found, skipping test");
      testPassed = true;
      return;
    }

    // Update task status
    const result = await runClaude(
      `Update task ${taskId} status to IN_PROGRESS using the update_task_status tool`,
      {
        cwd: harness.testDir,
        allowedTools: ["mcp__dev-workflow-tracker__update_task_status"],
        timeout: 60000,
      }
    );

    expect(result.exitCode).toBe(0);

    // Verify task status changed
    const db2 = new Database(harness.dbPath);
    try {
      const task = db2.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as {
        id: string;
        status: string;
      } | undefined;

      expect(task).toBeDefined();
      expect(task?.status).toBe("IN_PROGRESS");
      console.log(`✓ Task status updated to IN_PROGRESS`);
    } finally {
      db2.close();
    }

    testPassed = true;
  }, 120000);
});

describe("E2E: Error Handling", () => {
  let harness: E2ETestHarness;
  let testPassed = false;
  let claudeAvailable = false;

  beforeAll(async () => {
    claudeAvailable = await isClaudeAvailable();
    if (!claudeAvailable) {
      return;
    }

    harness = new E2ETestHarness({ useLocalBuild: true });
    await harness.setup();
  }, 180000);

  afterAll(() => {
    if (harness) {
      harness.cleanup(testPassed);
    }
  });

  it("should handle getting non-existent issue gracefully", async () => {
    if (!claudeAvailable) {
      console.log("Skipping: Claude CLI not available");
      return;
    }

    const result = await runClaude(
      "Get issue #99999 using the get_issue tool",
      {
        cwd: harness.testDir,
        allowedTools: ["mcp__dev-workflow-tracker__get_issue"],
        timeout: 60000,
      }
    );

    // Should complete without crashing
    expect(result.exitCode).toBe(0);
    // Response should indicate issue not found
    expect(
      result.stdout.toLowerCase().includes("not found") ||
      result.stdout.toLowerCase().includes("doesn't exist") ||
      result.stdout.toLowerCase().includes("no issue")
    ).toBe(true);

    testPassed = true;
  }, 120000);
});
