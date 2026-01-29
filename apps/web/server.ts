/**
 * Custom server for dev-workflow web UI
 *
 * Runs Next.js with WebSocket support for real-time updates.
 * Uses DatabaseChangeMonitor to detect changes from other processes (MCP tools).
 */

import { createServer, type IncomingMessage } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer, type WebSocket } from "ws";
import { WebSocketHandler } from "./src/server/websocket-handler.js";
import { DatabaseChangeMonitor } from "./src/server/database-change-monitor.js";
import { getGlobalDatabasePath } from "@dev-workflow/git/track-directory-resolver.js";
import { getWorkerQueueDbPath } from "@dev-workflow/local-workers/local-worker-queue-db.js";

const dev = process.env["NODE_ENV"] !== "production";
const port = parseInt(process.env["PORT"] || "3456", 10);
const hostname = "127.0.0.1";

async function main() {
  // Initialize Next.js
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  // Create HTTP server
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || "", true);
    handle(req, res, parsedUrl);
  });

  // Create WebSocket server
  const wss = new WebSocketServer({ noServer: true });
  const wsHandler = new WebSocketHandler();

  // Handle WebSocket upgrades
  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const { pathname } = parse(request.url || "", true);

    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        wsHandler.handleConnection(ws);
      });
    } else {
      socket.destroy();
    }
  });

  // Start database change monitors
  const dbPath = getGlobalDatabasePath();
  const workerQueueDbPath = getWorkerQueueDbPath();

  const workflowMonitor = new DatabaseChangeMonitor(dbPath, { pollIntervalMs: 500 });
  const workerQueueMonitor = new DatabaseChangeMonitor(workerQueueDbPath, { pollIntervalMs: 500 });

  workflowMonitor.on("change", () => {
    wsHandler.broadcastDatabaseChange();
  });

  workerQueueMonitor.on("change", () => {
    wsHandler.broadcastDatabaseChange();
  });

  workflowMonitor.start();
  workerQueueMonitor.start();
  console.log(`📊 Database change monitors started:`);
  console.log(`   - Workflow: ${dbPath}`);
  console.log(`   - Worker queue: ${workerQueueDbPath}`);

  // Start server
  server.listen(port, hostname, () => {
    console.log(`🚀 dev-workflow UI ready at http://${hostname}:${port}`);
    console.log(`   WebSocket endpoint: ws://${hostname}:${port}/ws`);
    if (dev) {
      console.log(`   Mode: development (hot reload enabled)`);
    }
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n📦 Received ${signal}, shutting down...`);
    workflowMonitor.stop();
    workerQueueMonitor.stop();
    wss.close();
    server.close(() => {
      console.log("✓ Server stopped");
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
