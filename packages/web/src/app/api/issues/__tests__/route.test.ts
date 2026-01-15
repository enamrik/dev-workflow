/**
 * Tests for List Issues Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { buildTestContainer, createTestRequest, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "../route";

describe("listIssuesEndpoint", () => {
  it("returns all issues with plan info", async () => {
    const mockIssues = [
      {
        issue: { id: "issue-1", number: 1, title: "Issue One", projectId: "proj-1" },
        hasPlan: true,
        taskCounts: { total: 3, completed: 1, inProgress: 1, remaining: 1 },
        computedStatus: "IN_PROGRESS",
        projectName: "Project One",
        projectSlug: "project-one",
      },
      {
        issue: { id: "issue-2", number: 2, title: "Issue Two", projectId: "proj-1" },
        hasPlan: false,
        computedStatus: "PLANNED",
        projectName: "Project One",
        projectSlug: "project-one",
      },
    ];

    const testContainer = buildTestContainer({
      projectAppService: {
        listAllIssues: vi.fn().mockResolvedValue(mockIssues),
      },
    });

    const req = createTestRequest("GET", "/api/issues");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(2);
    expect(body[0].issue.title).toBe("Issue One");
    expect(body[0].hasPlan).toBe(true);
    expect(body[1].hasPlan).toBe(false);
  });

  it("filters by project when query param provided", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        listAllIssues: vi.fn().mockResolvedValue([]),
      },
    });

    const req = createTestRequest("GET", "/api/issues?project=my-project");

    await runTestApiEndpoint(req, endpoint, testContainer, {});

    const service = testContainer.resolve("projectAppService") as any;
    expect(service.listAllIssues).toHaveBeenCalledWith("my-project");
  });

  it("returns empty array when no issues", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        listAllIssues: vi.fn().mockResolvedValue([]),
      },
    });

    const req = createTestRequest("GET", "/api/issues");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(0);
  });
});
