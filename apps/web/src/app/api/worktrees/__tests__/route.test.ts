/**
 * Tests for Worktrees Endpoints
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
import { listEndpoint, pruneEndpoint } from "../route";

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

// =============================================================================
// listEndpoint — getWorktreesWithTaskInfo
// =============================================================================

describe("listWorktreesEndpoint", () => {
  it("returns worktrees with task details", async () => {
    const mockProjectsResolver = {
      getAllProjects: async () => [mockProject],
    };

    // DB repos for task enrichment
    const mockDbClient = {
      issues: {
        findMany: () => Effect.succeed([{ id: "issue-1", number: 5, title: "Issue Five" }]),
      },
      plans: {
        findByIssueId: async (issueId: string) => {
          if (issueId === "issue-1") return { id: "plan-1", issueId: "issue-1" };
          return null;
        },
      },
      tasks: {
        findByPlanId: () =>
          Effect.succeed([
            {
              id: "task-1",
              number: 1,
              title: "Task One",
              status: "IN_PROGRESS",
              worktreePath: "/path/to/worktree",
              planId: "plan-1",
            },
          ]),
      },
    };

    // Mock worktree service factory
    const mockCreateWorktreeService = () => ({
      listWorktrees: async () => [
        {
          path: "/test/project",
          branch: "main",
          head: "abc000",
          isMain: true,
          diskUsageBytes: 2048000,
        },
        {
          path: "/path/to/worktree",
          branch: "issue-5/task-1",
          head: "abc123",
          isMain: false,
          diskUsageBytes: 1024000,
        },
      ],
    });

    const testContainer = createTestContainer({
      projectsResolver: mockProjectsResolver,
      sourceProvider: createMockSourceProvider(mockDbClient),
      createWorktreeService: mockCreateWorktreeService,
    });

    const req = createTestRequest("GET", "/api/worktrees");
    const result = await runTestEndpoint(testContainer, listEndpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();

    // Main worktree is excluded; only non-main worktrees returned
    expect(body.worktrees).toHaveLength(1);
    expect(body.worktrees[0].branch).toBe("issue-5/task-1");
    expect(body.worktrees[0].taskNumber).toBe(1);
    expect(body.worktrees[0].taskTitle).toBe("Task One");
    expect(body.worktrees[0].taskStatus).toBe("IN_PROGRESS");
    expect(body.worktrees[0].issueNumber).toBe(5);
    expect(body.worktrees[0].projectId).toBe("proj-1");
    expect(body.worktrees[0].diskUsageBytes).toBe(1024000);
  });

  it("passes project filter to operation", async () => {
    const filteredProject = {
      ...mockProject,
      slug: "my-project",
    };

    const mockProjectsResolver = {
      getAllProjects: async () => [mockProject, filteredProject],
    };

    // DB repos return empty data for filtered project
    const mockDbClient = {
      issues: { findMany: () => Effect.succeed([]) },
      plans: { findByIssueId: async () => null },
      tasks: { findByPlanId: () => Effect.succeed([]) },
    };

    const mockCreateWorktreeService = () => ({
      listWorktrees: async () => [],
    });

    const testContainer = createTestContainer({
      projectsResolver: mockProjectsResolver,
      sourceProvider: createMockSourceProvider(mockDbClient),
      createWorktreeService: mockCreateWorktreeService,
    });

    const req = createTestRequest("GET", "/api/worktrees?project=my-project");
    const result = await runTestEndpoint(testContainer, listEndpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.worktrees).toHaveLength(0);
  });

  it("returns empty array when no worktrees", async () => {
    const mockProjectsResolver = {
      getAllProjects: async () => [mockProject],
    };

    const mockDbClient = {
      issues: { findMany: () => Effect.succeed([]) },
      plans: { findByIssueId: async () => null },
      tasks: { findByPlanId: () => Effect.succeed([]) },
    };

    const mockCreateWorktreeService = () => ({
      listWorktrees: async () => [],
    });

    const testContainer = createTestContainer({
      projectsResolver: mockProjectsResolver,
      sourceProvider: createMockSourceProvider(mockDbClient),
      createWorktreeService: mockCreateWorktreeService,
    });

    const req = createTestRequest("GET", "/api/worktrees");
    const result = await runTestEndpoint(testContainer, listEndpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.worktrees).toHaveLength(0);
  });
});

// =============================================================================
// pruneEndpoint — pruneWorktrees
// =============================================================================

describe("pruneWorktreesEndpoint", () => {
  it("prunes worktrees successfully", async () => {
    const mockProjectsResolver = {
      getAllProjects: async () => [mockProject],
    };

    // listWorktrees is called twice: before prune (3 non-main) and after (0)
    let callCount = 0;
    const mockCreateWorktreeService = () => ({
      listWorktrees: async () => {
        callCount++;
        if (callCount === 1) {
          return [
            { path: "/test/project", branch: "main", head: "aaa", isMain: true },
            { path: "/wt/1", branch: "issue-1/task-1", head: "bbb", isMain: false },
            { path: "/wt/2", branch: "issue-2/task-1", head: "ccc", isMain: false },
            { path: "/wt/3", branch: "issue-3/task-1", head: "ddd", isMain: false },
          ];
        }
        // After prune: only main remains
        return [{ path: "/test/project", branch: "main", head: "aaa", isMain: true }];
      },
      pruneWorktrees: async () => {},
    });

    const testContainer = createTestContainer({
      projectsResolver: mockProjectsResolver,
      createWorktreeService: mockCreateWorktreeService,
    });

    const req = createTestRequest("POST", "/api/worktrees", {
      body: { action: "prune", projectId: "proj-1" },
    });

    const result = await runTestEndpoint(testContainer, pruneEndpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.success).toBe(true);
    expect(body.pruned).toBe(3);
  });

  it("returns 400 when projectId is missing", async () => {
    const mockProjectsResolver = {
      getAllProjects: async () => [mockProject],
    };

    const testContainer = createTestContainer({
      projectsResolver: mockProjectsResolver,
      createWorktreeService: () => ({
        listWorktrees: async () => [],
        pruneWorktrees: async () => {},
      }),
    });

    const req = createTestRequest("POST", "/api/worktrees", {
      body: { action: "prune" },
    });

    const result = await runTestEndpoint(testContainer, pruneEndpoint, req, {});

    expect(result.status).toBe(400);
  });
});
