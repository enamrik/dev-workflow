/**
 * Tests for List Tasks Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { buildTestContainer, createTestRequest, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "../route";

describe("listTasksEndpoint", () => {
  it("returns issues with tasks for board view", async () => {
    const mockResult = {
      issuesWithTasks: [
        {
          issue: { id: "issue-1", number: 1, title: "Issue One" },
          plan: { id: "plan-1" },
          tasks: [
            { id: "task-1", number: 1, title: "Task 1", status: "IN_PROGRESS" },
            { id: "task-2", number: 2, title: "Task 2", status: "READY" },
          ],
          projectName: "Project One",
          projectSlug: "project-one",
        },
      ],
      completedTasks: [
        {
          id: "task-3",
          number: 3,
          title: "Completed Task",
          status: "COMPLETED",
          projectName: "Project One",
          projectSlug: "project-one",
          issueNumber: 1,
          issueTitle: "Issue One",
        },
      ],
    };

    const testContainer = buildTestContainer({
      projectAppService: {
        listAllTasksForBoard: vi.fn().mockResolvedValue(mockResult),
      },
    });

    const req = createTestRequest("GET", "/api/tasks");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.issuesWithTasks).toHaveLength(1);
    expect(body.issuesWithTasks[0].tasks).toHaveLength(2);
    expect(body.completedTasks).toHaveLength(1);
  });

  it("filters by project when query param provided", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        listAllTasksForBoard: vi
          .fn()
          .mockResolvedValue({ issuesWithTasks: [], completedTasks: [] }),
      },
    });

    const req = createTestRequest("GET", "/api/tasks?project=my-project");

    await runTestApiEndpoint(req, endpoint, testContainer, {});

    const service = testContainer.resolve("projectAppService") as any;
    expect(service.listAllTasksForBoard).toHaveBeenCalledWith("my-project");
  });

  it("returns empty arrays when no data", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        listAllTasksForBoard: vi
          .fn()
          .mockResolvedValue({ issuesWithTasks: [], completedTasks: [] }),
      },
    });

    const req = createTestRequest("GET", "/api/tasks");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.issuesWithTasks).toHaveLength(0);
    expect(body.completedTasks).toHaveLength(0);
  });
});
