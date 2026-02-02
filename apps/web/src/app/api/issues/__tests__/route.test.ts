/**
 * Tests for List Issues Endpoint
 *
 * Uses DI injection via createTestContainer with mock repos.
 * The real operation code (listAllIssues) runs against mock repositories,
 * so IssueStatusService computes statuses from the mock data.
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

const issueWithPlan: Issue = Issue.from({
  id: "issue-1",
  projectId: "proj-1",
  number: 2,
  title: "Issue With Plan",
  description: "Has a plan and tasks",
  acceptanceCriteria: [],
  type: "FEATURE",
  priority: "MEDIUM",
  status: "OPEN",
  createdAt: now,
  updatedAt: now,
});

const issueWithoutPlan: Issue = Issue.from({
  id: "issue-2",
  projectId: "proj-1",
  number: 1,
  title: "Issue Without Plan",
  description: "No plan",
  acceptanceCriteria: [],
  type: "BUG",
  priority: "LOW",
  status: "OPEN",
  createdAt: now,
  updatedAt: now,
});

const plan: Plan = {
  id: "plan-1",
  issueId: "issue-1",
  summary: "Plan for issue 1",
  approach: "Do the thing",
  estimatedComplexity: "MEDIUM",
  generatedBy: "claude",
  createdAt: now,
  updatedAt: now,
};

const tasks: Task[] = [
  Task.from({
    id: "task-1",
    planId: "plan-1",
    number: 1,
    order: 1,
    title: "Task 1",
    description: "First task",
    acceptanceCriteria: [],
    status: "IN_PROGRESS",
    type: "FEATURE",
    source: "generated",
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  }),
  Task.from({
    id: "task-2",
    planId: "plan-1",
    number: 2,
    order: 2,
    title: "Task 2",
    description: "Second task",
    acceptanceCriteria: [],
    status: "READY",
    type: "FEATURE",
    source: "generated",
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  }),
  Task.from({
    id: "task-3",
    planId: "plan-1",
    number: 3,
    order: 3,
    title: "Task 3",
    description: "Third task",
    acceptanceCriteria: [],
    status: "COMPLETED",
    type: "FEATURE",
    source: "generated",
    isDeleted: false,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  }),
];

// =============================================================================
// Helpers
// =============================================================================

function createMockClient() {
  return {
    issues: {
      findMany: () => Effect.succeed([issueWithPlan, issueWithoutPlan]),
    },
    plans: {
      findByIssueId: async (issueId: string) => (issueId === "issue-1" ? plan : null),
    },
    tasks: {
      findByPlanId: (planId: string) => Effect.succeed(planId === "plan-1" ? tasks : []),
    },
    milestones: {
      findById: () => Effect.succeed(null),
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("listIssuesEndpoint", () => {
  it("returns issues with plan info and computed status", async () => {
    const testContainer = createTestContainer({
      projectsResolver: { getAllProjects: async () => [mockProject] },
      sourceProvider: createMockSourceProvider(createMockClient()),
    });

    const req = createTestRequest("GET", "/api/issues");
    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(2);

    // Sorted by projectId then number desc, so issue-1 (number=2) comes first
    const first = body[0];
    expect(first.issue.title).toBe("Issue With Plan");
    expect(first.hasPlan).toBe(true);
    // IssueStatusService computes IN_PROGRESS because task-1 is IN_PROGRESS
    expect(first.computedStatus).toBe("IN_PROGRESS");
    expect(first.taskCounts).toBeDefined();
    expect(first.taskCounts.total).toBe(3);
    // terminal count: 1 COMPLETED
    expect(first.taskCounts.completed).toBe(1);
    // active count: 1 IN_PROGRESS
    expect(first.taskCounts.inProgress).toBe(1);
    expect(first.projectName).toBe("Project One");
    expect(first.projectSlug).toBe("project-one");

    const second = body[1];
    expect(second.issue.title).toBe("Issue Without Plan");
    expect(second.hasPlan).toBe(false);
    // No plan means stored status is used: OPEN
    expect(second.computedStatus).toBe("OPEN");
    expect(second.taskCounts).toBeUndefined();
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
    });

    // Filter to only project-one
    const req = createTestRequest("GET", "/api/issues?project=project-one");
    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    // Should only contain issues from project-one
    expect(body).toHaveLength(2);
    expect(body[0].projectSlug).toBe("project-one");
  });

  it("returns empty array when no issues", async () => {
    const emptyClient = {
      ...createMockClient(),
      issues: { findMany: () => Effect.succeed([]) },
    };

    const testContainer = createTestContainer({
      projectsResolver: { getAllProjects: async () => [mockProject] },
      sourceProvider: createMockSourceProvider(emptyClient),
    });

    const req = createTestRequest("GET", "/api/issues");
    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(0);
  });
});
