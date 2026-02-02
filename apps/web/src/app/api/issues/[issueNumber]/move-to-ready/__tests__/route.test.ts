/**
 * Tests for Move to Ready Endpoint
 */

import { describe, it, expect } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { createTestContainer, createTestRequest, runTestEndpoint } from "@/lib/di/test-utils";
import { EntityNotFoundError } from "@dev-workflow/tracking";
import { endpoint } from "../endpoint";

describe("moveToReadyEndpoint", () => {
  it("moves BACKLOG tasks to READY for an OPEN issue", async () => {
    const backlogTasks = [
      { id: "task-1", number: 1, title: "Task 1", status: "BACKLOG" },
      { id: "task-2", number: 2, title: "Task 2", status: "BACKLOG" },
    ];

    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            issues: {
              getByNumber: () =>
                Effect.succeed({ id: "issue-1", number: 42, title: "Test Issue", status: "OPEN" }),
            },
            plans: {
              findByIssueId: () => Effect.succeed({ id: "plan-1", issueId: "issue-1" }),
            },
            tasks: {
              findByPlanId: () => Effect.succeed(backlogTasks),
              moveToReady: () => Effect.succeed({}),
            },
          }),
      },
    });

    const req = createTestRequest("POST", "/api/issues/42/move-to-ready", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "42",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.issue.number).toBe(42);
    expect(body.tasksUpdated).toBe(2);
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

    const req = createTestRequest("POST", "/api/issues/999/move-to-ready", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "999",
    });

    expect(result.status).toBe(404);
    const body = await result.json();
    expect(body.code).toBe("ENTITY_NOT_FOUND");
  });

  it("returns 422 when issue is not OPEN", async () => {
    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            issues: {
              getByNumber: () => Effect.succeed({ id: "issue-1", number: 42, status: "CLOSED" }),
            },
          }),
      },
    });

    const req = createTestRequest("POST", "/api/issues/42/move-to-ready", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "42",
    });

    expect(result.status).toBe(422);
    const body = await result.json();
    expect(body.code).toBe("BUSINESS_RULE_VIOLATION");
  });

  it("returns 422 when issue has no plan", async () => {
    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            issues: {
              getByNumber: () => Effect.succeed({ id: "issue-1", number: 42, status: "OPEN" }),
            },
            plans: {
              findByIssueId: () => Effect.succeed(null),
            },
          }),
      },
    });

    const req = createTestRequest("POST", "/api/issues/42/move-to-ready", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "42",
    });

    expect(result.status).toBe(422);
    const body = await result.json();
    expect(body.code).toBe("BUSINESS_RULE_VIOLATION");
  });

  it("returns 400 when validation fails", async () => {
    const testContainer = createTestContainer({});

    const req = createTestRequest("POST", "/api/issues/42/move-to-ready", {
      body: {},
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "42",
    });

    expect(result.status).toBe(400);
  });
});
