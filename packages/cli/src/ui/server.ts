import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { SqliteIssueRepository } from "@dev-workflow/mcp-server/infrastructure/issue-repository.js";
import { registerHTMLRoutes } from "./routes/index.route.js";
import { registerAPIRoutes } from "./routes/api.route.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createServer(
  repository: SqliteIssueRepository
): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false, // Quiet mode for clean CLI output
  });

  // Register static files (CSS, JS)
  await server.register(fastifyStatic, {
    root: path.join(__dirname, "public"),
    prefix: "/",
  });

  // Register routes
  registerHTMLRoutes(server, repository);
  registerAPIRoutes(server, repository);

  return server;
}
