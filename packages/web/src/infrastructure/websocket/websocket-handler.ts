import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type { AnyDomainEvent } from "@dev-workflow/core";

/**
 * Message sent to WebSocket clients
 */
export interface WebSocketMessage {
  type: "event" | "ping" | "pong" | "connected";
  payload?: AnyDomainEvent | { message: string };
}

/**
 * WebSocketHandler manages active WebSocket connections
 *
 * Responsibilities:
 * - Track active connections
 * - Broadcast events to all clients
 * - Handle ping/pong for keepalive
 * - Clean up dead connections
 */
export class WebSocketHandler {
  private readonly connections: Set<WebSocket> = new Set();

  /**
   * Register WebSocket routes with Fastify
   */
  registerRoutes(server: FastifyInstance): void {
    server.get("/ws", { websocket: true }, (socket) => {
      this.addConnection(socket);
    });
  }

  /**
   * Add a new WebSocket connection
   */
  private addConnection(socket: WebSocket): void {
    this.connections.add(socket);

    // Send welcome message
    this.send(socket, {
      type: "connected",
      payload: { message: "Connected to dev-workflow real-time updates" },
    });

    // Handle client messages (ping/pong)
    socket.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as WebSocketMessage;
        if (message.type === "ping") {
          this.send(socket, { type: "pong" });
        }
      } catch {
        // Ignore malformed messages
      }
    });

    // Clean up on close
    socket.on("close", () => {
      this.connections.delete(socket);
    });

    socket.on("error", () => {
      this.connections.delete(socket);
    });
  }

  /**
   * Broadcast an event to all connected clients
   */
  broadcast(event: AnyDomainEvent): void {
    const message: WebSocketMessage = {
      type: "event",
      payload: event,
    };
    const data = JSON.stringify(message);

    for (const socket of this.connections) {
      if (socket.readyState === socket.OPEN) {
        socket.send(data);
      }
    }
  }

  /**
   * Broadcast a database change notification to all clients
   *
   * This is used for cross-process change detection via PRAGMA data_version.
   * Clients should invalidate their caches when receiving this.
   */
  broadcastDatabaseChange(): void {
    // Send a synthetic event that the client recognizes
    // We use a raw object here since db:changed is not a domain event type
    const message = {
      type: "event",
      payload: {
        type: "db:changed",
        timestamp: new Date().toISOString(),
        payload: {},
      },
    };
    const data = JSON.stringify(message);

    for (const socket of this.connections) {
      if (socket.readyState === socket.OPEN) {
        socket.send(data);
      }
    }
  }

  /**
   * Send a message to a specific client
   */
  private send(socket: WebSocket, message: WebSocketMessage): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  /**
   * Get current connection count (for monitoring)
   */
  getConnectionCount(): number {
    return this.connections.size;
  }
}
