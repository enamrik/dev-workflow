/**
 * Tests for Get Issue with Details Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { EntityNotFoundError } from "@dev-workflow/tracking";
import { buildTestContainer, createTestRequest, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "../route";

describe("getIssueWithDetailsEndpoint", () => {
  it("returns issue with plan and tasks", async () => {
    const mockResult = {
      issue: {
        id: "issue-1",
        number: 5,
        title: "Issue Five",
        status: "OPEN",
        type: "FEATURE",
      },
      plan: {
        id: "plan-1",
        summary: "Plan summary",
      },
      tasks: [
        { id: "task-1", number: 1, title: "Task One", status: "READY" },
        { id: "task-2", number: 2, title: "Task Two", status: "IN_PROGRESS" },
      ],
    };

    const testContainer = buildTestContainer({
      issueAppService: {
        getIssueWithDetails: vi.fn().mockResolvedValue(mockResult),
      },
    });

    const req = createTestRequest("GET", "/api/projects/my-project/issues/5");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      project: "my-project",
      number: "5",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.issue.number).toBe(5);
    expect(body.plan).toBeDefined();
    expect(body.tasks).toHaveLength(2);

    const service = testContainer.resolve("issueAppService") as any;
    expect(service.getIssueWithDetails).toHaveBeenCalledWith("my-project", 5);
  });

  it("returns 404 when issue not found", async () => {
    const testContainer = buildTestContainer({
      issueAppService: {
        getIssueWithDetails: vi.fn().mockRejectedValue(new EntityNotFoundError("Issue", "#999")),
      },
    });

    const req = createTestRequest("GET", "/api/projects/my-project/issues/999");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      project: "my-project",
      number: "999",
    });

    expect(result.status).toBe(404);
    const body = await result.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 for invalid issue number", async () => {
    const testContainer = buildTestContainer({
      issueAppService: {
        getIssueWithDetails: vi.fn(),
      },
    });

    const req = createTestRequest("GET", "/api/projects/my-project/issues/invalid");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      project: "my-project",
      number: "invalid",
    });

    expect(result.status).toBe(400);
  });
});
