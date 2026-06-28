/**
 * Declarative API route table.
 *
 * Maps HTTP method + path pattern → WebProgram. Patterns use `:param` segments
 * matching the Next.js `[param]` directory names, so existing UI fetches keep
 * working unchanged.
 */

import type { WebProgram } from "./bootstrap.js";

import { listIssues } from "./endpoints/list-issues.js";
import { closeIssueEndpoint } from "./endpoints/close-issue.js";
import { deleteIssueEndpoint } from "./endpoints/delete-issue.js";
import { moveToBacklog } from "./endpoints/move-to-backlog.js";
import { moveToReady } from "./endpoints/move-to-ready.js";
import { milestones } from "./endpoints/milestones.js";
import { projects } from "./endpoints/projects.js";
import { getProjectEndpoint } from "./endpoints/get-project.js";
import { getIssueDetailsEndpoint } from "./endpoints/get-issue-details.js";
import { taskDependencies } from "./endpoints/task-dependencies.js";
import { taskHistory } from "./endpoints/task-history.js";
import { taskLogs } from "./endpoints/task-logs.js";
import { listTasks } from "./endpoints/list-tasks.js";
import { abandonTaskEndpoint } from "./endpoints/abandon-task.js";
import { transitionTaskEndpoint } from "./endpoints/transition-task.js";
import { workers } from "./endpoints/workers.js";
import { listWorktrees, pruneWorktreesEndpoint } from "./endpoints/worktrees.js";

export interface RouteEntry {
  method: string;
  pattern: string;
  program: WebProgram<unknown>;
}

export const routes: RouteEntry[] = [
  { method: "GET", pattern: "/api/issues", program: listIssues },
  { method: "POST", pattern: "/api/issues/:issueNumber/close", program: closeIssueEndpoint },
  { method: "DELETE", pattern: "/api/issues/:issueNumber/delete", program: deleteIssueEndpoint },
  { method: "POST", pattern: "/api/issues/:issueNumber/move-to-backlog", program: moveToBacklog },
  { method: "POST", pattern: "/api/issues/:issueNumber/move-to-ready", program: moveToReady },
  { method: "GET", pattern: "/api/milestones", program: milestones },
  { method: "GET", pattern: "/api/projects", program: projects },
  { method: "GET", pattern: "/api/projects/:project", program: getProjectEndpoint },
  {
    method: "GET",
    pattern: "/api/projects/:project/issues/:number",
    program: getIssueDetailsEndpoint,
  },
  {
    method: "GET",
    pattern: "/api/projects/:project/tasks/:taskId/dependencies",
    program: taskDependencies,
  },
  {
    method: "GET",
    pattern: "/api/projects/:project/tasks/:taskId/history",
    program: taskHistory,
  },
  {
    method: "GET",
    pattern: "/api/projects/:project/tasks/:taskId/logs",
    program: taskLogs,
  },
  { method: "GET", pattern: "/api/tasks", program: listTasks },
  { method: "POST", pattern: "/api/tasks/:taskId/abandon", program: abandonTaskEndpoint },
  { method: "POST", pattern: "/api/tasks/:taskId/transition", program: transitionTaskEndpoint },
  { method: "GET", pattern: "/api/workers", program: workers },
  { method: "GET", pattern: "/api/worktrees", program: listWorktrees },
  { method: "POST", pattern: "/api/worktrees", program: pruneWorktreesEndpoint },
];

export interface RouteMatch {
  program: WebProgram<unknown>;
  params: Record<string, string>;
}

/**
 * Match a method + pathname against the route table.
 * Returns the matched program and extracted path params, or null.
 */
export function matchRoute(method: string, pathname: string): RouteMatch | null {
  const pathSegments = pathname.split("/").filter((s) => s.length > 0);

  for (const route of routes) {
    if (route.method !== method) continue;

    const patternSegments = route.pattern.split("/").filter((s) => s.length > 0);
    if (patternSegments.length !== pathSegments.length) continue;

    const params: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < patternSegments.length; i++) {
      const patternSeg = patternSegments[i]!;
      const pathSeg = pathSegments[i]!;
      if (patternSeg.startsWith(":")) {
        params[patternSeg.slice(1)] = decodeURIComponent(pathSeg);
      } else if (patternSeg !== pathSeg) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return { program: route.program, params };
    }
  }

  return null;
}
