/**
 * Tests for Worktrees Endpoints
 */

import { describe, it, expect, vi } from "vitest";
import { buildTestContainer, runTestApiEndpoint } from "@/lib/di/test-utils";
import { listEndpoint, pruneEndpoint } from "./route";

describe("listWorktreesEndpoint", () => {
  it("returns worktrees with task details", async () => {
    const mockWorktrees = [
      {
        projectId: "proj-1",
        path: "/path/to/worktree",
        branch: "issue-5/task-1",
        head: "abc123",
        isMain: false,
        diskUsageBytes: 1024000,
        taskId: "task-1",
        taskNumber: 1,
        taskTitle: "Task One",
        taskStatus: "IN_PROGRESS",
        issueNumber: 5,
      },
    ];

    const testContainer = buildTestContainer({
      projectAppService: {
        getWorktreesWithTaskInfo: vi.fn().mockResolvedValue(mockWorktrees),
      },
    });

    const req = new Request("http://localhost/api/worktrees", {
      method: "GET",
    });

    const result = await runTestApiEndpoint(req, listEndpoint, testContainer, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.worktrees).toHaveLength(1);
    expect(body.worktrees[0].branch).toBe("issue-5/task-1");
    expect(body.worktrees[0].taskNumber).toBe(1);
  });

  it("filters by project when query param provided", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        getWorktreesWithTaskInfo: vi.fn().mockResolvedValue([]),
      },
    });

    const req = new Request("http://localhost/api/worktrees?project=my-project", {
      method: "GET",
    });

    await runTestApiEndpoint(req, listEndpoint, testContainer, {});

    const service = testContainer.resolve("projectAppService") as any;
    expect(service.getWorktreesWithTaskInfo).toHaveBeenCalledWith("my-project");
  });

  it("returns empty array when no worktrees", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        getWorktreesWithTaskInfo: vi.fn().mockResolvedValue([]),
      },
    });

    const req = new Request("http://localhost/api/worktrees", {
      method: "GET",
    });

    const result = await runTestApiEndpoint(req, listEndpoint, testContainer, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.worktrees).toHaveLength(0);
  });
});

describe("pruneWorktreesEndpoint", () => {
  it("prunes worktrees successfully", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        pruneWorktrees: vi.fn().mockResolvedValue({ success: true, pruned: 3 }),
      },
    });

    const req = new Request("http://localhost/api/worktrees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prune", projectId: "proj-1" }),
    });

    const result = await runTestApiEndpoint(req, pruneEndpoint, testContainer, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.success).toBe(true);
    expect(body.pruned).toBe(3);

    const service = testContainer.resolve("projectAppService") as any;
    expect(service.pruneWorktrees).toHaveBeenCalledWith("proj-1");
  });

  it("returns 400 for invalid action", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        pruneWorktrees: vi.fn(),
      },
    });

    const req = new Request("http://localhost/api/worktrees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "invalid", projectId: "proj-1" }),
    });

    const result = await runTestApiEndpoint(req, pruneEndpoint, testContainer, {});

    expect(result.status).toBe(400);
  });

  it("returns 400 when projectId is missing", async () => {
    const testContainer = buildTestContainer({
      projectAppService: {
        pruneWorktrees: vi.fn(),
      },
    });

    const req = new Request("http://localhost/api/worktrees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prune" }),
    });

    const result = await runTestApiEndpoint(req, pruneEndpoint, testContainer, {});

    expect(result.status).toBe(400);
  });
});
