/**
 * IssueService - Application service for issue operations
 *
 * Orchestrates issue operations including closing (with task abandonment),
 * status transitions, and external sync. All issue mutations should go through
 * this service to ensure consistent behavior across MCP tools, web API, and CLI.
 *
 * Follows Service Layer Pattern:
 * - Orchestrates multi-step operations
 * - Uses repositories for data access
 * - Calls TaskService for task operations (avoids duplicating logic)
 * - Syncs with external provider (ProjectManagementProvider)
 */

import type {
  Issue,
  IssueStatus,
  IssueFilters,
  CreateIssueParams,
  UpdateIssueParams,
} from "./issue.js";
import type { ProjectManagementService } from "../../project-sync/project-management-service.js";
import type { TaskService, AbandonTaskResult } from "../tasks/task-service.js";
import type { DbClient } from "../../data-access/db-client.js";
import { Effect, Service } from "@dev-workflow/effect";

/**
 * Error thrown when issue operation fails
 */
export class IssueServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_STATUS"
      | "INCOMPLETE_TASKS"
      | "SYNC_FAILED" = "NOT_FOUND",
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "IssueServiceError";
  }
}

/**
 * Result of closing an issue
 */
export interface CloseIssueResult {
  issue: Issue;
  abandonedTasks: AbandonTaskResult[];
  externalIssueClosed: boolean;
}

/**
 * IssueService - Orchestrates issue operations with external provider
 *
 * Key method: closeIssue()
 * - Abandons all incomplete tasks via TaskService
 * - Syncs to external provider
 * - Updates local issue status
 */
export class IssueService extends Service<IssueService>()("issueService") {
  constructor(
    private readonly db: DbClient,
    private readonly taskService: TaskService,
    private readonly projectManagement: ProjectManagementService
  ) {
    super();
  }

  // ============================================================================
  // Read Operations (delegating to repository)
  // ============================================================================

  /**
   * Find an issue by ID
   *
   * @returns Issue or null if not found
   */
  findById(issueId: string, includeDeleted = false): Effect<Issue | null> {
    return this.db.issues.findById(issueId, includeDeleted);
  }

  /**
   * Find an issue by number
   *
   * @returns Issue or null if not found
   */
  findByNumber(number: number): Effect<Issue | null> {
    return this.db.issues.findByNumber(number);
  }

  /**
   * Find many issues with optional filtering
   */
  findMany(options?: IssueFilters): Effect<Issue[]> {
    return this.db.issues.findMany(options);
  }

  /**
   * Get the next issue number
   */
  getNextIssueNumber(): Effect<number> {
    return this.db.issues.getNextIssueNumber();
  }

  // ============================================================================
  // Get Operations (throw if not found)
  // ============================================================================

  /**
   * Get an issue by ID
   *
   * @throws IssueServiceError if issue not found
   */
  getIssue(issueId: string): Effect<Issue, IssueServiceError> {
    const db = this.db;
    return Effect.gen(function* () {
      const issue = yield* db.issues.findById(issueId);
      if (!issue) {
        return yield* Effect.fail(
          new IssueServiceError(`Issue not found: ${issueId}`, "NOT_FOUND")
        );
      }
      return issue;
    });
  }

  /**
   * Get an issue by number
   *
   * @throws IssueServiceError if issue not found
   */
  getIssueByNumber(number: number): Effect<Issue, IssueServiceError> {
    const db = this.db;
    return Effect.gen(function* () {
      const issue = yield* db.issues.findByNumber(number);
      if (!issue) {
        return yield* Effect.fail(new IssueServiceError(`Issue #${number} not found`, "NOT_FOUND"));
      }
      return issue;
    });
  }

