/**
 * Tests for Task Transition Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { EntityNotFoundError, BusinessRuleError } from "@dev-workflow/tracking";
import { buildTestContainer, createTestRequest, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "../route";

describe("transitionTaskEndpoint", () => {
  it("transitions task successfully", async () => {
    const mockResult = {
      task: {
        id: "task-1",
        number: 1,
        title: "Task One",
        status: "READY",
      },
      previousStatus: "BACKLOG",
    };

    const testContainer = buildTestContainer({
      taskAppService: {
        transitionTask: vi.fn().mockResolvedValue(mockResult),
      },
    });

    const req = createTestRequest("POST", "/api/tasks/task-1/transition", {
      body: { targetStatus: "READY", projectSlug: "my-project" },
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      taskId: "task-1",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.success).toBe(true);
    expect(body.task.status).toBe("READY");
    expect(body.task.previousStatus).toBe("BACKLOG");

    const service = testContainer.resolve("taskAppService") as any;
    expect(service.transitionTask).toHaveBeenCalledWith("my-project", "task-1", "READY");
  });

  it("returns 404 when task not found", async () => {
    const testContainer = buildTestContainer({
      taskAppService: {
        transitionTask: vi.fn().mockRejectedValue(new EntityNotFoundError("Task", "not-found")),
      },
    });

    const req = createTestRequest("POST", "/api/tasks/not-found/transition", {
      body: { targetStatus: "READY", projectSlug: "my-project" },
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      taskId: "not-found",
    });

    expect(result.status).toBe(404);
  });

  it("returns 422 for invalid transition", async () => {
    const testContainer = buildTestContainer({
      taskAppService: {
        transitionTask: vi
          .fn()
          .mockRejectedValue(new BusinessRuleError("Invalid transition from COMPLETED to READY")),
      },
    });

    const req = createTestRequest("POST", "/api/tasks/task-1/transition", {
      body: { targetStatus: "READY", projectSlug: "my-project" },
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      taskId: "task-1",
    });

    expect(result.status).toBe(422);
  });

  it("returns 400 when projectSlug is missing", async () => {
    const testContainer = buildTestContainer({
      taskAppService: {
        transitionTask: vi.fn(),
      },
    });

    const req = createTestRequest("POST", "/api/tasks/task-1/transition", {
      body: { targetStatus: "READY" },
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      taskId: "task-1",
    });

    expect(result.status).toBe(400);
  });
});
