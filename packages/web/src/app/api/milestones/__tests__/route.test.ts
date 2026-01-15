/**
 * Tests for List Milestones Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { buildTestContainer, createTestRequest, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "../route";

describe("listMilestonesEndpoint", () => {
  it("returns milestones with issue details and progress", async () => {
    const mockResult = [
      {
        milestone: {
          id: "milestone-1",
          number: 1,
          title: "Sprint 1",
          description: "First sprint",
          startDate: "2024-01-01",
          endDate: "2024-01-14",
          status: "IN_PROGRESS",
          projectId: "proj-1",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          projectName: "Project One",
          projectSlug: "project-one",
        },
        issues: [
          {
            number: 1,
            title: "Issue One",
            status: "OPEN",
            computedStatus: "IN_PROGRESS",
            type: "FEATURE",
          },
          {
            number: 2,
            title: "Issue Two",
            status: "CLOSED",
            computedStatus: "CLOSED",
            type: "BUG",
          },
        ],
        progress: {
          total: 2,
          closed: 1,
          percentage: 50,
        },
      },
    ];

    const testContainer = buildTestContainer({
      projectAppService: {
        getMilestonesWithDetails: vi.fn().mockResolvedValue(mockResult),
      },
    });

    const req = createTestRequest("GET", "/api/milestones");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(1);
    expect(body[0].milestone.title).toBe("Sprint 1");
    expect(body[0].issues).toHaveLength(2);
    expect(body[0].progress.percentage).toBe(50);
  });

  it("filters by project when query param provided", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        getMilestonesWithDetails: vi.fn().mockResolvedValue([]),
      },
    });

    const req = createTestRequest("GET", "/api/milestones?project=my-project");

    await runTestApiEndpoint(req, endpoint, testContainer, {});

    const service = testContainer.resolve("projectAppService") as any;
    expect(service.getMilestonesWithDetails).toHaveBeenCalledWith("my-project", undefined);
  });

  it("filters by source when query param provided", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        getMilestonesWithDetails: vi.fn().mockResolvedValue([]),
      },
    });

    const req = createTestRequest("GET", "/api/milestones?source=my-source");

    await runTestApiEndpoint(req, endpoint, testContainer, {});

    const service = testContainer.resolve("projectAppService") as any;
    expect(service.getMilestonesWithDetails).toHaveBeenCalledWith(undefined, "my-source");
  });

  it("returns empty array when no milestones", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        getMilestonesWithDetails: vi.fn().mockResolvedValue([]),
      },
    });

    const req = createTestRequest("GET", "/api/milestones");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toHaveLength(0);
  });
});
