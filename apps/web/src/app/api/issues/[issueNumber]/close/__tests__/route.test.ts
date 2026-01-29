/**
 * Tests for Close Issue Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { EntityNotFoundError } from "@dev-workflow/tracking";
import { buildTestContainer, createTestRequest, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "../route";

describe("closeIssueEndpoint", () => {
  it("closes an issue and returns success", async () => {
    const mockCloseResult = {
      issue: { id: "issue-1", number: 42, title: "Test Issue", status: "CLOSED" },
      abandonedTasks: [],
      externalIssueClosed: false,
    };

    const testContainer = buildTestContainer({
      issueAppService: {
        closeIssue: vi.fn().mockResolvedValue(mockCloseResult),
      },
    });

    const req = createTestRequest("POST", "/api/issues/42/close", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      issueNumber: "42",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.success).toBe(true);
    expect(body.issue.status).toBe("CLOSED");
    expect(body.issue.number).toBe(42);
  });

  it("returns 404 when issue not found", async () => {
    const testContainer = buildTestContainer({
      issueAppService: {
        closeIssue: vi.fn().mockRejectedValue(new EntityNotFoundError("Issue", "#999")),
      },
    });

    const req = createTestRequest("POST", "/api/issues/999/close", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      issueNumber: "999",
    });

    expect(result.status).toBe(404);
    const body = await result.json();
    expect(body.code).toBe("ENTITY_NOT_FOUND");
  });

  it("returns 400 when validation fails", async () => {
    const testContainer = buildTestContainer({
      issueAppService: {
        closeIssue: vi.fn(),
      },
    });

    // Missing projectSlug
    const req = createTestRequest("POST", "/api/issues/42/close", {
      body: {},
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      issueNumber: "42",
    });

    expect(result.status).toBe(400);
    const body = await result.json();
    expect(body.code).toBe("ZOD_VALIDATION_ERROR");
  });

  it("returns abandoned tasks when closing with incomplete tasks", async () => {
    const mockCloseResult = {
      issue: { id: "issue-1", number: 42, title: "Test Issue", status: "CLOSED" },
      abandonedTasks: [
        { task: { id: "task-1", number: 1, title: "Incomplete Task" } },
        { task: { id: "task-2", number: 2, title: "Another Task" } },
      ],
      externalIssueClosed: true,
    };

    const testContainer = buildTestContainer({
      issueAppService: {
        closeIssue: vi.fn().mockResolvedValue(mockCloseResult),
      },
    });

    const req = createTestRequest("POST", "/api/issues/42/close", {
      body: { projectSlug: "my-project" },
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      issueNumber: "42",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.abandonedTasks).toHaveLength(2);
    expect(body.externalIssueClosed).toBe(true);
  });
});
