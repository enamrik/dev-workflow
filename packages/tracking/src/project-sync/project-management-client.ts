/**
 * ProjectManagementClient - Low-level interface for external project management API calls
 *
 * This is a THIN interface - it only handles API calls to external systems.
 * NO orchestration logic, NO null checks, NO timestamp management.
 *
 * Orchestration happens in ProjectManagementService, which wraps this client.
 *
 * Architecture:
 * ```
 * TaskService / IssueService
 *     ↓
 * ProjectManagementService (orchestration: null checks, timestamps, error handling)
 *     ↓
 * ProjectManagementClient (this interface - just API calls)
 *     ↓
 * ├── GitHubProjectManagementClient
 * ├── JiraProjectManagementClient (future)
 * └── NoOpProjectManagementClient (null object pattern)
 * ```
 */

import type { TaskStatus } from "../domain/tasks/task.js";
import type {
  CreateIssueParams,
  ExternalIssue,
  ProjectItemResult,
  SetFieldResult,
  AuthResult,
  RepositoryResult,
  ProjectDetails,
  ProjectStatusField,
  ProjectField,
  AvailableLabelsResult,
} from "./project-management-provider.js";

// =============================================================================
// Client Interface
// =============================================================================

/**
 * ProjectManagementClient - Low-level API operations only
 *
 * Implementations:
 * - GitHubProjectManagementClient (GitHub API via CLI)
 * - NoOpProjectManagementClient (null object pattern - all methods no-op)
 * - JiraProjectManagementClient (future)
 * - LinearProjectManagementClient (future)
 *
 * Design principles:
 * - NO business logic - just API calls
 * - NO null checks on inputs - caller validates first
 * - NO timestamp management - caller handles sync state
 * - Methods may throw on API errors - caller handles
 */
export interface ProjectManagementClient {
  // ===========================================================================
  // Identity
  // ===========================================================================

  /**
   * Unique identifier for this provider type
   * Examples: "github", "jira", "linear", "noop"
   */
  readonly providerId: string;

  /**
   * Human-readable display name
   * Examples: "GitHub", "Jira", "Linear", "No-Op"
   */
  readonly displayName: string;

  // ===========================================================================
  // Configuration Accessors
  // ===========================================================================

  /**
   * Check if the provider is enabled for sync operations
   */
  isEnabled(): boolean;

  /**
   * Get the configured project/board ID, if any
   */
  getProjectId(): string | null;

  /**
   * Get the column name for a task status
   * Returns null if no mapping configured for this status.
   */
  getColumnForStatus(status: TaskStatus): string | null;

  /**
   * Get the label-to-field mapping for project custom fields
   * Returns empty object if no mapping configured.
   */
  getLabelFieldMapping(): Record<string, string>;

  /**
   * Get the configured assignee for auto-assignment, if any
   */
  getAssignee(): string | null;

  /**
   * Get custom labels to add to all created issues
   */
  getCustomLabels(): string[];

  // ===========================================================================
  // Authentication & Validation
  // ===========================================================================

  /**
   * Check if the provider is authenticated and ready to use
   */
  checkAuth(): Promise<AuthResult>;

  /**
   * Check if the current repository/workspace is accessible
   */
  checkRepository(): Promise<RepositoryResult>;

  // ===========================================================================
  // Issue Operations (Low-Level API Calls)
  // ===========================================================================

  /**
   * Create a new issue in the external system
   *
   * @throws ProjectManagementClientError on API failure
   */
  createIssue(params: CreateIssueParams): Promise<ExternalIssue>;

  /**
   * Close an issue in the external system
   *
   * @param externalId - The external issue ID (e.g., "42" for GitHub)
   * @param comment - Optional comment to add when closing
   * @throws ProjectManagementClientError on API failure
   */
  closeIssue(externalId: string, comment?: string): Promise<void>;

  /**
   * Reopen a closed issue
   *
   * @param externalId - The external issue ID
   * @throws ProjectManagementClientError on API failure
   */
  reopenIssue(externalId: string): Promise<void>;

