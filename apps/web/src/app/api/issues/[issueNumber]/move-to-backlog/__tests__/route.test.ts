/**
 * Tests for Move to Backlog Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { EntityNotFoundError, BusinessRuleError } from "@dev-workflow/tracking";
import { buildTestContainer, createTestRequest, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "../route";

describe("moveToBacklogEndpoint", () => {
  it("activates a PLANNED issue to OPEN", async () => {
    const mockResult = {
      issue: { id: "issue-1", number: 42, title: "Test Issue", status: "OPEN" },
      previousStatus: "PLANNED",
      tasksActivated: 2,
      tasks: [
        { id: "task-1", number: 1, title: "Task 1" },
        { id: "task-2", number: 2, title: "Task 2" },
      ],
    };

    const testContainer = buildTestContainer({
      issueAppService: {
        activateIssue: vi.fn().mockResolvedValue(mockResult),
      },
    });

    const req = createTestRequest("POST", "/api/issues/42/move-to-backlog", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      issueNumber: "42",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.success).toBe(true);
    expect(body.issue.number).toBe(42);
    expect(body.issue.previousStatus).toBe("PLANNED");
    expect(body.issue.newStatus).toBe("OPEN");
    expect(body.tasksActivated).toBe(2);
    expect(body.tasks).toHaveLength(2);
  });

  it("returns 404 when issue not found", async () => {
    const testContainer = buildTestContainer({
      issueAppService: {
        activateIssue: vi.fn().mockRejectedValue(new EntityNotFoundError("Issue", "#999")),
      },
    });

    const req = createTestRequest("POST", "/api/issues/999/move-to-backlog", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      issueNumber: "999",
    });

    expect(result.status).toBe(404);
    const body = await result.json();
    expect(body.code).toBe("ENTITY_NOT_FOUND");
  });

  it("returns 422 when issue is not PLANNED", async () => {
    const testContainer = buildTestContainer({
      issueAppService: {
        activateIssue: vi
          .fn()
          .mockRejectedValue(
            new BusinessRuleError(
              "Issue must be in PLANNED status to activate. Current status: OPEN"
            )
          ),
      },
    });

    const req = createTestRequest("POST", "/api/issues/42/move-to-backlog", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      issueNumber: "42",
    });

    expect(result.status).toBe(422);
    const body = await result.json();
    expect(body.code).toBe("BUSINESS_RULE_VIOLATION");
  });

  it("returns 422 when issue has no plan", async () => {
    const testContainer = buildTestContainer({
      issueAppService: {
        activateIssue: vi
          .fn()
          .mockRejectedValue(
            new BusinessRuleError("No plan found for this issue. Generate a plan first.")
          ),
      },
    });

    const req = createTestRequest("POST", "/api/issues/42/move-to-backlog", {
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
        activateIssue: vi.fn(),
      },
    });

    // Missing projectSlug
    const req = createTestRequest("POST", "/api/issues/42/move-to-backlog", {
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
