/**
 * Tests for Task Status History Endpoint
 */

import { describe, it, expect } from "vitest";
import { Effect } from "@dev-workflow/effect";
import {
  createTestContainer,
  createTestRequest,
  createMockSourceProvider,
  runTestEndpoint,
} from "@/lib/di/test-utils";

import { endpoint } from "../route";

const mockProject = {
  projectId: "proj-1",
  slug: "test-project",
  name: "Test Project",
  sourceInfo: { connectionString: "test://db" },
  gitRoot: "/test/project",
};

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

    const testContainer = createTestContainer({
      projectsResolver: {
        getAllProjects: async () => [mockProject],
      },
      sourceProvider: createMockSourceProvider({
        tasks: {
          findById: () => Effect.succeed({ id: "task-1", title: "Test Task" }),
          getStatusHistory: () => Effect.succeed(mockHistory),
        },
      }),
    });

    const req = createTestRequest("GET", "/api/projects/my-project/tasks/task-1/history");

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      project: "my-project",
      taskId: "task-1",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(2);
    expect(body[0].toStatus).toBe("READY");
  });

  it("returns empty array when task has no status history", async () => {
    const testContainer = createTestContainer({
      projectsResolver: {
        getAllProjects: async () => [mockProject],
      },
      sourceProvider: createMockSourceProvider({
        tasks: {
          findById: () => Effect.succeed({ id: "task-1", title: "Test Task" }),
          getStatusHistory: () => Effect.succeed([]),
        },
      }),
    });

    const req = createTestRequest("GET", "/api/projects/my-project/tasks/task-1/history");

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      project: "my-project",
      taskId: "task-1",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(0);
  });

  it("returns 404 when task not found", async () => {
    const testContainer = createTestContainer({
      projectsResolver: {
        getAllProjects: async () => [mockProject],
      },
      sourceProvider: createMockSourceProvider({
        tasks: {
          findById: () => Effect.succeed(null),
          getStatusHistory: () => Effect.succeed([]),
        },
      }),
    });

    const req = createTestRequest("GET", "/api/projects/my-project/tasks/not-found/history");

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      project: "my-project",
      taskId: "not-found",
    });

    expect(result.status).toBe(404);
  });
});
