/**
 * Tests for Task Dependencies Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { EntityNotFoundError } from "@dev-workflow/core";
import { buildTestContainer, createTestRequest, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "../route";

describe("getTaskDependenciesEndpoint", () => {
  it("returns task dependencies with issue numbers", async () => {
    const mockDependencies = [
      {
        id: "dep-1",
        number: 1,
        title: "Dependency One",
        status: "COMPLETED",
        issueNumber: 5,
      },
      {
        id: "dep-2",
        number: 2,
        title: "Dependency Two",
        status: "IN_PROGRESS",
        issueNumber: 5,
      },
    ];

    const testContainer = buildTestContainer({
      projectAppService: {
        getTaskDependencies: vi.fn().mockResolvedValue(mockDependencies),
      },
    });

    const req = createTestRequest("GET", "/api/projects/my-project/tasks/task-1/dependencies");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      project: "my-project",
      taskId: "task-1",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(2);
    expect(body[0].issueNumber).toBe(5);

    const service = testContainer.resolve("projectAppService") as any;
    expect(service.getTaskDependencies).toHaveBeenCalledWith("task-1");
  });

  it("returns empty array when task has no dependencies", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        getTaskDependencies: vi.fn().mockResolvedValue([]),
      },
    });

    const req = createTestRequest("GET", "/api/projects/my-project/tasks/task-1/dependencies");

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
        getTaskDependencies: vi
          .fn()
          .mockRejectedValue(new EntityNotFoundError("Task", "not-found")),
      },
    });

    const req = createTestRequest("GET", "/api/projects/my-project/tasks/not-found/dependencies");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      project: "my-project",
      taskId: "not-found",
    });

    expect(result.status).toBe(404);
  });
});
