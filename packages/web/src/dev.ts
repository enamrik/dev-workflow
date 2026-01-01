/**
 * Dev server with Vite HMR embedded in Fastify.
 * Single port serves both API and React client with hot reload.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import middie from "@fastify/middie";
import { createServer as createViteServer } from "vite";
import { MultiProjectService } from "./application/multi-project-service.js";
import { EventBus, getGlobalDatabasePath } from "@dev-workflow/core";
import { registerMultiProjectRoutes } from "./routes/multi-project.route.js";
import { WebSocketHandler } from "./infrastructure/websocket/websocket-handler.js";
import { WebSocketBridge } from "./infrastructure/websocket/websocket-bridge.js";
import { DatabaseChangeMonitor } from "./infrastructure/database-change-monitor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_PORT = 3457;

async function main() {
  const server = Fastify({ logger: false });

  // Add Express-style middleware support for Vite
  await server.register(middie);

  // Create Vite dev server in middleware mode
  const vite = await createViteServer({
    root: path.resolve(__dirname, ".."),
    server: { middlewareMode: true },
    appType: "spa",
  });

  // Register WebSocket before Vite middleware (order matters)
  await server.register(fastifyWebsocket);
  const wsHandler = new WebSocketHandler();
  wsHandler.registerRoutes(server);

  // Set up services
  const multiProjectService = new MultiProjectService();
  const eventBus = EventBus.getInstance();
  const databasePath = getGlobalDatabasePath();

  // EventBus bridge for real-time updates
  const wsBridge = new WebSocketBridge(eventBus, wsHandler);
  wsBridge.start();

  // Database change monitor for cross-process updates
  const dbMonitor = new DatabaseChangeMonitor(databasePath, {
    pollIntervalMs: 1000,
  });
  dbMonitor.on("change", () => wsHandler.broadcastDatabaseChange());
  dbMonitor.start();

  // Register API routes (before Vite catches everything)
  registerMultiProjectRoutes(server, { multiProjectService });

  // Use Vite's middleware for non-API routes only (React app + HMR)
  server.use((req, res, next) => {
    // Skip Vite for API and WebSocket routes - let Fastify handle them
    if (req.url?.startsWith("/api") || req.url?.startsWith("/ws")) {
      next();
      return;
    }
    vite.middlewares(req, res, next);
  });

  await server.listen({ port: DEV_PORT, host: "127.0.0.1" });

  const projects = await multiProjectService.listProjects();
  console.log(`🔥 Dev server running at http://127.0.0.1:${DEV_PORT}`);
  console.log(`   React HMR enabled - client updates instantly`);
  console.log(`   Server restart on changes via tsx watch`);
  if (projects.length > 0) {
    console.log(`   Serving ${projects.length} project(s)`);
  }

  const shutdown = async (signal: string) => {
    console.log(`\n📦 Received ${signal}, shutting down...`);
    wsBridge.stop();
    dbMonitor.stop();
    await vite.close();
    await server.close();
    await multiProjectService.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Failed to start dev server:", err);
  process.exit(1);
});
