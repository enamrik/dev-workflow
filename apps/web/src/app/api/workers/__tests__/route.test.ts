/**
 * Tests for List Workers Endpoint
 *
 * Uses DI injection via createTestContainer — no vi.mock.
 * Real operation code runs; mock dependencies are injected into the container.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "@dev-workflow/effect";
import {
  createTestContainer,
  createTestRequest,
  runTestEndpoint,
  createMockSourceProvider,
} from "@/lib/di/test-utils";
import { endpoint } from "../route";

// =============================================================================
// Fixtures
// =============================================================================

const mockProject = {
  projectId: "proj-1",
  slug: "test-project",
  name: "Test Project",
  sourceInfo: { connectionString: "test://db" },
  gitRoot: "/test/project",
};

describe("listWorkersEndpoint", () => {
  it("returns worker data with enriched details", async () => {
    const mockWorkerQueueDb = {
      findAllWorkersWithHealth: () => [
        {
          id: "worker-1",
          name: "Worker A",
          status: "WORKING",
          lastHeartbeat: "2024-01-15T10:00:00Z",
          pid: 1234,
          createdAt: "2024-01-15T09:00:00Z",
          isAlive: true,
          heartbeatAge: 5,
          currentTaskId: "task-1",
        },
      ],
      findAllEntriesWithHealth: () => [
        {
          taskId: "task-2",
          projectSlug: "test-project",
          status: "PENDING",
          workerId: null,
          claimedAt: null,
          createdAt: "2024-01-15T10:00:00Z",
          claudeDone: false,
          claudeDoneAt: null,
          isStale: false,
          workerName: null,
        },
      ],
      getQueueStats: () => ({ total: 2, unclaimed: 1, claimed: 1, stale: 0 }),
    };

    const mockProjectsResolver = {
      getAllSources: async () => [
        {
          displayId: "test-db",
          displayName: "Test DB",
          sourceInfo: { connectionString: "test://db" },
          projects: [{ projectId: "proj-1", slug: "test-project" }],
        },
      ],
      getProjectBySlug: async () => mockProject,
      getAllProjects: async () => [mockProject],
    };

    // Mock DbClient repos for task detail enrichment
    const mockDbClient = {
      tasks: {
        findById: (id: string) => {
          if (id === "task-1") {
            return Effect.succeed({
              id: "task-1",
              number: 1,
              title: "Task One",
              planId: "plan-1",
              startedAt: "2024-01-15T10:00:00Z",
              status: "IN_PROGRESS",
            });
          }
          if (id === "task-2") {
            return Effect.succeed({
              id: "task-2",
              number: 2,
              title: "Task Two",
              planId: "plan-1",
              startedAt: null,
              status: "BACKLOG",
            });
          }
          return Effect.succeed(null);
        },
        findByPlanId: () => Effect.succeed([{ id: "task-1" }, { id: "task-2" }, { id: "task-3" }]),
      },
      plans: {
        findById: async () => ({
          id: "plan-1",
          issueId: "issue-1",
        }),
      },
      issues: {
        findById: () =>
          Effect.succeed({
            id: "issue-1",
            number: 5,
            title: "Issue Five",
          }),
      },
    };

    const testContainer = createTestContainer({
      projectsResolver: mockProjectsResolver,
      sourceProvider: createMockSourceProvider(mockDbClient),
      workerQueueDb: mockWorkerQueueDb,
    });

    const req = createTestRequest("GET", "/api/workers");
    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();

    // Workers enriched with task details
    expect(body.workers).toHaveLength(1);
    expect(body.workers[0].name).toBe("Worker A");
    expect(body.workers[0].taskNumber).toBe(1);
    expect(body.workers[0].issueNumber).toBe(5);
    expect(body.workers[0].taskStartedAt).toBe("2024-01-15T10:00:00Z");
    expect(body.workers[0].totalTasks).toBe(3);

    // Queue entries enriched with task details
    expect(body.queue).toHaveLength(1);
    expect(body.queue[0].taskNumber).toBe(2);
    expect(body.queue[0].issueNumber).toBe(5);
    expect(body.queue[0].taskTitle).toBe("Task Two");
    expect(body.queue[0].totalTasks).toBe(3);

    // Stats
    expect(body.stats).toEqual({ total: 2, unclaimed: 1, claimed: 1, stale: 0 });
  });

  it("returns empty arrays when no workers or queue entries", async () => {
    const mockWorkerQueueDb = {
      findAllWorkersWithHealth: () => [],
      findAllEntriesWithHealth: () => [],
      getQueueStats: () => ({ total: 0, unclaimed: 0, claimed: 0, stale: 0 }),
    };

    const mockProjectsResolver = {
      getAllSources: async () => [],
      getProjectBySlug: async () => mockProject,
      getAllProjects: async () => [],
    };

    const testContainer = createTestContainer({
      projectsResolver: mockProjectsResolver,
      sourceProvider: createMockSourceProvider({}),
      workerQueueDb: mockWorkerQueueDb,
    });

    const req = createTestRequest("GET", "/api/workers");
    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.workers).toHaveLength(0);
    expect(body.queue).toHaveLength(0);
    expect(body.stats).toEqual({ total: 0, unclaimed: 0, claimed: 0, stale: 0 });
  });
});
