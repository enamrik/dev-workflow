/**
 * Tests for Task Abandon Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { EntityNotFoundError, BusinessRuleError } from "@dev-workflow/core";
import { buildTestContainer, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "./route";

describe("abandonTaskEndpoint", () => {
  it("abandons task successfully with full cleanup", async () => {
    const mockResult = {
      task: {
        id: "task-1",
        number: 1,
        title: "Task One",
        status: "ABANDONED",
      },
      previousStatus: "IN_PROGRESS",
      cleanup: {
        externalIssueClosed: true,
        worktreeCleaned: true,
        branchDeleted: true,
      },
    };

    const testContainer = buildTestContainer({
      taskAppService: {
        abandonTaskWithCleanup: vi.fn().mockResolvedValue(mockResult),
      },
    });

    const req = new Request("http://localhost/api/tasks/task-1/abandon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectSlug: "my-project",
        reason: "No longer needed",
      }),
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      taskId: "task-1",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.success).toBe(true);
    expect(body.task.status).toBe("ABANDONED");
    expect(body.task.previousStatus).toBe("IN_PROGRESS");
    expect(body.cleanup.externalIssueClosed).toBe(true);
    expect(body.cleanup.worktreeCleaned).toBe(true);
    expect(body.cleanup.branchDeleted).toBe(true);

    const service = testContainer.resolve("taskAppService") as any;
    expect(service.abandonTaskWithCleanup).toHaveBeenCalledWith(
      "my-project",
      "task-1",
      "No longer needed"
    );
  });

  it("abandons task without reason", async () => {
    const mockResult = {
      task: {
        id: "task-1",
        number: 1,
        title: "Task One",
        status: "ABANDONED",
      },
      previousStatus: "READY",
      cleanup: {
        externalIssueClosed: false,
        worktreeCleaned: false,
        branchDeleted: false,
      },
    };

    const testContainer = buildTestContainer({
      taskAppService: {
        abandonTaskWithCleanup: vi.fn().mockResolvedValue(mockResult),
      },
    });

    const req = new Request("http://localhost/api/tasks/task-1/abandon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectSlug: "my-project",
      }),
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      taskId: "task-1",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.success).toBe(true);

    const service = testContainer.resolve("taskAppService") as any;
    expect(service.abandonTaskWithCleanup).toHaveBeenCalledWith("my-project", "task-1", undefined);
  });

  it("returns 404 when task not found", async () => {
    const testContainer = buildTestContainer({
      taskAppService: {
        abandonTaskWithCleanup: vi
          .fn()
          .mockRejectedValue(new EntityNotFoundError("Task", "not-found")),
      },
    });

    const req = new Request("http://localhost/api/tasks/not-found/abandon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectSlug: "my-project",
      }),
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      taskId: "not-found",
    });

    expect(result.status).toBe(404);
  });

  it("returns 422 when task cannot be abandoned", async () => {
    const testContainer = buildTestContainer({
      taskAppService: {
        abandonTaskWithCleanup: vi
          .fn()
          .mockRejectedValue(new BusinessRuleError("Cannot abandon completed task")),
      },
    });

    const req = new Request("http://localhost/api/tasks/task-1/abandon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectSlug: "my-project",
      }),
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      taskId: "task-1",
    });

    expect(result.status).toBe(422);
  });

  it("returns 400 when projectSlug is missing", async () => {
    const testContainer = buildTestContainer({
      taskAppService: {
        abandonTaskWithCleanup: vi.fn(),
      },
    });

    const req = new Request("http://localhost/api/tasks/task-1/abandon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      taskId: "task-1",
    });

    expect(result.status).toBe(400);
  });
});
