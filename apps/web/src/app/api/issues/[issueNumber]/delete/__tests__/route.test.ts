/**
 * Tests for Delete Issue Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { EntityNotFoundError, BusinessRuleError } from "@dev-workflow/tracking";
import { buildTestContainer, createTestRequest, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "../route";

describe("deleteIssueEndpoint", () => {
  it("deletes a PLANNED issue", async () => {
    const mockDeletedIssue = {
      id: "issue-1",
      number: 42,
      title: "Test Issue",
    };

    const testContainer = buildTestContainer({
      issueAppService: {
        deleteIssue: vi.fn().mockResolvedValue(mockDeletedIssue),
      },
    });

    const req = createTestRequest("DELETE", "/api/issues/42/delete", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      issueNumber: "42",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.success).toBe(true);
    expect(body.issue.number).toBe(42);
  });

  it("returns 404 when issue not found", async () => {
    const testContainer = buildTestContainer({
      issueAppService: {
        deleteIssue: vi.fn().mockRejectedValue(new EntityNotFoundError("Issue", "#999")),
      },
    });

    const req = createTestRequest("DELETE", "/api/issues/999/delete", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      issueNumber: "999",
    });

    expect(result.status).toBe(404);
    const body = await result.json();
    expect(body.code).toBe("ENTITY_NOT_FOUND");
  });

  it("returns 422 when trying to delete non-PLANNED issue", async () => {
    const testContainer = buildTestContainer({
      issueAppService: {
        deleteIssue: vi
          .fn()
          .mockRejectedValue(
            new BusinessRuleError(
              "Only PLANNED issues can be deleted. Current status: OPEN. Use close_issue instead."
            )
          ),
      },
    });

    const req = createTestRequest("DELETE", "/api/issues/42/delete", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      issueNumber: "42",
    });

    expect(result.status).toBe(422);
    const body = await result.json();
    expect(body.code).toBe("BUSINESS_RULE_VIOLATION");
  });

  it("returns 400 when validation fails", async () => {
    const testContainer = buildTestContainer({
      issueAppService: {
        deleteIssue: vi.fn(),
      },
    });

    // Missing projectSlug
    const req = createTestRequest("DELETE", "/api/issues/42/delete", {
      body: {},
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      issueNumber: "42",
    });

    expect(result.status).toBe(400);
    const body = await result.json();
    expect(body.code).toBe("ZOD_VALIDATION_ERROR");
  });
});
