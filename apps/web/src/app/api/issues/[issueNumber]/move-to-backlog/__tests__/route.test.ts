/**
 * Tests for Move to Backlog Endpoint
 */

import { describe, it, expect } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { createTestContainer, createTestRequest, runTestEndpoint } from "@/lib/di/test-utils";
import { EntityNotFoundError, Issue } from "@dev-workflow/tracking";
import { endpoint } from "../endpoint";

describe("moveToBacklogEndpoint", () => {
  it("activates a PLANNED issue to OPEN", async () => {
    const plannedTasks = [
      { id: "task-1", number: 1, title: "Task 1", status: "PLANNED" },
      { id: "task-2", number: 2, title: "Task 2", status: "PLANNED" },
    ];

    const issuesMock = {
      getByNumber: () =>
        Effect.succeed(
          Issue.from({ id: "issue-1", number: 42, title: "Test Issue", status: "PLANNED" } as Issue)
        ),
      updateStatus: () =>
        Effect.succeed(
          Issue.from({ id: "issue-1", number: 42, title: "Test Issue", status: "OPEN" } as Issue)
        ),
    };
    const tasksMock = {
      findByPlanId: () => Effect.succeed(plannedTasks),
      moveToBacklog: () => Effect.succeed({}),
    };

    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            issues: issuesMock,
            plans: {
              findByIssueId: () => Effect.succeed({ id: "plan-1", issueId: "issue-1" }),
            },
            tasks: tasksMock,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
            transaction: (fn: Function) => fn({ issues: issuesMock, tasks: tasksMock }),
          }),
      },
    });

    const req = createTestRequest("POST", "/api/issues/42/move-to-backlog", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "42",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.issue.number).toBe(42);
    expect(body.issue.status).toBe("OPEN");
    expect(body.previousStatus).toBe("PLANNED");
    expect(body.tasksActivated).toBe(2);
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

    const req = createTestRequest("POST", "/api/issues/999/move-to-backlog", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "999",
    });

    expect(result.status).toBe(404);
    const body = await result.json();
    expect(body.code).toBe("ENTITY_NOT_FOUND");
  });

  it("returns 422 when issue is not PLANNED", async () => {
    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            issues: {
              getByNumber: () =>
                Effect.succeed(Issue.from({ id: "issue-1", number: 42, status: "OPEN" } as Issue)),
            },
          }),
      },
    });

    const req = createTestRequest("POST", "/api/issues/42/move-to-backlog", {
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
              getByNumber: () =>
                Effect.succeed(
                  Issue.from({ id: "issue-1", number: 42, status: "PLANNED" } as Issue)
                ),
            },
            plans: {
              findByIssueId: () => Effect.succeed(null),
            },
          }),
      },
    });

    const req = createTestRequest("POST", "/api/issues/42/move-to-backlog", {
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

    const req = createTestRequest("POST", "/api/issues/42/move-to-backlog", {
      body: {},
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "42",
    });

    expect(result.status).toBe(400);
  });
});
