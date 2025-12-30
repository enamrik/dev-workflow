import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { registerHTMLRoutes, type RepositoryContext } from "./routes/index.route.js";
import { registerAPIRoutes } from "./routes/api.route.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createServer(
  context: RepositoryContext
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
  registerHTMLRoutes(server, context);
  registerAPIRoutes(server, context.issueRepository);

  return server;
}
