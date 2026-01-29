/**
 * E2E Test: Task Completion Flow
 *
 * Tests the task lifecycle using direct tool calls (no Claude API).
 * Verifies: load_task_session → complete_task flow
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DirectToolExecutor } from "../harness/direct-executor.js";
import { randomUUID } from "node:crypto";

describe("E2E: Task Completion", () => {
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

  it("should complete a task through load_task_session → complete_task flow", async () => {
    // 1. Create an issue
    const createResult = await executor.createIssue({
      title: "Test task completion",
      description: "Test the task completion flow",
      type: "TASK",
      priority: "MEDIUM",
    });

    expect(createResult.success).toBe(true);
    const issue = createResult.data as { issue: { number: number; id: string } };
    expect(issue.issue.number).toBe(1);

    // 2. Generate a plan with a single task
    const planResult = await executor.generatePlan({
      issue_number: 1,
      summary: "Test task completion",
      approach: "Complete a single task to verify the flow",
      tasks: [
        {
          id: "task-1",
          title: "Single test task",
          description: "A task to test completion flow",
          type: "TASK",
          acceptanceCriteria: ["Task completes successfully"],
        },
      ],
    });

    expect(planResult.success).toBe(true);
    const planData = planResult.data as {
      plan: { id: string };
      tasks: Array<{ id: string; title: string }>;
    };
    expect(planData.tasks).toHaveLength(1);
    const taskId = planData.tasks[0]!.id;

    // 3. Move issue to backlog (activates tasks from PLANNED → BACKLOG)
    const backlogResult = await executor.moveIssueToBacklog({ issue_number: 1 });
    expect(backlogResult.success).toBe(true);

    // 4. Move to ready (BACKLOG → READY)
    const readyResult = await executor.moveIssueToReady({ issue_number: 1 });
    expect(readyResult.success).toBe(true);

    // 5. Verify task is in READY status
    const taskBeforeResult = await executor.getTask({ task_id: taskId });
    expect(taskBeforeResult.success).toBe(true);
    const taskBefore = taskBeforeResult.data as { status: string };
    expect(taskBefore.status).toBe("READY");

    // 6. Load task session (starts work on task)
    const sessionId = randomUUID();
    const loadResult = await executor.loadTaskSession({
      task_id: taskId,
      session_id: sessionId,
      mode: "main", // Use main mode for simplicity (no worktree/PR)
    });

    if (!loadResult.success) {
      console.error("Load task session failed:", loadResult.error, loadResult.raw);
    }
    expect(loadResult.success).toBe(true);

    // 7. Verify task moved to IN_PROGRESS
    const taskDuringResult = await executor.getTask({ task_id: taskId });
    expect(taskDuringResult.success).toBe(true);
    const taskDuring = taskDuringResult.data as { status: string };
    expect(taskDuring.status).toBe("IN_PROGRESS");

    // 8. Complete the task
    const completeResult = await executor.completeTask({
      task_id: taskId,
      session_id: sessionId,
      final_log_entry: "Task completed successfully in test",
      force: true, // Use force since we're in main mode without a PR
    });

    if (!completeResult.success) {
      console.error("Complete task failed:", completeResult.error, completeResult.raw);
    }
    expect(completeResult.success).toBe(true);

    // 9. Verify task is COMPLETED
    const taskAfterResult = await executor.getTask({ task_id: taskId });
    expect(taskAfterResult.success).toBe(true);
    const taskAfter = taskAfterResult.data as { status: string; completedAt: string | null };
    expect(taskAfter.status).toBe("COMPLETED");
    expect(taskAfter.completedAt).not.toBeNull();

    // 10. Verify database state
    const db = executor.getDatabase();
    try {
      const dbTask = db
        .prepare("SELECT status, completed_at FROM tasks WHERE id = ?")
        .get(taskId) as { status: string; completed_at: string | null };
      expect(dbTask.status).toBe("COMPLETED");
      expect(dbTask.completed_at).not.toBeNull();

      // Verify execution log was created
      const logEntry = db
        .prepare(
          "SELECT message FROM task_execution_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1"
        )
        .get(taskId) as { message: string } | undefined;
      expect(logEntry).toBeDefined();
      expect(logEntry?.message).toContain("Task completed successfully in test");
    } finally {
      db.close();
    }

    testPassed = true;
  }, 30000);

  it("should abandon a task with reason", async () => {
    // 1. Create an issue
    const createResult = await executor.createIssue({
      title: "Test task abandonment",
      description: "Test the task abandonment flow",
    });

    expect(createResult.success).toBe(true);

    // 2. Generate a plan
    const planResult = await executor.generatePlan({
      issue_number: 2,
      summary: "Test task abandonment",
      approach: "Create a task to abandon",
      tasks: [
        {
          id: "abandon-task",
          title: "Task to abandon",
          description: "This task will be abandoned",
          type: "TASK",
        },
      ],
    });

    expect(planResult.success).toBe(true);
    const planData = planResult.data as { tasks: Array<{ id: string }> };
    const taskId = planData.tasks[0]!.id;

    // 3. Activate the task
    await executor.moveIssueToBacklog({ issue_number: 2 });
    await executor.moveIssueToReady({ issue_number: 2 });

    // 4. Load task session
    const sessionId = randomUUID();
    const loadResult = await executor.loadTaskSession({
      task_id: taskId,
      session_id: sessionId,
      mode: "main",
    });
    expect(loadResult.success).toBe(true);

    // 5. Abandon the task
    const abandonResult = await executor.abandonTask({
      task_id: taskId,
      session_id: sessionId,
      reason: "Test abandonment reason",
    });

    if (!abandonResult.success) {
      console.error("Abandon task failed:", abandonResult.error, abandonResult.raw);
    }
    expect(abandonResult.success).toBe(true);

    // 6. Verify task is ABANDONED
    const taskAfterResult = await executor.getTask({ task_id: taskId });
    expect(taskAfterResult.success).toBe(true);
    const taskAfter = taskAfterResult.data as { status: string };
    expect(taskAfter.status).toBe("ABANDONED");

    // 7. Verify in database
    const db = executor.getDatabase();
    try {
      const dbTask = db
        .prepare("SELECT status, abandoned_at FROM tasks WHERE id = ?")
        .get(taskId) as { status: string; abandoned_at: string | null };
      expect(dbTask.status).toBe("ABANDONED");
      expect(dbTask.abandoned_at).not.toBeNull();
    } finally {
      db.close();
    }

    testPassed = true;
  }, 30000);
});
