/**
 * Domain event types for real-time updates
 *
 * Events are named using past tense (something happened)
 * and carry enough context for subscribers to act.
 */

export type DomainEventType =
  | "issue:created"
  | "issue:updated"
  | "issue:closed"
  | "plan:generated"
  | "plan:updated"
  | "task:created"
  | "task:updated"
  | "task:status_changed"
  | "task:deleted"
  | "task:session_started"
  | "task:session_completed"
  | "task:session_abandoned"
  | "snapshot:created"
  | "snapshot:reverted";

/**
 * Type-safe payload mapping for each event type
 */
export interface DomainEventPayload {
  "issue:created": { issueId: string; issueNumber: number };
  "issue:updated": { issueId: string; issueNumber: number; fields: string[] };
  "issue:closed": { issueId: string; issueNumber: number };
  "plan:generated": { planId: string; issueId: string; issueNumber: number };
  "plan:updated": { planId: string; issueId: string; issueNumber: number };
  "task:created": { taskId: string; planId: string; issueNumber: number };
  "task:updated": {
    taskId: string;
    planId: string;
    issueNumber: number;
    fields: string[];
  };
  "task:status_changed": {
    taskId: string;
    planId: string;
    issueNumber: number;
    fromStatus: string;
    toStatus: string;
  };
  "task:deleted": { taskId: string; planId: string; issueNumber: number };
  "task:session_started": {
    taskId: string;
    sessionId: string;
    issueNumber: number;
  };
  "task:session_completed": {
    taskId: string;
    sessionId: string;
    issueNumber: number;
  };
  "task:session_abandoned": {
    taskId: string;
    sessionId: string;
    issueNumber: number;
  };
  "snapshot:created": {
    snapshotId: string;
    issueNumber: number;
    version: number;
  };
  "snapshot:reverted": {
    issueNumber: number;
    fromVersion: number;
    toVersion: number;
  };
}

/**
 * Base interface for all domain events
 */
export interface DomainEvent<T extends DomainEventType = DomainEventType> {
  readonly type: T;
  readonly timestamp: string;
  readonly payload: DomainEventPayload[T];
}

/**
 * Type helper to create a specific event type
 */
export type TypedDomainEvent<T extends DomainEventType> = DomainEvent<T>;

/**
 * Union of all possible domain events
 */
export type AnyDomainEvent = {
  [K in DomainEventType]: DomainEvent<K>;
}[DomainEventType];
