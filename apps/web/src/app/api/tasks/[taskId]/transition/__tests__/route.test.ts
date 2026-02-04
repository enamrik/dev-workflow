/**
 * Tests for Task Transition Endpoint
 */

import { describe, it, expect } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { createTestContainer, createTestRequest, runTestEndpoint } from "@/lib/di/test-utils";
import { EntityNotFoundError, BusinessRuleError, Task } from "@dev-workflow/tracking";
import { endpoint } from "../endpoint";

describe("transitionTaskEndpoint", () => {
  it("transitions task successfully", async () => {
    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            tasks: {
              transitionTo: () =>
                Effect.succeed({
                  task: Task.from({
                    id: "task-1",
                    number: 1,
                    title: "Task One",
                    status: "READY",
                  } as Task),
                  previousStatus: "BACKLOG",
                }),
            },
          }),
      },
    });

    const req = createTestRequest("POST", "/api/tasks/task-1/transition", {
      body: { targetStatus: "READY", projectSlug: "my-project" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      taskId: "task-1",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.task.status).toBe("READY");
    expect(body.previousStatus).toBe("BACKLOG");
  });

  it("returns 404 when task not found", async () => {
    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            tasks: {
              transitionTo: () => Effect.fail(new EntityNotFoundError("Task", "not-found")),
            },
          }),
      },
    });

    const req = createTestRequest("POST", "/api/tasks/not-found/transition", {
      body: { targetStatus: "READY", projectSlug: "my-project" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      taskId: "not-found",
    });

    expect(result.status).toBe(404);
  });

  it("returns 422 for invalid transition", async () => {
    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            tasks: {
              transitionTo: () =>
                Effect.fail(new BusinessRuleError("Cannot transition from COMPLETED to READY")),
            },
          }),
      },
    });

    const req = createTestRequest("POST", "/api/tasks/task-1/transition", {
      body: { targetStatus: "READY", projectSlug: "my-project" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      taskId: "task-1",
    });

    expect(result.status).toBe(422);
  });

  it("returns 400 when projectSlug is missing", async () => {
    const testContainer = createTestContainer({});

    const req = createTestRequest("POST", "/api/tasks/task-1/transition", {
      body: { targetStatus: "READY" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      taskId: "task-1",
    });

    expect(result.status).toBe(400);
  });
});
