import type { FastifyInstance } from "fastify";
import type {
  SqliteIssueRepository,
  SqlitePlanRepository,
  SqliteTaskRepository,
} from "@dev-workflow/core";
import { renderLayout } from "../templates/layout.js";
import { renderIssuesList, render404, type IssueWithPlanInfo } from "../templates/issues-list.js";
import { renderIssueDetail } from "../templates/issue-detail.js";
import { renderKanbanBoard } from "../templates/kanban-board.js";

export interface RepositoryContext {
  issueRepository: SqliteIssueRepository;
  planRepository: SqlitePlanRepository;
  taskRepository: SqliteTaskRepository;
}

interface BoardQuerystring {
  issue?: string;
}

interface IssueQuerystring {
  tab?: string;
}

export function registerHTMLRoutes(
  server: FastifyInstance,
  context: RepositoryContext
): void {
  const { issueRepository, planRepository, taskRepository } = context;

  // Home page - kanban board showing tasks
  server.get<{ Querystring: BoardQuerystring }>("/", async (request, reply) => {
    const { issue: issueFilter } = request.query;
    const filterIssueNumber = issueFilter ? parseInt(issueFilter, 10) : undefined;

    // Get issues (filtered or all)
    let issues = issueRepository.findMany();
    if (filterIssueNumber) {
      issues = issues.filter((i) => i.number === filterIssueNumber);
    }

    const issuesWithTasks: Array<{
      issue: typeof issues[0];
      plan: ReturnType<typeof planRepository.findByIssueId>;
      tasks: ReturnType<typeof taskRepository.findByPlanId>;
    }> = [];

    for (const issue of issues) {
      const plan = planRepository.findByIssueId(issue.id);
      if (plan) {
        const tasks = taskRepository.findByPlanId(plan.id);
        if (tasks.length > 0) {
          issuesWithTasks.push({ issue, plan, tasks });
        }
      }
    }

    const content = renderKanbanBoard(issuesWithTasks, filterIssueNumber);
    const pageTitle = filterIssueNumber ? `Tasks for Issue #${filterIssueNumber}` : "Task Board";
    const html = renderLayout(pageTitle, content);
    reply.type("text/html").send(html);
  });

  // Issues list page
  server.get("/issues", async (_request, reply) => {
    const issues = issueRepository.findMany();

    // Enrich with plan and task info
    const issuesWithPlans: IssueWithPlanInfo[] = issues.map((issue) => {
      const plan = planRepository.findByIssueId(issue.id);
      if (!plan) {
        return { issue, hasPlan: false };
      }

      const tasks = taskRepository.findByPlanId(plan.id);
      const taskCounts = {
        total: tasks.length,
        completed: tasks.filter((t) => t.status === "COMPLETED").length,
        inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").length,
      };

      return { issue, hasPlan: true, taskCounts };
    });

    const content = renderIssuesList(issuesWithPlans);
    const html = renderLayout("Issues", content);
    reply.type("text/html").send(html);
  });

  // Issue detail page
  server.get<{ Params: { number: string }; Querystring: IssueQuerystring }>(
    "/issues/:number",
    async (request, reply) => {
      const { number } = request.params;
      const { tab } = request.query;
      const issue = issueRepository.findByNumber(parseInt(number, 10));

      if (!issue) {
        reply.code(404);
        const content = render404();
        const html = renderLayout("Not Found", content);
        return reply.type("text/html").send(html);
      }

      // Fetch plan and tasks for this issue
      const plan = planRepository.findByIssueId(issue.id);
      const tasks = plan ? taskRepository.findByPlanId(plan.id) : [];

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
      });
      const html = renderLayout(`Issue #${issue.number}`, content);
      reply.type("text/html").send(html);
    }
  );

}
