/**
 * Tests for Task Status History Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { EntityNotFoundError } from "@dev-workflow/tracking";
import { buildTestContainer, createTestRequest, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "../route";

describe("getTaskStatusHistoryEndpoint", () => {
  it("returns task status history", async () => {
    const mockHistory = [
      {
        fromStatus: "BACKLOG",
        toStatus: "READY",
        changedAt: "2024-01-15T10:00:00Z",
        changedBy: "user",
      },
      {
        fromStatus: "READY",
        toStatus: "IN_PROGRESS",
        changedAt: "2024-01-15T11:00:00Z",
        changedBy: "user",
      },
    ];

    const testContainer = buildTestContainer({
      projectAppService: {
        getTaskStatusHistory: vi.fn().mockResolvedValue(mockHistory),
      },
    });

    const req = createTestRequest("GET", "/api/projects/my-project/tasks/task-1/history");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      project: "my-project",
      taskId: "task-1",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(2);
    expect(body[0].toStatus).toBe("READY");

    const service = testContainer.resolve("projectAppService") as any;
    expect(service.getTaskStatusHistory).toHaveBeenCalledWith("task-1");
  });

  it("returns empty array when task has no status history", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        getTaskStatusHistory: vi.fn().mockResolvedValue([]),
      },
    });

    const req = createTestRequest("GET", "/api/projects/my-project/tasks/task-1/history");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      project: "my-project",
      taskId: "task-1",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(0);
  });

  it("returns 404 when task not found", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        getTaskStatusHistory: vi
          .fn()
          .mockRejectedValue(new EntityNotFoundError("Task", "not-found")),
      },
    });

    const req = createTestRequest("GET", "/api/projects/my-project/tasks/not-found/history");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      project: "my-project",
      taskId: "not-found",
    });

    expect(result.status).toBe(404);
  });
});
