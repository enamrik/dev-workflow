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
import { DatabaseChangeMonitor } from "./infrastructure/database-change-monitor.js";
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
  /** Path to the SQLite database for cross-process change detection */
  databasePath?: string;
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
 * Result of creating a multi-project server
 */
export interface MultiProjectServerResult {
  server: FastifyInstance;
  /** Cleanup function to stop monitors and bridges */
  cleanup: () => void;
}

/**
 * Create a multi-project server (for daemon mode)
 * Shows issues and tasks across all projects
 */
export async function createMultiProjectServer(
  context: MultiProjectServerContext
): Promise<MultiProjectServerResult> {
  const server = Fastify({
    logger: false, // Quiet mode for clean CLI output
  });

  // Register static files (CSS, JS)
  await server.register(fastifyStatic, {
    root: path.join(__dirname, "public"),
    prefix: "/",
  });

  // Track cleanup functions
  const cleanupFns: (() => void)[] = [];

  // Register WebSocket plugin
  await server.register(fastifyWebsocket);
  const wsHandler = new WebSocketHandler();
  wsHandler.registerRoutes(server);

  // Set up EventBus bridge if provided (for in-process events)
  if (context.eventBus) {
    const wsBridge = new WebSocketBridge(context.eventBus, wsHandler);
    wsBridge.start();
    cleanupFns.push(() => wsBridge.stop());
  }

  // Set up database change monitor for cross-process change detection
  if (context.databasePath) {
    const dbMonitor = new DatabaseChangeMonitor(context.databasePath, {
      pollIntervalMs: 1000, // Check every second
    });

    dbMonitor.on("change", () => {
      wsHandler.broadcastDatabaseChange();
    });

    dbMonitor.start();
    cleanupFns.push(() => dbMonitor.stop());
  }

  // Register multi-project routes
  registerMultiProjectRoutes(server, context);

  return {
    server,
    cleanup: () => {
      for (const fn of cleanupFns) {
        fn();
      }
    },
  };
}
