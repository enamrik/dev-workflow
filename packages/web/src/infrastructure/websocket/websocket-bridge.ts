import { EventBus, type AnyDomainEvent } from "@dev-workflow/core";
import type { WebSocketHandler } from "./websocket-handler.js";

/**
 * WebSocketBridge connects the EventBus to WebSocket clients
 *
 * This is the glue between the core domain events and the
 * web UI real-time updates. It subscribes to all domain events
 * and forwards them to connected WebSocket clients.
 *
 * Follows the Adapter pattern - adapts EventBus interface to
 * WebSocket broadcast interface.
 */
export class WebSocketBridge {
  private unsubscribe?: () => void;

  constructor(
    private readonly eventBus: EventBus,
    private readonly wsHandler: WebSocketHandler
  ) {}

  /**
   * Start listening to events and forwarding to WebSocket
   */
  start(): void {
    if (this.unsubscribe) {
      return; // Already started
    }

    this.unsubscribe = this.eventBus.onAll((event: AnyDomainEvent) => {
      this.wsHandler.broadcast(event);
    });
  }

  /**
   * Stop forwarding events
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }
}
