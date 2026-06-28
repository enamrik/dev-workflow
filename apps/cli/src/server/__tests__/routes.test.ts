import { describe, it, expect } from "vitest";
import { matchRoute } from "../routes.js";
import { taskLogs } from "../endpoints/task-logs.js";
import { taskHistory } from "../endpoints/task-history.js";
import { taskDependencies } from "../endpoints/task-dependencies.js";

describe("matchRoute", () => {
  it("resolves the task execution logs route (regression: route was missing, causing the Details tab to hang)", () => {
    const match = matchRoute("GET", "/api/projects/my-project/tasks/task-123/logs");
    expect(match).not.toBeNull();
    expect(match!.program).toBe(taskLogs);
    expect(match!.params).toMatchObject({ project: "my-project", taskId: "task-123" });
  });

  it("resolves the task history route", () => {
    const match = matchRoute("GET", "/api/projects/my-project/tasks/task-123/history");
    expect(match!.program).toBe(taskHistory);
    expect(match!.params).toMatchObject({ taskId: "task-123" });
  });

  it("resolves the task dependencies route", () => {
    const match = matchRoute("GET", "/api/projects/my-project/tasks/task-123/dependencies");
    expect(match!.program).toBe(taskDependencies);
    expect(match!.params).toMatchObject({ taskId: "task-123" });
  });

  it("URL-decodes path params", () => {
    const match = matchRoute("GET", "/api/projects/my%20project/tasks/task-123/logs");
    expect(match!.params["project"]).toBe("my project");
  });

  it("returns null for an unknown route", () => {
    expect(matchRoute("GET", "/api/projects/p/tasks/t/nonexistent")).toBeNull();
  });

  it("does not match when the HTTP method differs", () => {
    expect(matchRoute("POST", "/api/projects/p/tasks/t/logs")).toBeNull();
  });
});
