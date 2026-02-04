/**
 * Tests for Task Abandon Endpoint
 */

import { describe, it, expect } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { createTestContainer, createTestRequest, runTestEndpoint } from "@/lib/di/test-utils";
import { EntityNotFoundError, Task } from "@dev-workflow/tracking";
import { endpoint } from "../endpoint";
import { MockGitWorktreeService } from "@dev-workflow/git/worktrees/mock-git-worktree-service.js";

function createAbandonTestContainer(overrides: {
  taskDomainService: Record<string, unknown>;
  gitWorktreeService?: MockGitWorktreeService;
}) {
  return createTestContainer({
    taskDomainService: overrides.taskDomainService,
    gitWorktreeService: overrides.gitWorktreeService ?? new MockGitWorktreeService(),
  });
}

describe("abandonTaskEndpoint", () => {
  it("abandons task successfully", async () => {
    const testContainer = createAbandonTestContainer({
      taskDomainService: {
        getOrThrow: () =>
          Effect.succeed(
            Task.from({
              id: "task-1",
              number: 1,
              title: "Task One",
              status: "IN_PROGRESS",
            } as Task)
          ),
        abandon: () =>
          Effect.succeed(
            Task.from({
              id: "task-1",
              number: 1,
              title: "Task One",
              status: "ABANDONED",
            } as Task)
          ),
      },
    });

    const req = createTestRequest("POST", "/api/tasks/task-1/abandon", {
      body: { reason: "No longer needed" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      taskId: "task-1",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.task.status).toBe("ABANDONED");
    expect(body.previousStatus).toBe("IN_PROGRESS");
  });

  it("abandons task without reason", async () => {
    const testContainer = createAbandonTestContainer({
      taskDomainService: {
        getOrThrow: () =>
          Effect.succeed(
            Task.from({ id: "task-1", number: 1, title: "Task One", status: "READY" } as Task)
          ),
        abandon: () =>
          Effect.succeed(
            Task.from({
              id: "task-1",
              number: 1,
              title: "Task One",
              status: "ABANDONED",
            } as Task)
          ),
      },
    });

    const req = createTestRequest("POST", "/api/tasks/task-1/abandon", {
      body: {},
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      taskId: "task-1",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.task.status).toBe("ABANDONED");
  });

  it("returns 404 when task not found", async () => {
    const testContainer = createAbandonTestContainer({
      taskDomainService: {
        getOrThrow: () => Effect.fail(new EntityNotFoundError("Task", "not-found")),
      },
    });

    const req = createTestRequest("POST", "/api/tasks/not-found/abandon", {
      body: {},
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      taskId: "not-found",
    });

    expect(result.status).toBe(404);
  });

  it("returns 422 when task is in terminal state", async () => {
    const testContainer = createAbandonTestContainer({
      taskDomainService: {
        getOrThrow: () => Effect.succeed(Task.from({ id: "task-1", status: "COMPLETED" } as Task)),
      },
    });

    const req = createTestRequest("POST", "/api/tasks/task-1/abandon", {
      body: {},
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      taskId: "task-1",
    });

    expect(result.status).toBe(422);
  });
});