  /**
   * Get issue details
   *
   * @param externalId - The external issue ID
   * @returns Issue data or null if not found
   */
  getIssue(externalId: string): Promise<ExternalIssue | null>;

  /**
   * Search for issues matching a query
   *
   * @param query - Search query
   * @param state - Filter by state
   * @param limit - Maximum results
   */
  searchIssues(
    query: string,
    state?: "open" | "closed" | "all",
    limit?: number
  ): Promise<ExternalIssue[]>;

  // ===========================================================================
  // Project/Board Operations (Low-Level API Calls)
  // ===========================================================================

  /**
   * Add an issue to a project/board
   *
   * @param nodeId - External node ID of the issue (for GraphQL APIs)
   * @param projectId - Project/board identifier
   * @throws ProjectManagementClientError on API failure
   */
  addToProject(nodeId: string, projectId: string): Promise<ProjectItemResult>;

  /**
   * Move an issue to a specific column/status on a project board
   *
   * @param itemId - Project item ID (from addToProject)
   * @param projectId - Project identifier
   * @param columnName - Name of the column to move to
   * @throws ProjectManagementClientError on API failure
   */
  moveToColumn(itemId: string, projectId: string, columnName: string): Promise<void>;

  /**
   * Set a field value on a project item
   *
   * @param projectId - Project identifier
   * @param itemId - Project item ID
   * @param fieldId - Field identifier
   * @param value - Value to set (human-readable for single-select)
   * @throws ProjectManagementClientError on API failure
   */
  setProjectItemField(
    projectId: string,
    itemId: string,
    fieldId: string,
    value: string
  ): Promise<SetFieldResult>;

  /**
   * Clear a field value on a project item
   *
   * @param projectId - Project identifier
   * @param itemId - Project item ID
   * @param fieldId - Field identifier
   * @throws ProjectManagementClientError on API failure
   */
  clearProjectItemField(
    projectId: string,
    itemId: string,
    fieldId: string
  ): Promise<SetFieldResult>;

  // ===========================================================================
  // Project Metadata Operations
  // ===========================================================================

  /**
   * Check if a project/board exists and is accessible
   */
  checkProject(projectId: string): Promise<boolean>;

  /**
   * Get project/board details
   */
  getProjectDetails(projectId: string): Promise<ProjectDetails | null>;

  /**
   * Get the status field information for a project
   */
  getProjectStatusField(projectId: string): Promise<ProjectStatusField | null>;

  /**
   * Get all fields for a project
   */
  getProjectFields(projectId: string): Promise<ProjectField[]>;

  /**
   * Get available labels for issues and tasks
   */
  getAvailableLabels(): Promise<AvailableLabelsResult>;

  // ===========================================================================
  // Label Operations
  // ===========================================================================

  /**
   * Ensure labels/tags exist in the external system
   */
  ensureLabelsExist(labels: string[]): Promise<void>;

  // ===========================================================================
  // Assignment
  // ===========================================================================

  /**
   * Assign an issue to a user
   *
   * @param externalId - External issue ID
   * @param assignee - Username to assign
   * @throws ProjectManagementClientError on API failure
   */
  assignIssue(externalId: string, assignee: string): Promise<void>;

  // ===========================================================================
  // Comments
  // ===========================================================================

  /**
   * Add a comment to an issue
   *
   * @param externalId - External issue ID
   * @param body - Comment text (supports markdown)
   * @throws ProjectManagementClientError on API failure
   */
  addComment(externalId: string, body: string): Promise<void>;

  // ===========================================================================
  // Hierarchical Issues
  // ===========================================================================

  /**
   * Link an issue as a child of another issue
   *
   * @param parentRef - External ID of the parent issue
   * @param childRef - External ID of the child issue
   * @throws ProjectManagementClientError on API failure
   */
  linkParentChild(parentRef: string, childRef: string): Promise<void>;
}

// =============================================================================
// Error Type
// =============================================================================

/**
 * Error thrown by ProjectManagementClient operations
 */
export class ProjectManagementClientError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly operation: string,
    public readonly cause?: Error
  ) {
    super(`[${providerId}] ${operation}: ${message}`);
    this.name = "ProjectManagementClientError";
  }
}
