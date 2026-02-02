/**
 * Tests for Get Issue with Details Endpoint
 */

import { describe, it, expect } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { EntityNotFoundError } from "@dev-workflow/tracking";
import { createTestContainer, createTestRequest, runTestEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "../endpoint";

describe("getIssueWithDetailsEndpoint", () => {
  it("returns issue with plan and tasks", async () => {
    const mockIssue = {
      id: "issue-1",
      number: 5,
      title: "Issue Five",
      status: "OPEN",
      type: "FEATURE",
    };
    const mockPlan = { id: "plan-1", issueId: "issue-1", summary: "Plan summary" };
    const mockTasks = [
      { id: "task-1", number: 1, title: "Task One", status: "READY", planId: "plan-1" },
      { id: "task-2", number: 2, title: "Task Two", status: "IN_PROGRESS", planId: "plan-1" },
    ];

    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            issues: { getByNumber: () => Effect.succeed(mockIssue) },
            plans: { findByIssueId: () => Effect.succeed(mockPlan) },
            tasks: { findByPlanId: () => Effect.succeed(mockTasks) },
          }),
      },
    });

    const req = createTestRequest("GET", "/api/projects/my-project/issues/5");

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      project: "my-project",
      number: "5",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.issue.number).toBe(5);
    expect(body.plan).toBeDefined();
    expect(body.tasks).toHaveLength(2);
  });

  it("returns 404 when issue not found", async () => {
    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            issues: {
              getByNumber: () => Effect.fail(new EntityNotFoundError("Issue", "#999")),
            },
          }),
      },
    });

    const req = createTestRequest("GET", "/api/projects/my-project/issues/999");

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      project: "my-project",
      number: "999",
    });

    expect(result.status).toBe(404);
    const body = await result.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 for invalid issue number", async () => {
    const testContainer = createTestContainer({});

    const req = createTestRequest("GET", "/api/projects/my-project/issues/invalid");

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      project: "my-project",
      number: "invalid",
    });

    expect(result.status).toBe(400);
  });
});
