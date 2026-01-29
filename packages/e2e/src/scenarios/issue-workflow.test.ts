/**
 * E2E Test: Issue Workflow
 *
 * Tests the full issue lifecycle using direct tool calls (no Claude API).
 * Verifies: create issue → generate plan → work tasks → complete
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DirectToolExecutor } from "../harness/direct-executor.js";

describe("E2E: Issue Workflow", () => {
  let executor: DirectToolExecutor;
  let testPassed = false;

  beforeAll(async () => {
    executor = await DirectToolExecutor.create({
      keepOnSuccess: false,
    });
  }, 60000);

  afterAll(async () => {
    await executor?.dispose(testPassed);
  });

  it("should complete a full issue workflow: create → plan → ready → close", async () => {
    // 1. Create an issue
    const createResult = await executor.createIssue({
      title: "Add user authentication",
      description: "Implement JWT-based authentication for the API",
      type: "FEATURE",
      priority: "HIGH",
      acceptance_criteria: [
        "Users can register with email/password",
        "Users can login and receive JWT token",
        "Protected routes require valid token",
      ],
    });

    if (!createResult.success) {
      console.error("Create issue failed:", createResult.error, createResult.raw);
    }
    expect(createResult.success).toBe(true);
    expect(createResult.data).toBeDefined();

    const issue = createResult.data as { issue: { number: number; id: string; status: string } };
    expect(issue.issue.number).toBe(1);
    expect(issue.issue.status).toBe("PLANNED");

    // 2. Generate a plan with tasks
    const planResult = await executor.generatePlan({
      issue_number: 1,
      summary: "Implement JWT-based user authentication",
      approach: "Create user model, registration, and login endpoints",
      tasks: [
        {
          id: "db",
          title: "Create User model and migration",
          description: "Set up database schema for users table",
          type: "TASK",
          acceptanceCriteria: ["User table with id, email, password_hash fields"],
        },
        {
          id: "register",
          title: "Implement registration endpoint",
          description: "POST /api/auth/register endpoint",
          type: "TASK",
          acceptanceCriteria: ["Validates email format", "Hashes password before storing"],
        },
        {
          id: "login",
          title: "Implement login endpoint",
          description: "POST /api/auth/login endpoint",
          type: "TASK",
          acceptanceCriteria: ["Returns JWT on success", "Returns 401 on invalid credentials"],
        },
      ],
    });

    if (!planResult.success) {
      console.error("Generate plan failed:", planResult.error, planResult.raw);
    }
    expect(planResult.success).toBe(true);
    // generatePlan returns { plan: {...}, tasks: [...], url } not { plan: { tasks: [...] } }
    const planData = planResult.data as {
      plan: { id: string };
      tasks: Array<{ id: string; title: string }>;
    };
    expect(planData.tasks).toHaveLength(3);

    // 3. Activate the issue by moving to backlog (PLANNED → OPEN)
    const backlogResult = await executor.moveIssueToBacklog({ issue_number: 1 });
    if (!backlogResult.success) {
      console.error("Move to backlog failed:", backlogResult.error, backlogResult.raw);
    }
    expect(backlogResult.success).toBe(true);

    // 4. Verify issue moved to OPEN
    const issueAfterPlan = await executor.getIssue({ issue_number: 1 });
    expect(issueAfterPlan.success).toBe(true);
    // getIssue returns issue properties directly, not wrapped in { issue: {...} }
    const issueData = issueAfterPlan.data as { status: string };
    expect(issueData.status).toBe("OPEN");

    // 5. Move to ready (activates the issue)
    const readyResult = await executor.moveIssueToReady({ issue_number: 1 });
    expect(readyResult.success).toBe(true);

    // 6. Verify tasks are available
    const tasksResult = await executor.listAvailableTasks();
    expect(tasksResult.success).toBe(true);
    const tasks = tasksResult.data as { tasks: Array<{ id: string; status: string }> };
    expect(tasks.tasks.length).toBeGreaterThan(0);

    // 7. Close the issue (force=true to abandon incomplete tasks - this is a test)
    const closeResult = await executor.closeIssue({ issue_number: 1, force: true });
    if (!closeResult.success) {
      console.error("Close issue failed:", closeResult.error, closeResult.raw);
    }
    expect(closeResult.success).toBe(true);

    // 8. Verify final state in database
    const db = executor.getDatabase();
    try {
      const finalIssue = db.prepare("SELECT status FROM issues WHERE number = ?").get(1) as {
        status: string;
      };
      expect(finalIssue.status).toBe("CLOSED");

      // All tasks should be abandoned when issue is closed
      const taskStatuses = db
        .prepare(
          "SELECT status FROM tasks WHERE plan_id IN (SELECT id FROM plans WHERE issue_id = (SELECT id FROM issues WHERE number = 1))"
        )
        .all() as Array<{ status: string }>;

      for (const task of taskStatuses) {
        expect(["COMPLETED", "ABANDONED"]).toContain(task.status);
      }
    } finally {
      db.close();
    }

    testPassed = true;
  }, 30000);
});

describe("E2E: Issue CRUD", () => {
  let executor: DirectToolExecutor;
  let testPassed = false;

  beforeAll(async () => {
    executor = await DirectToolExecutor.create({
      keepOnSuccess: false,
    });
  }, 60000);

  afterAll(async () => {
    await executor?.dispose(testPassed);
  });

  it("should create, update, and delete an issue", async () => {
    // Create
    const createResult = await executor.createIssue({
      title: "Original title",
      description: "Original description",
    });
    if (!createResult.success) {
      console.error("Create issue failed:", createResult.error, createResult.raw);
    }
    expect(createResult.success).toBe(true);

    // Update
    const updateResult = await executor.updateIssue({
      issue_number: 1,
      title: "Updated title",
      description: "Updated description",
      priority: "HIGH",
    });
    if (!updateResult.success) {
      console.error("Update issue failed:", updateResult.error, updateResult.raw);
    }
    expect(updateResult.success).toBe(true);

    // Verify update
    const getResult = await executor.getIssue({ issue_number: 1 });
    expect(getResult.success).toBe(true);
    // getIssue returns issue properties directly, not wrapped in { issue: {...} }
    const issue = getResult.data as { title: string; description: string; priority: string };
    expect(issue.title).toBe("Updated title");
    expect(issue.description).toBe("Updated description");
    expect(issue.priority).toBe("HIGH");

    // Delete (soft delete)
    const deleteResult = await executor.deleteIssue({ issue_number: 1 });
    expect(deleteResult.success).toBe(true);

    // Verify deleted - getIssue excludes soft-deleted issues by default
    const afterDelete = await executor.getIssue({ issue_number: 1 });
    // Soft deleted issues are excluded by default, so getIssue should fail
    expect(afterDelete.success).toBe(false);
    expect(afterDelete.error).toContain("not found");

    // Verify in database directly - use snake_case column names
    const db = executor.getDatabase();
    try {
      const deletedIssue = db
        .prepare("SELECT is_deleted, deleted_at FROM issues WHERE number = ?")
        .get(1) as { is_deleted: number; deleted_at: string | null };
      expect(deletedIssue.is_deleted).toBe(1);
      expect(deletedIssue.deleted_at).not.toBeNull();
    } finally {
      db.close();
    }

    testPassed = true;
  }, 30000);
});

describe("E2E: Multiple Issues", () => {
  let executor: DirectToolExecutor;
  let testPassed = false;

  beforeAll(async () => {
    executor = await DirectToolExecutor.create({
      keepOnSuccess: false,
    });
  }, 60000);

  afterAll(async () => {
    await executor?.dispose(testPassed);
  });

  it("should handle multiple issues with correct numbering", async () => {
    // Create multiple issues
    const issue1 = await executor.createIssue({
      title: "First issue",
      description: "Description 1",
    });
    if (!issue1.success) {
      console.error("Create issue 1 failed:", issue1.error, issue1.raw);
    }
    expect(issue1.success).toBe(true);
    expect((issue1.data as { issue: { number: number } }).issue.number).toBe(1);

    const issue2 = await executor.createIssue({
      title: "Second issue",
      description: "Description 2",
    });
    expect(issue2.success).toBe(true);
    expect((issue2.data as { issue: { number: number } }).issue.number).toBe(2);

    const issue3 = await executor.createIssue({
      title: "Third issue",
      description: "Description 3",
    });
    expect(issue3.success).toBe(true);
    expect((issue3.data as { issue: { number: number } }).issue.number).toBe(3);

    // Search for issues (search by title keyword)
    const searchResult = await executor.searchIssues({ query: "issue" });
    if (!searchResult.success) {
      console.error("Search issues failed:", searchResult.error, searchResult.raw);
    }
    expect(searchResult.success).toBe(true);
    // searchIssues returns { results: [...] } not { issues: [...] }
    const searchData = searchResult.data as { results: Array<{ number: number }> };
    expect(searchData.results.length).toBe(3);

    testPassed = true;
  }, 30000);
});
