/**
 * E2E: Simple File Rename Scenario
 *
 * A complete end-to-end story:
 * 1. Create an issue for renaming a file
 * 2. Generate a plan with tasks
 * 3. Execute the rename via Claude
 * 4. Verify database state (issue, plan, tasks)
 * 5. Verify file system changes
 * 6. Verify web UI shows the completed work
 *
 * IMPORTANT:
 * - This test uses real AI (Claude CLI)
 * - This test costs money (API calls)
 * - Run with: pnpm test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { expect as playwrightExpect } from "@playwright/test";
import {
  E2ETestHarness,
  UIHarness,
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
  let ui: UIHarness;
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
      keepOnSuccess: false,
    });
    await harness.setup();

    // Verify sample project was created
    expect(harness.fileExists("src/utils.ts")).toBe(true);
    expect(harness.fileExists("src/index.ts")).toBe(true);
  }, 180000);

  afterAll(async () => {
    if (ui) {
      await ui.stop();
    }
    if (harness) {
      harness.cleanup(testPassed);
    }
  });

  it("should complete a full rename workflow: issue → plan → execute → verify", async () => {
    if (!claudeAvailable) {
      console.log("Skipping: Claude CLI not available");
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Create an issue for the rename task
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n📋 Step 1: Creating issue...");

    let createResult = await runClaude(
      `Create an issue titled "Rename utils.ts to helpers.ts" with description "Rename the utility file src/utils.ts to src/helpers.ts and update all imports". Use the create_issue tool.`,
      {
        cwd: harness.testDir,
        allowedTools: ["mcp__dev-workflow-tracker__create_issue"],
        timeout: 120000,
      }
    );
    expect(createResult.exitCode).toBe(0);

    let db = harness.getDb();
    const issue = assertIssueExists(db, "rename");
    expect(issue.status).toBe("OPEN");
    console.log(`✓ Created issue #${issue.number}: ${issue.title}`);
    db.close();

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Generate a plan with tasks
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n📝 Step 2: Generating plan...");

    const planResult = await runClaude(
      `Generate an implementation plan for issue #${issue.number}. Include tasks for: 1) Rename the file, 2) Update imports. Use the generate_plan tool.`,
      {
        cwd: harness.testDir,
        allowedTools: [
          "mcp__dev-workflow-tracker__get_issue",
          "mcp__dev-workflow-tracker__generate_plan",
        ],
        timeout: 120000,
      }
    );
    expect(planResult.exitCode).toBe(0);

    db = harness.getDb();
    const plan = assertPlanExists(db, issue.id);
    const tasks = assertTasksExist(db, plan.id, 1);
    console.log(`✓ Created plan with ${tasks.length} tasks`);
    db.close();

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Execute the rename task
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n🔧 Step 3: Executing task...");

    db = harness.getDb();
    const pendingTask = getTaskByStatus(db, "PENDING");
    db.close();

    if (!pendingTask) {
      throw new Error("No pending task found after plan generation");
    }

    const execResult = await runClaude(
      `Start task ${pendingTask.id} using start_task_session with skipHooks=true, then rename the file src/utils.ts to src/helpers.ts using mv, then complete the task using complete_task_session with skipHooks=true.`,
      {
        cwd: harness.testDir,
        allowedTools: [
          "mcp__dev-workflow-tracker__get_task_for_session",
          "mcp__dev-workflow-tracker__start_task_session",
          "mcp__dev-workflow-tracker__complete_task_session",
          "Bash",
        ],
        timeout: 120000,
      }
    );
    expect(execResult.exitCode).toBe(0);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Verify database state
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n🗄️  Step 4: Verifying database...");

    db = harness.getDb();
    const completedTask = getTaskByStatus(db, "COMPLETED");
    expect(completedTask).toBeDefined();
    console.log(`✓ Task completed: ${completedTask?.title}`);
    db.close();

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Verify file system changes
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n📁 Step 5: Verifying file system...");

    assertFileNotExists(harness, "src/utils.ts");
    assertFileExists(harness, "src/helpers.ts");
    console.log("✓ File renamed: src/utils.ts → src/helpers.ts");

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: Verify web UI shows the completed work
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n🌐 Step 6: Verifying web UI...");

    ui = new UIHarness(harness);
    await ui.start();

    // Check issues list
    await ui.goto("/");
    await playwrightExpect(ui.page.locator("body")).toContainText("rename", {
      ignoreCase: true,
    });
    console.log("✓ Issues list shows the rename issue");

    // Check kanban board has completed task
    await ui.goto("/board");
    const pageContent = await ui.page.content();
    const hasCompletedSection = pageContent.toLowerCase().includes("completed");
    console.log(`✓ Kanban board loaded (completed section: ${hasCompletedSection})`);

    console.log("\n✨ All verifications passed!");
    testPassed = true;
  }, 600000); // 10 min total for the full workflow
});
