import type { FastifyInstance } from "fastify";
import type { SqliteIssueRepository, IssueFilters } from "@dev-workflow/core";

interface IssuesQuerystring {
  status?: string;
  type?: string;
  label?: string | string[];
}

interface IssueParams {
  number: string;
}

export function registerAPIRoutes(
  server: FastifyInstance,
  repository: SqliteIssueRepository
): void {
  // GET /api/issues - List all issues with optional filters
  server.get<{ Querystring: IssuesQuerystring }>("/api/issues", async (request) => {
    const { status, type, label } = request.query;

    const filters: IssueFilters = {};

    if (status) {
      filters.status = status as any;
    }

    if (type) {
      filters.type = type as any;
    }

    if (label) {
      filters.labels = Array.isArray(label) ? label : [label];
    }

    const issues = repository.findMany(filters);
    return issues;
  });

  // GET /api/issues/:number - Get single issue by number
  server.get<{ Params: IssueParams }>("/api/issues/:number", async (request, reply) => {
    const { number } = request.params;
    const issueNumber = parseInt(number, 10);

    if (isNaN(issueNumber)) {
      reply.code(400);
      return { error: "Invalid issue number" };
    }

    const issue = repository.findByNumber(issueNumber);

    if (!issue) {
      reply.code(404);
      return { error: "Issue not found" };
    }

    return issue;
  });
}
