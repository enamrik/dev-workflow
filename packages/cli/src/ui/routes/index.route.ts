import type { FastifyInstance } from "fastify";
import type { SqliteIssueRepository } from "@dev-workflow/mcp-server/infrastructure/issue-repository.js";
import { renderLayout } from "../templates/layout.js";
import { renderIssuesList, render404 } from "../templates/issues-list.js";
import { renderIssueDetail } from "../templates/issue-detail.js";

export function registerHTMLRoutes(
  server: FastifyInstance,
  repository: SqliteIssueRepository
): void {
  // Home page - issues list
  server.get("/", async (_request, reply) => {
    const issues = repository.findMany();
    const content = renderIssuesList(issues);
    const html = renderLayout("Issues", content);
    reply.type("text/html").send(html);
  });

  // Issue detail page
  server.get("/issues/:number", async (request, reply) => {
    const { number } = request.params as { number: string };
    const issue = repository.findByNumber(parseInt(number, 10));

    if (!issue) {
      reply.code(404);
      const content = render404();
      const html = renderLayout("Not Found", content);
      return reply.type("text/html").send(html);
    }

    const content = renderIssueDetail(issue);
    const html = renderLayout(`Issue #${issue.number}`, content);
    reply.type("text/html").send(html);
  });
}
