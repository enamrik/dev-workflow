/**
 * E2E: MCP Tools Workflow Tests
 *
 * Tests the MCP tools via Claude CLI commands.
 * Migrated from packages/mcp-server/src/test/e2e/workflows.test.ts
 *
 * IMPORTANT:
 * - These tests use real AI (Claude CLI)
 * - These tests cost money (API calls)
 * - Run with: pnpm test
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  E2ETestHarness,
  runClaude,
  isClaudeAvailable,
  assertIssueExists,
  assertPlanExists,
  assertTasksExist,
  assertTaskStatus,
  getTaskByStatus,
} from "../harness/index.js";

describe("E2E: MCP Tools Workflow", () => {
  let harness: E2ETestHarness;
  let testPassed = false;
  let claudeAvailable = false;

  beforeAll(async () => {
    claudeAvailable = await isClaudeAvailable();
    if (!claudeAvailable) {
      console.log("⚠️ Claude CLI not available, E2E tests will be skipped");
      return;
    }

    harness = new E2ETestHarness({
      useLocalBuild: true,
      skipSampleProject: true, // Don't need sample project for these tests
    });
    await harness.setup();
  }, 180000);

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

    const result = await runClaude(
      "Create an issue titled 'Add user authentication' with description 'Implement OAuth2 login flow'. Use the create_issue tool.",
      {
        cwd: harness.testDir,
        allowedTools: ["mcp__dev-workflow-tracker__create_issue"],
        timeout: 60000,
      }
    );

    expect(result.exitCode).toBe(0);

    const db = harness.getDb();
    try {
      const issue = assertIssueExists(db, "authentication");
      expect(issue.status).toBe("OPEN");
      console.log(`✓ Created issue #${issue.number}: ${issue.title}`);
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

    // Find the latest issue
    const db = harness.getDb();
    let issueNumber: number;
    try {
      const issue = assertIssueExists(db, "authentication");
      issueNumber = issue.number;
    } finally {
      db.close();
    }

    const result = await runClaude(
      `Generate an implementation plan for issue #${issueNumber} with 3 tasks. Use the generate_plan tool.`,
      {
        cwd: harness.testDir,
        allowedTools: ["mcp__dev-workflow-tracker__generate_plan"],
        timeout: 90000,
      }
    );

    expect(result.exitCode).toBe(0);

    const db2 = harness.getDb();
    try {
      const issue = assertIssueExists(db2, "authentication");
      const plan = assertPlanExists(db2, issue.id);
      const tasks = assertTasksExist(db2, plan.id, 1);

      // All tasks should start as PENDING
      for (const task of tasks) {
        expect(task.status).toBe("PENDING");
      }
      console.log(`✓ Created plan with ${tasks.length} tasks`);
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
    expect(
      result.stdout.toLowerCase().includes("issue") ||
        result.stdout.toLowerCase().includes("authentication") ||
        result.stdout.toLowerCase().includes("#")
    ).toBe(true);

    testPassed = true;
  }, 120000);

  it("should update task status", async () => {
    if (!claudeAvailable) {
      console.log("Skipping: Claude CLI not available");
      return;
    }

    const db = harness.getDb();
    let taskId: string | undefined;
    try {
      const task = getTaskByStatus(db, "PENDING");
      if (!task) {
        console.log("⚠️ No pending tasks found, skipping test");
        testPassed = true;
        return;
      }
      taskId = task.id;
    } finally {
      db.close();
    }

    const result = await runClaude(
      `Update task ${taskId} status to IN_PROGRESS using the update_task_status tool`,
      {
        cwd: harness.testDir,
        allowedTools: ["mcp__dev-workflow-tracker__update_task_status"],
        timeout: 60000,
      }
    );

    expect(result.exitCode).toBe(0);

    const db2 = harness.getDb();
    try {
      assertTaskStatus(db2, taskId!, "IN_PROGRESS");
      console.log("✓ Task status updated to IN_PROGRESS");
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

    harness = new E2ETestHarness({
      useLocalBuild: true,
      skipSampleProject: true,
    });
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
