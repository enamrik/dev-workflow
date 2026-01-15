/**
 * Tests for Get Project Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { EntityNotFoundError } from "@dev-workflow/core";
import { buildTestContainer, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "./route";

describe("getProjectEndpoint", () => {
  it("returns project info by slug", async () => {
    const mockProject = {
      projectId: "proj-1",
      name: "Project One",
      slug: "project-one",
      sourceInfo: { type: "sqlite", path: "/path/to/db" },
      gitRoot: "/path/to/project",
    };

    const testContainer = buildTestContainer({
      projectAppService: {
        getProject: vi.fn().mockResolvedValue(mockProject),
      },
    });

    const req = new Request("http://localhost/api/projects/project-one", {
      method: "GET",
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      project: "project-one",
    });

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.name).toBe("Project One");
    expect(body.slug).toBe("project-one");

    const service = testContainer.resolve("projectAppService") as any;
    expect(service.getProject).toHaveBeenCalledWith("project-one");
  });

  it("returns 404 when project not found", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        getProject: vi.fn().mockRejectedValue(new EntityNotFoundError("Project", "not-found")),
      },
    });

    const req = new Request("http://localhost/api/projects/not-found", {
      method: "GET",
    });

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {
      project: "not-found",
    });

    expect(result.status).toBe(404);
    const body = await result.json();
    expect(body.error).toBeDefined();
  });
});
