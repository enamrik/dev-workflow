/**
 * Tests for Task Dependencies Endpoint
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

describe("getTaskDependenciesEndpoint", () => {
  it("returns task dependencies with issue numbers", async () => {
    const testContainer = createTestContainer({
      projectsResolver: {
        getAllProjects: async () => [mockProject],
      },
      sourceProvider: createMockSourceProvider({
        tasks: {
          findById: () =>
            Effect.succeed({
              id: "task-1",
              title: "Test Task",
              dependsOn: ["dep-1", "dep-2"],
            }),
          findByIds: () =>
            Effect.succeed([
              {
                id: "dep-1",
                number: 1,
                title: "Dependency One",
                status: "COMPLETED",
                planId: "plan-1",
              },
              {
                id: "dep-2",
                number: 2,
                title: "Dependency Two",
                status: "IN_PROGRESS",
                planId: "plan-1",
              },
            ]),
        },
        plans: {
          findById: async () => ({ id: "plan-1", issueId: "issue-1" }),
        },
        issues: {
          findById: () => Effect.succeed({ id: "issue-1", number: 5 }),
        },
      }),
    });

    const req = createTestRequest("GET", "/api/projects/my-project/tasks/task-1/dependencies");

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      project: "my-project",
      taskId: "task-1",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(2);
    expect(body[0].issueNumber).toBe(5);
  });

  it("returns empty array when task has no dependencies", async () => {
    const testContainer = createTestContainer({
      projectsResolver: {
        getAllProjects: async () => [mockProject],
      },
      sourceProvider: createMockSourceProvider({
        tasks: {
          findById: () =>
            Effect.succeed({
              id: "task-1",
              title: "Test Task",
              dependsOn: [],
            }),
          findByIds: () => Effect.succeed([]),
        },
        plans: {
          findById: async () => null,
        },
        issues: {
          findById: () => Effect.succeed(null),
        },
      }),
    });

    const req = createTestRequest("GET", "/api/projects/my-project/tasks/task-1/dependencies");

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
          findByIds: () => Effect.succeed([]),
        },
        plans: {
          findById: async () => null,
        },
        issues: {
          findById: () => Effect.succeed(null),
        },
      }),
    });

    const req = createTestRequest("GET", "/api/projects/my-project/tasks/not-found/dependencies");

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      project: "my-project",
      taskId: "not-found",
    });

    expect(result.status).toBe(404);
  });
});
