/**
 * Tests for List Projects Endpoint
 */

import { describe, it, expect } from "vitest";
import { Effect } from "@dev-workflow/effect";
import {
  createTestContainer,
  createTestRequest,
  createMockSourceProvider,
  runTestEndpoint,
} from "@/lib/di/test-utils";

import { endpoint } from "../route";

describe("listProjectsEndpoint", () => {
  it("returns all projects with GitHub sync info", async () => {
    const enrichedProjects = [
      {
        projectId: "project-1",
        name: "Project One",
        slug: "project-one-abc123",
        gitRoot: "/path/to/project-one",
        sourceInfo: { connectionString: "test://db" },
        syncConfig: { enabled: true, repo: "owner/repo" },
      },
      {
        projectId: "project-2",
        name: "Project Two",
        slug: "project-two-def456",
        gitRoot: "/path/to/project-two",
        sourceInfo: { connectionString: "test://db" },
        syncConfig: null,
      },
    ];

    const testContainer = createTestContainer({
      projectsResolver: {
        getAllProjects: () => Effect.succeed(enrichedProjects),
        enrichWithDbData: () => Effect.succeed(enrichedProjects),
      },
      sourceProvider: createMockSourceProvider({}),
    });

    const req = createTestRequest("GET", "/api/projects");

    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.projects).toHaveLength(2);
    expect(body.projects[0].name).toBe("Project One");
    expect(body.projects[0].syncConfig).toEqual({ enabled: true, repo: "owner/repo" });
    expect(body.projects[1].syncConfig).toBeNull();
  });

  it("returns empty array when no projects", async () => {
    const testContainer = createTestContainer({
      projectsResolver: {
        getAllProjects: () => Effect.succeed([]),
        enrichWithDbData: () => Effect.succeed([]),
      },
      sourceProvider: createMockSourceProvider({}),
    });

    const req = createTestRequest("GET", "/api/projects");

    const result = await runTestEndpoint(testContainer, endpoint, req, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.projects).toHaveLength(0);
  });
});
