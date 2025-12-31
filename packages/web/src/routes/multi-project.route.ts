import type { FastifyInstance } from "fastify";
import { renderLayout } from "../templates/layout.js";
import { renderMultiProjectIssuesList } from "../templates/multi-project-issues-list.js";
import { renderMultiProjectKanbanBoard } from "../templates/multi-project-kanban-board.js";
import { render404 } from "../templates/issues-list.js";
import { renderIssueDetail } from "../templates/issue-detail.js";
import type {
  MultiProjectService,
  Project,
} from "../application/multi-project-service.js";

export interface MultiProjectContext {
  multiProjectService: MultiProjectService;
}

interface BoardQuerystring {
  issue?: string;
  project?: string;
}

interface IssueQuerystring {
  tab?: string;
}

interface IssuesQuerystring {
  project?: string;
}

interface IssueParams {
  project: string;
  number: string;
}

export function registerMultiProjectRoutes(
  server: FastifyInstance,
  context: MultiProjectContext
): void {
  const { multiProjectService } = context;

  // Projects list (API endpoint)
  server.get("/api/projects", async () => {
    const projects = await multiProjectService.listProjects();
    return projects;
  });

  // Home page - issues list across all projects
  server.get<{ Querystring: IssuesQuerystring }>("/", async (request, reply) => {
    const { project: projectFilter } = request.query;
    const projects = await multiProjectService.listProjects();
    const issues = await multiProjectService.listIssues(projectFilter);

    const content = renderMultiProjectIssuesList(issues, projects, projectFilter);
    const html = renderLayout("Issues", content);
    reply.type("text/html").send(html);
  });

  // Issue detail page (with project context)
  server.get<{ Params: IssueParams; Querystring: IssueQuerystring }>(
    "/projects/:project/issues/:number",
    async (request, reply) => {
      const { project: projectId, number } = request.params;
      const { tab } = request.query;
      const issueNumber = parseInt(number, 10);

      const result = await multiProjectService.getIssue(projectId, issueNumber);

      if (!result) {
        reply.code(404);
        const content = render404();
        const html = renderLayout("Not Found", content);
        return reply.type("text/html").send(html);
      }

      const { issue, plan, tasks } = result;

      // Validate tab parameter
      const validTabs = ["details", "plan", "tasks"] as const;
      const activeTab = validTabs.includes(tab as typeof validTabs[number])
        ? (tab as typeof validTabs[number])
        : "details";

      const content = renderIssueDetail({
        issue,
        plan: plan ?? undefined,
        tasks,
        activeTab,
        projectId,
      });
      const html = renderLayout(`Issue #${issue.number}`, content);
      reply.type("text/html").send(html);
    }
  );

  // Kanban board page - shows tasks across all projects
  server.get<{ Querystring: BoardQuerystring }>("/board", async (request, reply) => {
    const { issue: issueFilter, project: projectFilter } = request.query;
    const filterIssueNumber = issueFilter ? parseInt(issueFilter, 10) : undefined;
    const projects = await multiProjectService.listProjects();

    const issuesWithTasks = await multiProjectService.listTasks(
      projectFilter,
      filterIssueNumber
    );

    const content = renderMultiProjectKanbanBoard(
      issuesWithTasks,
      projects,
      projectFilter,
      filterIssueNumber
    );
    const pageTitle = filterIssueNumber
      ? `Tasks for Issue #${filterIssueNumber}`
      : "Task Board";
    const html = renderLayout(pageTitle, content);
    reply.type("text/html").send(html);
  });

  // API: List issues with project filter
  server.get<{ Querystring: IssuesQuerystring }>("/api/issues", async (request) => {
    const { project: projectFilter } = request.query;
    const issues = await multiProjectService.listIssues(projectFilter);
    return issues;
  });
}
