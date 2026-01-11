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

import type { Issue, IssueRepository, IssueStatus } from "../domain/issue.js";
import type { ProjectManagementProvider } from "../domain/project-management-provider.js";
import type { TaskService, AbandonTaskResult } from "./task-service.js";

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
export class IssueService {
  constructor(
    private readonly issueRepository: IssueRepository,
    private readonly taskService: TaskService,
    private readonly provider: ProjectManagementProvider | null
  ) {}

  /**
   * Get an issue by ID
   *
   * @throws IssueServiceError if issue not found
   */
  getIssue(issueId: string): Issue {
    const issue = this.issueRepository.findById(issueId);
    if (!issue) {
      throw new IssueServiceError(`Issue not found: ${issueId}`, "NOT_FOUND");
    }
    return issue;
  }

  /**
   * Get an issue by number
   *
   * @throws IssueServiceError if issue not found
   */
  getIssueByNumber(number: number): Issue {
    const issue = this.issueRepository.findByNumber(number);
    if (!issue) {
      throw new IssueServiceError(`Issue #${number} not found`, "NOT_FOUND");
    }
    return issue;
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
   * @throws IssueServiceError if issue not found or already closed
   */
  async closeIssue(
    issueId: string,
    force = false,
    closedBy?: string
  ): Promise<CloseIssueResult> {
    const issue = this.getIssue(issueId);

    // Already closed
    if (issue.status === "CLOSED") {
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

    // 1. Abandon all incomplete tasks via TaskService
    const incompleteTasks = this.taskService.getIncompleteTasksForIssue(issueId);

    if (incompleteTasks.length > 0) {
      if (!force) {
        // Abandon each task - TaskService handles cleanup and external sync
        for (const task of incompleteTasks) {
          try {
            const abandonResult = await this.taskService.abandonTask(
              task.id,
              "Issue closed",
              closedBy
            );
            result.abandonedTasks.push(abandonResult);
          } catch (error) {
            console.warn(
              `Failed to abandon task ${task.id}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
    }

    // 2. Close external issue if synced (do this BEFORE local update for atomicity)
    if (this.provider && issue.githubSync?.githubIssueNumber) {
      try {
        await this.provider.closeIssue(String(issue.githubSync.githubIssueNumber));
        result.externalIssueClosed = true;
      } catch (error) {
        console.warn(
          `Failed to close external issue: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // 3. Update local issue status
    const updatedIssue = this.issueRepository.update(issueId, { status: "CLOSED" as IssueStatus });

    result.issue = updatedIssue;
    return result;
  }

  /**
   * Check if all tasks for an issue are in terminal state
   *
   * Delegates to TaskService to avoid duplicating logic.
   */
  areAllTasksComplete(issueId: string): boolean {
    return this.taskService.areAllTasksComplete(issueId);
  }

  /**
   * Update issue status
   *
   * For non-CLOSED status changes. Use closeIssue() to close.
   *
   * @param issueId - Issue UUID
   * @param newStatus - Target status (not CLOSED - use closeIssue for that)
   * @returns The updated issue
   * @throws IssueServiceError if issue not found or invalid status
   */
  async updateStatus(issueId: string, newStatus: IssueStatus): Promise<Issue> {
    if (newStatus === "CLOSED") {
      const result = await this.closeIssue(issueId);
      return result.issue;
    }

    // Verify issue exists
    this.getIssue(issueId);
    return this.issueRepository.update(issueId, { status: newStatus });
  }
}
