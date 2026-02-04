import { EventEmitter } from "node:events";
import { Service } from "@dev-workflow/effect";
import type {
  DomainEventType,
  DomainEvent,
  DomainEventPayload,
  AnyDomainEvent,
} from "../events.js";

/**
 * Listener function type for domain events
 */
export type DomainEventListener<T extends DomainEventType> = (event: DomainEvent<T>) => void;

/**
 * EventBus for domain events
 *
 * Implements the Observer pattern for decoupled event handling.
 * Uses Node's EventEmitter internally but provides type-safe API.
 *
 * Thread Safety: Node.js is single-threaded, so no locking needed.
 * The EventBus is registered in the DI container and shared via
 * Effect service resolution (yield* EventBus).
 *
 * Usage:
 *   // In service (publish)
 *   eventBus.emit("issue:created", { issueId: "...", issueNumber: 1 });
 *
 *   // In subscriber (subscribe)
 *   eventBus.on("issue:created", (event) => {
 *     console.log(`Issue #${event.payload.issueNumber} created`);
 *   });
 */
export class EventBus extends Service<EventBus>()("eventBus") {
  private readonly emitter: EventEmitter;

  constructor() {
    super();
    this.emitter = new EventEmitter();
    // Allow many listeners for multi-subscriber scenarios
    this.emitter.setMaxListeners(100);
  }

  /**
   * Emit a domain event
   *
   * @param type - Event type
   * @param payload - Event payload matching the event type
   */
  emit<T extends DomainEventType>(type: T, payload: DomainEventPayload[T]): void {
    const event: DomainEvent<T> = {
      type,
      timestamp: new Date().toISOString(),
      payload,
    };
    this.emitter.emit(type, event);
    // Also emit wildcard for catch-all subscribers
    this.emitter.emit("*", event);
  }

  /**
   * Subscribe to a specific event type
   *
   * @param type - Event type to subscribe to
   * @param listener - Callback function
   * @returns Unsubscribe function
   */
  on<T extends DomainEventType>(type: T, listener: DomainEventListener<T>): () => void {
    this.emitter.on(type, listener);
    return () => this.emitter.off(type, listener);
  }

  /**
   * Subscribe to all events (wildcard)
   *
   * @param listener - Callback function receiving any event
   * @returns Unsubscribe function
   */
  onAll(listener: (event: AnyDomainEvent) => void): () => void {
    this.emitter.on("*", listener);
    return () => this.emitter.off("*", listener);
  }

  /**
   * Subscribe once to a specific event type
   *
   * @param type - Event type to subscribe to
   * @param listener - Callback function (called once then removed)
   */
  once<T extends DomainEventType>(type: T, listener: DomainEventListener<T>): void {
    this.emitter.once(type, listener);
  }
}
