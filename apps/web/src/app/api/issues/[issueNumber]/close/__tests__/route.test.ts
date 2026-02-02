/**
 * Tests for Close Issue Endpoint
 */

import { describe, it, expect } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { createTestContainer, createTestRequest, runTestEndpoint } from "@/lib/di/test-utils";
import { EntityNotFoundError } from "@dev-workflow/tracking";
import { endpoint } from "../endpoint";

describe("closeIssueEndpoint", () => {
  it("closes an issue and returns result", async () => {
    const issuesMock = {
      getByNumber: () =>
        Effect.succeed({ id: "issue-1", number: 42, title: "Test Issue", status: "OPEN" }),
      close: () =>
        Effect.succeed({ id: "issue-1", number: 42, title: "Test Issue", status: "CLOSED" }),
      update: () => Effect.succeed(undefined),
    };
    const tasksMock = {
      getIncompleteTasksForIssue: () => Effect.succeed([]),
    };

    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            issues: issuesMock,
            tasks: tasksMock,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
            transaction: (fn: Function) => fn({ issues: issuesMock, tasks: tasksMock }),
          }),
      },
      projectManagement: {
        closeIssue: () => Effect.succeed(null),
      },
    });

    const req = createTestRequest("POST", "/api/issues/42/close", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "42",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.issue.status).toBe("CLOSED");
    expect(body.issue.number).toBe(42);
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

    const req = createTestRequest("POST", "/api/issues/999/close", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "999",
    });

    expect(result.status).toBe(404);
    const body = await result.json();
    expect(body.code).toBe("ENTITY_NOT_FOUND");
  });

  it("returns 400 when validation fails", async () => {
    const testContainer = createTestContainer({});

    const req = createTestRequest("POST", "/api/issues/42/close", {
      body: {},
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "42",
    });

    expect(result.status).toBe(400);
  });

  it("returns abandoned tasks when closing with incomplete tasks", async () => {
    const incompleteTasks = [
      { id: "task-1", number: 1, title: "Incomplete Task", status: "IN_PROGRESS" },
      { id: "task-2", number: 2, title: "Another Task", status: "READY" },
    ];

    const issuesMock = {
      getByNumber: () =>
        Effect.succeed({
          id: "issue-1",
          number: 42,
          title: "Test Issue",
          status: "OPEN",
          syncState: { externalId: "gh-123" },
        }),
      close: () =>
        Effect.succeed({ id: "issue-1", number: 42, title: "Test Issue", status: "CLOSED" }),
      update: () => Effect.succeed(undefined),
    };
    const tasksMock = {
      getIncompleteTasksForIssue: () => Effect.succeed(incompleteTasks),
      abandon: (id: string) =>
        Effect.succeed({ ...incompleteTasks.find((t) => t.id === id)!, status: "ABANDONED" }),
    };

    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            issues: issuesMock,
            tasks: tasksMock,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
            transaction: (fn: Function) => fn({ issues: issuesMock, tasks: tasksMock }),
          }),
      },
      projectManagement: {
        closeIssue: () => Effect.succeed(null),
      },
    });

    const req = createTestRequest("POST", "/api/issues/42/close", {
      body: { projectSlug: "my-project", force: true },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "42",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.abandonedTasks).toHaveLength(2);
    expect(body.externalIssueClosed).toBe(true);
  });
});
