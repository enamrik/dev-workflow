import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type { EventBus } from "@dev-workflow/core";
import { registerHTMLRoutes, type RepositoryContext } from "./routes/index.route.js";
import { registerAPIRoutes } from "./routes/api.route.js";
import { registerMultiProjectRoutes } from "./routes/multi-project.route.js";
import { WebSocketHandler } from "./infrastructure/websocket/websocket-handler.js";
import { WebSocketBridge } from "./infrastructure/websocket/websocket-bridge.js";
import { MultiProjectService } from "./application/multi-project-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Single-project server context (current behavior)
 */
export interface ServerContext extends RepositoryContext {
  eventBus?: EventBus;
}

/**
 * Multi-project server context (for daemon mode)
 */
export interface MultiProjectServerContext {
  multiProjectService: MultiProjectService;
  eventBus?: EventBus;
}

/**
 * Create a single-project server (for backward compatibility)
 */
export async function createServer(
  context: ServerContext
): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false, // Quiet mode for clean CLI output
  });

  // Register static files (CSS, JS)
  await server.register(fastifyStatic, {
    root: path.join(__dirname, "public"),
    prefix: "/",
  });

  // Register WebSocket plugin and routes if EventBus is provided
  if (context.eventBus) {
    await server.register(fastifyWebsocket);

    const wsHandler = new WebSocketHandler();
    wsHandler.registerRoutes(server);

    const wsBridge = new WebSocketBridge(context.eventBus, wsHandler);
    wsBridge.start();
  }

  // Register routes
  registerHTMLRoutes(server, context);
  registerAPIRoutes(server, context.issueRepository);

  return server;
}

/**
 * Create a multi-project server (for daemon mode)
 * Shows issues and tasks across all projects
 */
export async function createMultiProjectServer(
  context: MultiProjectServerContext
): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false, // Quiet mode for clean CLI output
  });

  // Register static files (CSS, JS)
  await server.register(fastifyStatic, {
    root: path.join(__dirname, "public"),
    prefix: "/",
  });

  // Register WebSocket plugin and routes if EventBus is provided
  if (context.eventBus) {
    await server.register(fastifyWebsocket);

    const wsHandler = new WebSocketHandler();
    wsHandler.registerRoutes(server);

    const wsBridge = new WebSocketBridge(context.eventBus, wsHandler);
    wsBridge.start();
  }

  // Register multi-project routes
  registerMultiProjectRoutes(server, context);

  return server;
}
