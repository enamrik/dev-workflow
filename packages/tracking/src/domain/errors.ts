/**
 * Domain Errors
 *
 * Pure business errors that express domain concepts.
 * These errors have NO HTTP knowledge - they are mapped to HTTP status codes
 * in the infrastructure layer by mapError().
 */

// ============================================================================
// General Domain Errors
// ============================================================================

/**
 * Base class for domain errors that carry structured data.
 * Subclasses should define specific properties relevant to their error type.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Error thrown when an entity cannot be found by ID or other identifier.
 *
 * Maps to: 404 Not Found
 */
export class EntityNotFoundError extends DomainError {
  readonly code = "ENTITY_NOT_FOUND";

  constructor(
    public readonly entityType: string,
    public readonly id: string
  ) {
    super(`${entityType} not found: ${id}`);
  }
}

/**
 * Error thrown when input validation fails.
 * Use for user-provided data that doesn't meet requirements.
 *
 * Maps to: 400 Bad Request
 */
export class ValidationError extends DomainError {
  readonly code = "VALIDATION_ERROR";

  constructor(
    public readonly field: string,
    public readonly reason: string
  ) {
    super(`Validation failed for ${field}: ${reason}`);
  }
}

/**
 * Error thrown when Zod schema validation fails.
 * Carries the full array of Zod issues for detailed error reporting.
 *
 * Maps to: 400 Bad Request
 */
export class ZodValidationError extends DomainError {
  readonly code = "ZOD_VALIDATION_ERROR";

  constructor(public readonly issues: Array<{ path: (string | number)[]; message: string }>) {
    const summary = issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    super(`Validation failed: ${summary}`);
  }
}

/**
 * Error thrown when an operation conflicts with existing state.
 * Use for duplicate keys, optimistic locking failures, etc.
 *
 * Maps to: 409 Conflict
 */
export class ConflictError extends DomainError {
  readonly code = "CONFLICT";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Error thrown when a business rule prevents an operation.
 * Use for operations that violate domain invariants.
 *
 * Maps to: 422 Unprocessable Entity
 */
export class BusinessRuleError extends DomainError {
  readonly code = "BUSINESS_RULE_VIOLATION";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Error thrown when authentication is required but not provided or invalid.
 *
 * Maps to: 401 Unauthorized
 */
export class AuthenticationError extends DomainError {
  readonly code = "AUTHENTICATION_REQUIRED";

  constructor(message = "Authentication required") {
    super(message);
  }
}

/**
 * Error thrown when the user is authenticated but lacks permission.
 *
 * Maps to: 403 Forbidden
 */
export class AuthorizationError extends DomainError {
  readonly code = "AUTHORIZATION_DENIED";

  constructor(message = "Permission denied") {
    super(message);
  }
}

// ============================================================================
// Task-Specific Domain Errors
// ============================================================================

/**
 * Error thrown when task dependencies form a cycle
 *
 * Circular dependencies prevent tasks from ever being executable.
 * This error is thrown during plan generation to ensure all plans have valid DAGs.
 */
export class DAGCycleError extends Error {
  constructor(
    public readonly cycle: string[], // Task IDs forming the cycle
    public readonly cyclePath: string // Human-readable path like "A -> B -> C -> A"
  ) {
    super(`Circular dependency detected: ${cyclePath}`);
    this.name = "DAGCycleError";
  }
}

/**
 * Error thrown when a task references an unknown dependency
 *
 * Dependencies must reference tasks that exist within the same plan.
 */
export class InvalidDependencyError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly taskTitle: string,
    public readonly invalidDependencyId: string
  ) {
    super(`Task "${taskTitle}" (${taskId}) depends on unknown task: ${invalidDependencyId}`);
    this.name = "InvalidDependencyError";
  }
}

/**
 * Error thrown when trying to start a task with unsatisfied dependencies
 *
 * A task can only be started when all its dependencies are COMPLETED or ABANDONED.
 */
export class DependencyNotSatisfiedError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly taskTitle: string,
    public readonly blockingTasks: Array<{
      id: string;
      number: number;
      title: string;
      status: string;
      issueNumber?: number | null;
    }>
  ) {
    const blocking = blockingTasks
      .map((t) => {
        const storyRef = t.issueNumber != null ? `#${t.issueNumber}.${t.number}` : `#${t.number}`;
        return `${storyRef} "${t.title}" (${t.status})`;
      })
      .join(", ");
    super(`Cannot start task "${taskTitle}": blocked by unsatisfied dependencies: ${blocking}`);
    this.name = "DependencyNotSatisfiedError";
  }
}

/**
 * Error thrown when attempting an invalid task status transition
 *
 * Task status transitions follow a specific state machine:
 * - BACKLOG → READY (when plan is activated)
 * - READY → BACKLOG (when issue is paused)
 * - BACKLOG/READY → IN_PROGRESS (when task is started)
 * - IN_PROGRESS → PR_REVIEW (when task is submitted for review)
 * - PR_REVIEW → COMPLETED (after PR is merged)
 * - Any → ABANDONED (when task is abandoned)
 */
export class InvalidStatusTransitionError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly fromStatus: string,
    public readonly toStatus: string,
    public readonly reason?: string
  ) {
    const reasonPart = reason ? `: ${reason}` : "";
    super(`Cannot transition task from ${fromStatus} to ${toStatus}${reasonPart}`);
    this.name = "InvalidStatusTransitionError";
  }
}
