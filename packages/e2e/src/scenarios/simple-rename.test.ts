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
        env: harness.getEnv() as Record<string, string>,
      }
    );
    expect(createResult.exitCode).toBe(0);

    let db = harness.getDb();
    const issue = assertIssueExists(db, "rename", harness.databaseProjectId);
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
        env: harness.getEnv() as Record<string, string>,
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
    const pendingTask = getTaskByStatus(db, "BACKLOG", plan.id);
    db.close();

    if (!pendingTask) {
      throw new Error("No BACKLOG task found after plan generation");
    }

    // Use "main" mode to work directly on main branch (no worktree/PR)
    const execResult = await runClaude(
      `Start task ${pendingTask.id} using start_task_session with mode "main", then rename the file src/utils.ts to src/helpers.ts using mv, then complete the task using complete_task_session.`,
      {
        cwd: harness.testDir,
        allowedTools: [
          "mcp__dev-workflow-tracker__get_task_for_session",
          "mcp__dev-workflow-tracker__start_task_session",
          "mcp__dev-workflow-tracker__complete_task_session",
          "Bash",
        ],
        timeout: 120000,
        env: harness.getEnv() as Record<string, string>,
      }
    );
    expect(execResult.exitCode).toBe(0);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Verify database state
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n🗄️  Step 4: Verifying database...");

    db = harness.getDb();
    const completedTask = getTaskByStatus(db, "COMPLETED", plan.id);
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
    console.log("\n🌐 Step 6: Verifying web UI pages...");

    ui = new UIHarness(harness);
    await ui.start();

    // 6a. Check task board (kanban) at /
    console.log("  6a. Checking task board (/)...");
    await ui.goto("/");
    await playwrightExpect(ui.page.locator("body")).toContainText("Task Board");
    await playwrightExpect(ui.page.locator("body")).toContainText("Done");
    console.log("  ✓ Task board shows Done column");

    // 6b. Check issues list at /issues
    console.log("  6b. Checking issues list (/issues)...");
    await ui.goto("/issues");
    await playwrightExpect(ui.page.locator("body")).toContainText("Issues");
    await playwrightExpect(ui.page.locator("body")).toContainText("rename", {
      ignoreCase: true,
    });
    console.log("  ✓ Issues list shows the rename issue");

    // 6c. Check milestones page at /milestones
    console.log("  6c. Checking milestones page (/milestones)...");
    await ui.goto("/milestones");
    await playwrightExpect(ui.page.locator("body")).toContainText("Milestones");
    console.log("  ✓ Milestones page loads correctly");

    // 6d. Verify the kanban board shows the completed task
    console.log("  6d. Checking kanban board for completed task...");
    await ui.goto("/");
    // Wait for the board to load and show completed tasks
    await playwrightExpect(ui.page.locator("body")).toContainText("Rename", {
      ignoreCase: true,
      timeout: 10000,
    });
    console.log("  ✓ Kanban board shows the rename task");

    console.log("\n✨ All verifications passed!");

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 7: Close the issue (required for nuke)
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n📋 Step 7: Closing issue...");

    const closeResult = await runClaude(
      `Close issue #${issue.number} using update_issue with status "CLOSED".`,
      {
        cwd: harness.testDir,
        allowedTools: ["mcp__dev-workflow-tracker__update_issue"],
        timeout: 60000,
        env: harness.getEnv() as Record<string, string>,
      }
    );
    expect(closeResult.exitCode).toBe(0);

    db = harness.getDb();
    const closedIssue = db
      .prepare("SELECT * FROM issues WHERE number = ? AND project_id = ?")
      .get(issue.number, harness.databaseProjectId) as { status: string };
    expect(closedIssue.status).toBe("CLOSED");
    console.log(`✓ Issue #${issue.number} closed`);
    db.close();

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 8: Archive the project
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n📦 Step 8: Archiving project...");

    const devWorkflowCmd = harness.getDevWorkflowCommand();
    const { execSync } = await import("node:child_process");

    execSync(`${devWorkflowCmd} archive`, {
      cwd: harness.testDir,
      stdio: "pipe",
      env: harness.getEnv() as Record<string, string>,
    });

    // Verify project is archived in database
    db = harness.getDb();
    const archivedProject = db
      .prepare("SELECT is_archived, archived_at FROM projects WHERE id = ?")
      .get(harness.databaseProjectId) as { is_archived: number; archived_at: string | null };
    db.close();

    expect(archivedProject.is_archived).toBe(1);
    expect(archivedProject.archived_at).not.toBeNull();
    console.log("✓ Project archived in database");

    // Verify skills were removed
    expect(harness.fileExists(".claude/skills/dwf-manage-issue")).toBe(false);
    console.log("✓ Skills removed");

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 9: Nuke the project (permanently delete)
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n💣 Step 9: Nuking project...");

    // Get project name from database for confirmation
    db = harness.getDb();
    const project = db
      .prepare("SELECT name FROM projects WHERE id = ?")
      .get(harness.databaseProjectId) as { name: string };
    const projectName = project.name;
    db.close();

    // Nuke requires typing project name to confirm - pipe it to stdin
    const { spawnSync } = await import("node:child_process");
    const nukeResult = spawnSync(devWorkflowCmd.split(" ")[0]!, [...devWorkflowCmd.split(" ").slice(1), "nuke"], {
      cwd: harness.testDir,
      input: projectName + "\n",
      encoding: "utf-8",
      env: harness.getEnv() as Record<string, string>,
    });

    expect(nukeResult.status).toBe(0);
    console.log("✓ Nuke command completed");

    // Verify project is deleted from database
    db = harness.getDb();
    const deletedProject = db
      .prepare("SELECT id FROM projects WHERE id = ?")
      .get(harness.databaseProjectId);
    const remainingIssues = db
      .prepare("SELECT COUNT(*) as count FROM issues WHERE project_id = ?")
      .get(harness.databaseProjectId) as { count: number };
    db.close();

    expect(deletedProject).toBeUndefined();
    expect(remainingIssues.count).toBe(0);
    console.log("✓ Project and all data deleted from database");

    // Verify track directory was removed
    const { existsSync } = await import("node:fs");
    expect(existsSync(harness.projectTrackDir)).toBe(false);
    console.log("✓ Track directory removed");

    console.log("\n✨ Archive and nuke verifications passed!");
    testPassed = true;
  }, 600000); // 10 min total for the full workflow
});
