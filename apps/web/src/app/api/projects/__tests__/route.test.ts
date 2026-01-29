/**
 * Tests for List Projects Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { buildTestContainer, createTestRequest, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "../route";

describe("listProjectsEndpoint", () => {
  it("returns all projects with GitHub sync info", async () => {
    const mockProjects = [
      {
        id: "project-1",
        name: "Project One",
        slug: "project-one-abc123",
        gitRoot: "/path/to/project-one",
        syncConfig: { enabled: true, repo: "owner/repo" },
      },
      {
        id: "project-2",
        name: "Project Two",
        slug: "project-two-def456",
        gitRoot: "/path/to/project-two",
        syncConfig: null,
      },
    ];

    const testContainer = buildTestContainer({
      projectAppService: {
        listProjectsWithSync: vi.fn().mockResolvedValue(mockProjects),
      },
    });

    const req = createTestRequest("GET", "/api/projects");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.projects).toHaveLength(2);
    expect(body.projects[0].name).toBe("Project One");
    expect(body.projects[0].syncConfig).toEqual({ enabled: true, repo: "owner/repo" });
    expect(body.projects[1].syncConfig).toBeNull();
  });

  it("returns empty array when no projects", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        listProjectsWithSync: vi.fn().mockResolvedValue([]),
      },
    });

    const req = createTestRequest("GET", "/api/projects");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.projects).toHaveLength(0);
  });
});