  /**
   * Close an issue
   *
   * Orchestrates the close operation:
   * 1. Abandons all incomplete tasks via TaskService (reuses logic, doesn't duplicate)
   * 2. Syncs to external provider FIRST (atomicity - external state should match)
   * 3. Updates local issue status to CLOSED
   *
   * This is the canonical implementation for closing issues.
   * MCP tools and web API should call this method.
   *
   * @param issueId - Issue UUID
   * @param force - Skip task validation (for state drift recovery)
   * @param closedBy - Who closed the issue
   * @returns Result including abandoned tasks and sync status
   */
  closeIssue(
    issueId: string,
    force = false,
    closedBy?: string
  ): Effect<CloseIssueResult, IssueServiceError> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return Effect.gen(function* () {
      const issue = yield* self.getIssue(issueId);

      // Already closed
      if (issue.isClosed) {
        return {
          issue,
          abandonedTasks: [],
          externalIssueClosed: false,
        };
      }

      const result: CloseIssueResult = {
        issue,
        abandonedTasks: [],
        externalIssueClosed: false,
      };

      // 1. Check for incomplete tasks
      const incompleteTasks = yield* Effect.promise(() =>
        self.taskService.getIncompleteTasksForIssue(issueId)
      );

      if (incompleteTasks.length > 0) {
        if (!force) {
          // Without force: error out, require all tasks to be complete
          const taskList = incompleteTasks
            .map((t) => `#${t.number} ${t.title} (${t.status})`)
            .join(", ");
          return yield* Effect.fail(
            new IssueServiceError(
              `Cannot close issue: ${incompleteTasks.length} task(s) are not complete: ${taskList}. Use force=true to abandon them.`,
              "INCOMPLETE_TASKS"
            )
          );
        }

        // With force: abandon incomplete tasks
        for (const task of incompleteTasks) {
          try {
            const abandonResult = yield* Effect.promise(() =>
              self.taskService.abandonTask(task.id, "Issue closed", closedBy)
            );
            result.abandonedTasks.push(abandonResult);
          } catch (error) {
            console.warn(
              `Failed to abandon task ${task.id}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }

      // 2. Close external issue
      const updatedSyncState = yield* self.projectManagement.closeIssue(issue.syncState);
      if (updatedSyncState) {
        yield* self.db.issues.update(issue.id, { syncState: updatedSyncState });
      }
      result.externalIssueClosed = !!issue.syncState?.externalId;

      // 3. Update local issue status
      const updatedIssue = yield* self.db.issues.update(issueId, {
        status: "CLOSED" as IssueStatus,
      });

      result.issue = updatedIssue;
      return result;
    });
  }

  /**
   * Check if all tasks for an issue are in terminal state
   *
   * Delegates to TaskService to avoid duplicating logic.
   */
  areAllTasksComplete(issueId: string): Effect<boolean> {
    return Effect.promise(() => this.taskService.areAllTasksComplete(issueId));
  }

  /**
   * Update issue status
   *
   * For non-CLOSED status changes. Use closeIssue() to close.
   *
   * @param issueId - Issue UUID
   * @param newStatus - Target status (not CLOSED - use closeIssue for that)
   * @returns The updated issue
   */
  updateStatus(issueId: string, newStatus: IssueStatus): Effect<Issue, IssueServiceError> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return Effect.gen(function* () {
      if (newStatus === "CLOSED") {
        const result = yield* self.closeIssue(issueId);
        return result.issue;
      }

      // Verify issue exists
      yield* self.getIssue(issueId);
      return yield* self.db.issues.update(issueId, { status: newStatus });
    });
  }

  // ============================================================================
  // Write Operations
  // ============================================================================

  /**
   * Create a new issue
   */
  create(data: CreateIssueParams): Effect<Issue> {
    return this.db.issues.create(data);
  }

  /**
   * Update an issue
   */
  update(issueId: string, updates: UpdateIssueParams): Effect<Issue> {
    return this.db.issues.update(issueId, updates);
  }

  /**
   * Soft delete an issue
   */
  delete(issueId: string, deletedBy = "system"): Effect<Issue> {
    return this.db.issues.delete(issueId, deletedBy);
  }

  /**
   * Restore a soft-deleted issue
   */
  restore(issueId: string): Effect<Issue> {
    return this.db.issues.restore(issueId);
  }

  /**
   * Assign an issue to a milestone
   */
  assignToMilestone(issueId: string, milestoneId: string): Effect<Issue> {
    return this.db.issues.update(issueId, { milestoneId });
  }

  /**
   * Remove an issue from its milestone
   */
  removeFromMilestone(issueId: string): Effect<Issue> {
    return this.db.issues.update(issueId, { milestoneId: undefined });
  }

  /**
   * Search issues by keyword in title or description
   */
  search(
    query: string
  ): Effect<Pick<Issue, "id" | "number" | "title" | "status" | "type" | "priority">[]> {
    return this.db.issues.search(query);
  }

  /**
   * Get count of issues by status
   */
  getStatusCounts(): Effect<Record<string, number>> {
    return this.db.issues.getStatusCounts();
  }
}
