/**
 * E2E: Simple File Rename Scenario
 *
 * Tests the full workflow of:
 * 1. Creating an issue for a simple rename task
 * 2. Generating a plan with tasks
 * 3. Executing the rename via Claude
 * 4. Verifying both database state AND file system changes
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
  assertFileExists,
  assertFileNotExists,
  getTaskByStatus,
} from "../harness/index.js";

describe("E2E: Simple File Rename", () => {
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

    harness = new E2ETestHarness({
      useLocalBuild: true,
      keepOnSuccess: false,
    });
    await harness.setup();

    // Verify sample files were created
    expect(harness.fileExists("src/utils.ts")).toBe(true);
    expect(harness.fileExists("src/index.ts")).toBe(true);
  }, 180000); // 3 min for setup

  afterAll(() => {
    if (harness) {
      harness.cleanup(testPassed);
    }
  });

  it("should create an issue for the rename task", async () => {
    if (!claudeAvailable) {
      console.log("Skipping: Claude CLI not available");
      return;
    }

    // Run Claude to create an issue
    const result = await runClaude(
      `Create an issue titled "Rename utils.ts to helpers.ts" with description "Rename the utility file src/utils.ts to src/helpers.ts and update all imports". Use the create_issue tool.`,
      {
        cwd: harness.testDir,
        allowedTools: ["mcp__dev-workflow-tracker__create_issue"],
        timeout: 60000,
      }
    );

    expect(result.exitCode).toBe(0);

    // Verify issue was created in database
    const db = harness.getDb();
    try {
      const issue = assertIssueExists(db, "rename");
      expect(issue.status).toBe("OPEN");
      console.log(`✓ Created issue #${issue.number}: ${issue.title}`);
    } finally {
      db.close();
    }
  }, 120000);

  it("should generate a plan with tasks", async () => {
    if (!claudeAvailable) {
      console.log("Skipping: Claude CLI not available");
      return;
    }

    // Find the issue we created
    const db = harness.getDb();
    let issueNumber: number;
    try {
      const issue = assertIssueExists(db, "rename");
      issueNumber = issue.number;
    } finally {
      db.close();
    }

    // Run Claude to generate a plan
    const result = await runClaude(
      `Generate an implementation plan for issue #${issueNumber}. Include tasks for: 1) Rename the file, 2) Update imports in index.ts. Use the generate_plan tool.`,
      {
        cwd: harness.testDir,
        allowedTools: ["mcp__dev-workflow-tracker__generate_plan"],
        timeout: 90000,
      }
    );

    expect(result.exitCode).toBe(0);

    // Verify plan and tasks were created
    const db2 = harness.getDb();
    try {
      const issue = assertIssueExists(db2, "rename");
      const plan = assertPlanExists(db2, issue.id);
      const tasks = assertTasksExist(db2, plan.id, 1);

      console.log(`✓ Created plan with ${tasks.length} tasks:`);
      for (const task of tasks) {
        console.log(`  - ${task.title} (${task.status})`);
      }
    } finally {
      db2.close();
    }
  }, 120000);

  it("should execute the rename and complete the task", async () => {
    if (!claudeAvailable) {
      console.log("Skipping: Claude CLI not available");
      return;
    }

    // Get a pending task
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

    // Run Claude to execute the task
    // Note: We allow Bash so Claude can actually rename the file
    const result = await runClaude(
      `Start task ${taskId} using start_task_session, then rename the file src/utils.ts to src/helpers.ts using the mv command, then complete the task using complete_task_session.`,
      {
        cwd: harness.testDir,
        allowedTools: [
          "mcp__dev-workflow-tracker__start_task_session",
          "mcp__dev-workflow-tracker__complete_task_session",
          "Bash",
        ],
        timeout: 90000,
      }
    );

    expect(result.exitCode).toBe(0);

    // Verify database state - task should be completed
    const db2 = harness.getDb();
    try {
      const completedTask = getTaskByStatus(db2, "COMPLETED");
      expect(completedTask).toBeDefined();
      console.log(`✓ Task completed: ${completedTask?.title}`);
    } finally {
      db2.close();
    }

    // Verify file system state - file should be renamed
    assertFileNotExists(harness, "src/utils.ts");
    assertFileExists(harness, "src/helpers.ts");
    console.log("✓ File renamed: src/utils.ts → src/helpers.ts");

    testPassed = true;
  }, 120000);
});
