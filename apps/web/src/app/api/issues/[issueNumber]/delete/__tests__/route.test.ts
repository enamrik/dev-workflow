/**
 * Tests for Delete Issue Endpoint
 */

import { describe, it, expect } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { createTestContainer, createTestRequest, runTestEndpoint } from "@/lib/di/test-utils";
import { EntityNotFoundError, Issue } from "@dev-workflow/tracking";
import { endpoint } from "../endpoint";

describe("deleteIssueEndpoint", () => {
  it("deletes a PLANNED issue", async () => {
    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            issues: {
              getByNumber: () =>
                Effect.succeed(
                  Issue.from({
                    id: "issue-1",
                    number: 42,
                    title: "Test Issue",
                    status: "PLANNED",
                  } as Issue)
                ),
              delete: () =>
                Effect.succeed(
                  Issue.from({ id: "issue-1", number: 42, title: "Test Issue" } as Issue)
                ),
            },
            plans: {
              findByIssueId: () => Effect.succeed(null),
            },
          }),
      },
      gitWorktreeService: {},
      projectManagement: {
        closeIssue: () => Effect.succeed(undefined),
      },
      workerQueueDb: {
        remove: () => {},
      },
    });

    const req = createTestRequest("DELETE", "/api/issues/42/delete", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "42",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
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

    const req = createTestRequest("DELETE", "/api/issues/999/delete", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "999",
    });

    expect(result.status).toBe(404);
    const body = await result.json();
    expect(body.code).toBe("ENTITY_NOT_FOUND");
  });

  it("returns 422 when trying to delete non-PLANNED issue", async () => {
    const testContainer = createTestContainer({
      domain: {
        forProject: () =>
          Effect.succeed({
            issues: {
              getByNumber: () =>
                Effect.succeed(
                  Issue.from({
                    id: "issue-1",
                    number: 42,
                    title: "Test Issue",
                    status: "OPEN",
                  } as Issue)
                ),
            },
          }),
      },
    });

    const req = createTestRequest("DELETE", "/api/issues/42/delete", {
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

    const req = createTestRequest("DELETE", "/api/issues/42/delete", {
      body: {},
    });

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      issueNumber: "42",
    });

    expect(result.status).toBe(400);
  });
});
