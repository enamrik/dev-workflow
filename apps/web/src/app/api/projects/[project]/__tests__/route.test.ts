/**
 * Tests for Get Project Endpoint
 */

import { describe, it, expect } from "vitest";
import { EntityNotFoundError } from "@dev-workflow/tracking";
import { createTestContainer, createTestRequest, runTestEndpoint } from "@/lib/di/test-utils";

import { endpoint } from "../route";

const mockProject = {
  projectId: "proj-1",
  slug: "project-one",
  name: "Project One",
  sourceInfo: { connectionString: "test://db" },
  gitRoot: "/test/project",
};

describe("getProjectEndpoint", () => {
  it("returns project info by slug", async () => {
    const testContainer = createTestContainer({
      projectsResolver: {
        getProjectBySlug: async (slug: string) => {
          if (slug === "project-one") return mockProject;
          throw new EntityNotFoundError("Project", slug);
        },
      },
    });

    const req = createTestRequest("GET", "/api/projects/project-one");

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      project: "project-one",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.name).toBe("Project One");
    expect(body.slug).toBe("project-one");
  });

  it("returns 404 when project not found", async () => {
    const testContainer = createTestContainer({
      projectsResolver: {
        getProjectBySlug: async (slug: string) => {
          throw new EntityNotFoundError("Project", slug);
        },
      },
    });

    const req = createTestRequest("GET", "/api/projects/not-found");

    const result = await runTestEndpoint(testContainer, endpoint, req, {
      project: "not-found",
    });

    expect(result.status).toBe(404);
    const body = await result.json();
    expect(body.error).toBeDefined();
  });
});
