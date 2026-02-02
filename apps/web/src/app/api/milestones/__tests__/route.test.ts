/**
 * Tests for List Milestones Endpoint
 *
 * Uses DI injection via createTestContainer with mock repos.
 * The real operation code (getMilestonesWithDetails) runs against mock repositories,
 * so milestone status, issue status, and progress are computed from the mock data.
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
import type { Milestone } from "@dev-workflow/tracking";

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

const milestone: Milestone = {
  id: "milestone-1",
  projectId: "proj-1",
  number: 1,
  title: "Sprint 1",
  description: "First sprint",
  startDate: "2024-01-01",
  endDate: "2030-12-31",
  status: "IN_PROGRESS",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const openIssue: Issue = Issue.from({
  id: "issue-1",
  projectId: "proj-1",
  number: 1,
  title: "Open Issue",
  description: "An open issue",
  acceptanceCriteria: [],
  type: "FEATURE",
  priority: "MEDIUM",
  status: "OPEN",
  milestoneId: "milestone-1",
  createdAt: now,
  updatedAt: now,
});

const closedIssue: Issue = Issue.from({
  id: "issue-2",
  projectId: "proj-1",
  number: 2,
  title: "Closed Issue",
  description: "A closed issue",
  acceptanceCriteria: [],
  type: "BUG",
  priority: "LOW",
  status: "CLOSED",
  milestoneId: "milestone-1",
  createdAt: now,
  updatedAt: now,
});

const plan: Plan = {
  id: "plan-1",
  issueId: "issue-1",
  summary: "Plan for open issue",
  approach: "Implementation approach",
  estimatedComplexity: "LOW",
  generatedBy: "claude",
  createdAt: now,
  updatedAt: now,
};

const taskInProgress: Task = Task.from({
  id: "task-1",
  planId: "plan-1",
  number: 1,
  order: 1,
  title: "Active Task",
  description: "An in-progress task",
  acceptanceCriteria: [],
  status: "IN_PROGRESS",
  type: "FEATURE",
  source: "generated",
  isDeleted: false,
  createdAt: now,
  updatedAt: now,
});

// =============================================================================
// Helpers
// =============================================================================

function createMockClient() {
  return {
    milestones: {
      findMany: () => Effect.succeed([milestone]),
    },
    issues: {
      findMany: () => Effect.succeed([openIssue, closedIssue]),
    },
    plans: {
      findByIssueId: (issueId: string) => Effect.succeed(issueId === "issue-1" ? plan : null),
    },
    tasks: {
      findByPlanId: (planId: string) => Effect.succeed(planId === "plan-1" ? [taskInProgress] : []),
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("listMilestonesEndpoint", () => {
  it("returns milestones with issues and progress", async () => {
    const testContainer = createTestContainer({
      projectsResolver: { getAllProjects: () => Effect.succeed([mockProject]) },
      sourceProvider: createMockSourceProvider(createMockClient()),
    });

    const req = createTestRequest("GET", "/api/milestones");
    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(1);

    const entry = body[0];
    expect(entry.milestone.title).toBe("Sprint 1");
    expect(entry.milestone.projectName).toBe("Project One");
    expect(entry.milestone.projectSlug).toBe("project-one");

    // Issues
    expect(entry.issues).toHaveLength(2);
    // openIssue has a plan with an IN_PROGRESS task, so computedStatus = IN_PROGRESS
    const openIssueResult = entry.issues.find((i: { number: number }) => i.number === 1);
    expect(openIssueResult.title).toBe("Open Issue");
    expect(openIssueResult.computedStatus).toBe("IN_PROGRESS");
    expect(openIssueResult.type).toBe("FEATURE");

    // closedIssue has status CLOSED, no plan needed
    const closedIssueResult = entry.issues.find((i: { number: number }) => i.number === 2);
    expect(closedIssueResult.title).toBe("Closed Issue");
    expect(closedIssueResult.computedStatus).toBe("CLOSED");
    expect(closedIssueResult.type).toBe("BUG");

    // Progress: 1 of 2 closed = 50%
    expect(entry.progress.total).toBe(2);
    expect(entry.progress.closed).toBe(1);
    expect(entry.progress.percentage).toBe(50);
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
      projectsResolver: { getAllProjects: () => Effect.succeed([mockProject, secondProject]) },
      sourceProvider: createMockSourceProvider(createMockClient()),
    });

    const req = createTestRequest("GET", "/api/milestones?project=project-one");
    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    // Only milestones from project-one
    expect(body).toHaveLength(1);
    expect(body[0].milestone.projectSlug).toBe("project-one");
  });

  it("passes source filter to operation", async () => {
    const testContainer = createTestContainer({
      projectsResolver: { getAllProjects: () => Effect.succeed([mockProject]) },
      sourceProvider: createMockSourceProvider(createMockClient()),
    });

    // Source filter filters by project slug
    const req = createTestRequest("GET", "/api/milestones?source=project-one");
    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(1);
    expect(body[0].milestone.projectSlug).toBe("project-one");
  });

  it("returns empty array when no milestones", async () => {
    const emptyClient = {
      ...createMockClient(),
      milestones: { findMany: () => Effect.succeed([]) },
    };

    const testContainer = createTestContainer({
      projectsResolver: { getAllProjects: () => Effect.succeed([mockProject]) },
      sourceProvider: createMockSourceProvider(emptyClient),
    });

    const req = createTestRequest("GET", "/api/milestones");
    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(0);
  });
});
