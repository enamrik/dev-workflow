/**
 * Tests for List Tasks Endpoint (Board View)
 *
 * Uses DI injection via createTestContainer with mock repos.
 * The real operation code (listAllTasksForBoard) runs against mock repositories,
 * so BoardQueryService fetches active issues/tasks from the mock data,
 * and worker assignments come from the mock workerQueueDb.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "@dev-workflow/effect";
import {
  createTestContainer,
  createTestRequest,
  createMockSourceProvider,
  runTestEndpoint,
} from "@/lib/di/test-utils";
import { Issue, Task } from "@dev-workflow/tracking";
import type { Plan } from "@dev-workflow/tracking";

import { endpoint } from "../route";

// =============================================================================
// Test Data
// =============================================================================

const mockProject = {
  projectId: "proj-1",
  slug: "project-one",
  name: "Project One",
  sourceInfo: { connectionString: "test://db" },
  gitRoot: "/test/project",
};

const now = new Date().toISOString();
const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago

const issue: Issue = Issue.from({
  id: "issue-1",
  projectId: "proj-1",
  number: 1,
  title: "Board Issue",
  description: "An issue for the board",
  acceptanceCriteria: [],
  type: "FEATURE",
  priority: "MEDIUM",
  status: "OPEN",
  createdAt: now,
  updatedAt: now,
});

const plan: Plan = {
  id: "plan-1",
  issueId: "issue-1",
  summary: "Plan for board issue",
  approach: "Build it",
  estimatedComplexity: "MEDIUM",
  generatedBy: "claude",
  createdAt: now,
  updatedAt: now,
};

const taskInProgress: Task = Task.from({
  id: "task-1",
  planId: "plan-1",
  number: 1,
  order: 1,
  title: "In Progress Task",
  description: "Currently being worked on",
  acceptanceCriteria: [],
  status: "IN_PROGRESS",
  type: "FEATURE",
  source: "generated",
  isDeleted: false,
  startedAt: now,
  createdAt: now,
  updatedAt: now,
});

const taskReady: Task = Task.from({
  id: "task-2",
  planId: "plan-1",
  number: 2,
  order: 2,
  title: "Ready Task",
  description: "Ready to be picked up",
  acceptanceCriteria: [],
  status: "READY",
  type: "FEATURE",
  source: "generated",
  isDeleted: false,
  createdAt: now,
  updatedAt: now,
});

const taskCompleted: Task = Task.from({
  id: "task-3",
  planId: "plan-1",
  number: 3,
  order: 3,
  title: "Completed Task",
  description: "Done recently",
  acceptanceCriteria: [],
  status: "COMPLETED",
  type: "FEATURE",
  source: "generated",
  isDeleted: false,
  completedAt: recentDate,
  createdAt: now,
  updatedAt: now,
});

// =============================================================================
// Helpers
// =============================================================================

function createMockClient() {
  return {
    issues: {
      findMany: () => Effect.succeed([issue]),
    },
    plans: {
      findByIssueId: async (issueId: string) => (issueId === "issue-1" ? plan : null),
    },
    tasks: {
      findByPlanId: (planId: string) =>
        Effect.succeed(planId === "plan-1" ? [taskInProgress, taskReady, taskCompleted] : []),
    },
    milestones: {
      findById: () => Effect.succeed(null),
    },
  };
}

function createMockWorkerQueueDb(entries: unknown[] = []) {
  return {
    findAllEntriesWithHealth: () => entries,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("listTasksEndpoint", () => {
  it("returns issues with tasks for board view", async () => {
    const testContainer = createTestContainer({
      projectsResolver: { getAllProjects: async () => [mockProject] },
      sourceProvider: createMockSourceProvider(createMockClient()),
      workerQueueDb: createMockWorkerQueueDb(),
    });

    const req = createTestRequest("GET", "/api/tasks");
    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();

    // Should have 1 issue with tasks
    expect(body.issuesWithTasks).toHaveLength(1);

    const issueEntry = body.issuesWithTasks[0];
    expect(issueEntry.issue.title).toBe("Board Issue");
    expect(issueEntry.plan.id).toBe("plan-1");
    expect(issueEntry.tasks).toHaveLength(3);
    expect(issueEntry.projectName).toBe("Project One");
    expect(issueEntry.projectSlug).toBe("project-one");

    // Completed task with recent completedAt should appear in completedTasks
    expect(body.completedTasks).toHaveLength(1);
    expect(body.completedTasks[0].title).toBe("Completed Task");
    expect(body.completedTasks[0].issueNumber).toBe(1);
    expect(body.completedTasks[0].issueTitle).toBe("Board Issue");
    expect(body.completedTasks[0].projectName).toBe("Project One");
  });

  it("passes project filter to operation", async () => {
    const secondProject = {
      projectId: "proj-2",
      slug: "project-two",
      name: "Project Two",
      sourceInfo: { connectionString: "test://db2" },
      gitRoot: "/test/project2",
    };

    const testContainer = createTestContainer({
      projectsResolver: { getAllProjects: async () => [mockProject, secondProject] },
      sourceProvider: createMockSourceProvider(createMockClient()),
      workerQueueDb: createMockWorkerQueueDb(),
    });

    const req = createTestRequest("GET", "/api/tasks?project=project-one");
    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    // Only project-one data
    expect(body.issuesWithTasks).toHaveLength(1);
    expect(body.issuesWithTasks[0].projectSlug).toBe("project-one");
  });

  it("returns empty arrays when no data", async () => {
    const emptyClient = {
      issues: { findMany: () => Effect.succeed([]) },
      plans: { findByIssueId: async () => null },
      tasks: { findByPlanId: () => Effect.succeed([]) },
      milestones: { findById: () => Effect.succeed(null) },
    };

    const testContainer = createTestContainer({
      projectsResolver: { getAllProjects: async () => [mockProject] },
      sourceProvider: createMockSourceProvider(emptyClient),
      workerQueueDb: createMockWorkerQueueDb(),
    });

    const req = createTestRequest("GET", "/api/tasks");
    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.issuesWithTasks).toHaveLength(0);
    expect(body.completedTasks).toHaveLength(0);
  });
});
