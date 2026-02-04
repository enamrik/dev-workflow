/**
 * ProjectManagementProvider - Abstract interface for external project management systems
 *
 * This interface defines the contract that all project management providers must implement.
 * It abstracts operations like issue creation, status sync, and project board integration
 * to enable pluggable support for GitHub, Jira, Linear, Asana, and other tools.
 *
 * Design decisions:
 * - PR operations are NOT included (they're Git-hosting specific, not project management)
 * - Issue references are strings to accommodate different systems (GitHub uses numbers, Jira uses keys)
 * - All operations are async to support remote API calls
 * - Provider identity is explicit for logging and debugging
 */

import { Effect, Service } from "@dev-workflow/effect";
import type { Issue } from "../domain/issues/issue.js";
import type { Task, TaskStatus } from "../domain/tasks/task.js";

// =============================================================================
// Sync State Types
// =============================================================================

/**
 * Sync status for issues and tasks
 */
export type SyncStatus = "NOT_SYNCED" | "SYNCED" | "PUSH_FAILED";

/**
 * Sync state - tracks the link between local entity and external system
 *
 * Provider-agnostic version of GitHubSyncState.
 * The local issue/task is always the source of truth.
 */
export interface SyncState {
  /** External issue identifier (e.g., "42" for GitHub, "PROJ-123" for Jira) */
  readonly externalId: string | null;

  /** External issue URL for easy access */
  readonly externalUrl: string | null;

  /** External node ID for API operations (e.g., GraphQL node ID) */
  readonly externalNodeId: string | null;

  /** Current sync status */
  readonly syncStatus: SyncStatus;

  /** Last successful sync timestamp (ISO string) */
  readonly lastSyncedAt: string | null;

  /** Error message if last sync failed */
  readonly lastSyncError: string | null;

  /** Remote project board item ID (if added to a project/board) */
  readonly remoteProjectId: string | null;
}

/**
 * Create a SyncState from an ExternalIssue.
 *
 * Used when linking an existing external issue (imported or found by search)
 * rather than creating a new one.
 */
export function syncStateFromExternalIssue(issue: ExternalIssue): SyncState {
  return {
    externalId: issue.numericId?.toString() ?? issue.id,
    externalUrl: issue.url,
    externalNodeId: issue.nodeId ?? null,
    syncStatus: "SYNCED",
    lastSyncedAt: new Date().toISOString(),
    lastSyncError: null,
    remoteProjectId: null,
  };
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Whether the sync succeeded */
  readonly success: boolean;

  /** What action was taken */
  readonly action: "created" | "updated" | "closed" | "reopened" | "none";

  /** External issue identifier (if created/updated) */
  readonly externalId?: string;

  /** External issue URL (if created/updated) */
  readonly externalUrl?: string;

  /** External node ID (if created) */
  readonly externalNodeId?: string;

  /** Remote project board item ID (if added to project) */
  readonly remoteProjectId?: string;

  /** Error message (if failed) */
  readonly error?: string;
}

// =============================================================================
// External Issue Types
// =============================================================================

/**
 * External issue data returned from provider
 *
 * Provider-agnostic version of GitHubIssueData.
 */
export interface ExternalIssue {
  /** External issue identifier (e.g., "42" for GitHub, "PROJ-123" for Jira) */
  readonly id: string;

  /** Numeric ID for APIs that need it (e.g., GitHub REST API) */
  readonly numericId?: number;

  /** Full external issue URL */
  readonly url: string;

  /** External node ID (for GraphQL operations, if applicable) */
  readonly nodeId?: string;

  /** Issue title */
  readonly title: string;

  /** Issue body/description */
  readonly body: string;

  /** Issue state */
  readonly state: "OPEN" | "CLOSED";

  /** Labels/tags on the issue */
  readonly labels: string[];
}

/**
 * Parameters for creating an issue
 */
export interface CreateIssueParams {
  /** Issue title */
  readonly title: string;

  /** Issue body/description (supports markdown) */
  readonly body: string;

  /** Labels to apply */
  readonly labels: string[];
}

/**
 * Parameters for updating an issue
 */
export interface UpdateIssueParams {
  /** External issue identifier */
  readonly issueRef: string;

  /** New title (optional) */
  readonly title?: string;

  /** New body/description (optional) */
  readonly body?: string;

  /** Labels to set (replaces existing) */
  readonly labels?: string[];
}

// =============================================================================
// Auth & Repository Types
// =============================================================================

/**
 * Result of authentication check
 */
export interface AuthResult {
  /** Whether authentication is valid */
  readonly authenticated: boolean;

  /** Username/account identifier if authenticated */
  readonly username?: string;

  /** Error message if not authenticated */
  readonly error?: string;
}

/**
 * Result of repository/workspace check
 */
export interface RepositoryResult {
  /** Whether the repository/workspace is accessible */
  readonly accessible: boolean;

  /** Repository/workspace identifier */
  readonly identifier?: string;

  /** Error message if not accessible */
  readonly error?: string;
}

// =============================================================================
// Project/Board Types
// =============================================================================

/**
 * Result of adding an issue to a project/board
 */
export interface ProjectItemResult {
  /** Whether the operation succeeded */
  readonly success: boolean;

  /** Project item ID (for moving between columns) */
  readonly itemId?: string;

  /** Error message if failed */
  readonly error?: string;
}

/**
 * Project/board details
 */
export interface ProjectDetails {
  /** Project identifier */
  readonly id: string;

  /** Project title/name */
  readonly title: string;

  /** Project URL for linking */
  readonly url: string;
}

/**
 * Column/status information for project boards
 */
export interface ProjectColumn {
  /** Column identifier */
  readonly id: string;

  /** Column name */
  readonly name: string;
}

/**
 * Project status field information (for boards with status fields)
 */
export interface ProjectStatusField {
  /** Field identifier */
  readonly fieldId: string;

  /** Field name */
  readonly fieldName: string;

  /** Available options/columns */
  readonly options: ProjectColumn[];
}

/**
 * Project field types supported by providers
 */
export type ProjectFieldType = "TEXT" | "NUMBER" | "DATE" | "SINGLE_SELECT" | "ITERATION" | "OTHER";

/**
 * Available label definition
 *
 * Describes a label that can be applied to issues/tasks.
 */
export interface AvailableLabel {
  /** Label name (e.g., "product", "team", "urgent") */
  readonly name: string;

  /**
   * Valid values for this label.
   * - null: Any string value is allowed (free-form text)
   * - string[]: Only these specific values are valid (single-select)
   */
  readonly validValues: string[] | null;
}

/**
 * Result of getting available labels
 */
export interface AvailableLabelsResult {
  /** Whether the provider supports labels */
  readonly supported: boolean;

  /** Available labels (empty if not supported or not configured) */
  readonly labels: AvailableLabel[];

  /** Error message if labels could not be retrieved */
  readonly error?: string;
}

/**
 * Option for single-select fields
 */
export interface ProjectFieldOption {
  /** Option identifier */
  readonly id: string;

  /** Option display name */
  readonly name: string;
}

/**
 * Project field information
 */
export interface ProjectField {
  /** Field identifier */
  readonly id: string;

  /** Field name */
  readonly name: string;

  /** Field type */
  readonly type: ProjectFieldType;

  /** Available options (for SINGLE_SELECT fields) */
  readonly options?: ProjectFieldOption[];
}

/**
 * Result of setting a project item field value
 */
export interface SetFieldResult {
  /** Whether the operation succeeded */
  readonly success: boolean;

  /** Error message if failed */
  readonly error?: string;
}

// =============================================================================
// Provider Interface
// =============================================================================

/**
 * ProjectManagementProvider - Interface for external project management systems
 *
 * Implementations:
 * - GitHubProjectManagementProvider (wraps GitHubCLI)
 * - Future: JiraProvider, LinearProvider, AsanaProvider, etc.
 *
 * Design principles:
 * - All operations are async (remote APIs)
 * - Issue references are strings (accommodates different ID formats)
 * - Provider identity is explicit for logging
 * - No PR operations (Git-hosting specific)
 */
export interface ProjectManagementProvider {
  // ===========================================================================
  // Identity
  // ===========================================================================

  /**
   * Unique identifier for this provider type
   * Examples: "github", "jira", "linear", "asana"
   */
  readonly providerId: string;

  /**
   * Human-readable display name
   * Examples: "GitHub", "Jira", "Linear", "Asana"
   */
  readonly displayName: string;

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Check if the provider is enabled for sync operations
   *
   * Returns false if sync is disabled or not configured.
   * When disabled, sync operations will no-op gracefully.
   */
  isEnabled(): boolean;

  /**
   * Check if a project board is configured for this provider
   */
  hasProjectBoard(): boolean;

  /**
   * Get the configured assignee for auto-assignment, if any
   */
  getAssignee(): string | undefined;

  /**
   * Get custom labels to add to all created issues
   */
  getCustomLabels(): string[];

  /**
   * Get the column name for a task status
   *
   * Uses internally configured column mapping to translate task status
   * to the appropriate project board column name.
   *
   * @param status - The task status to map
   * @returns The column name for the status
   */
  getColumnForStatus(status: TaskStatus): string;

  /**
   * Get the project ID if configured
   */
  getProjectId(): string | undefined;

  /**
   * Get the label-to-field mapping for project custom fields
   *
   * Returns the mapping from task label keys to project field IDs.
   * Returns undefined if no mapping is configured.
   */
  getLabelFieldMapping(): Record<string, string> | undefined;

  // ===========================================================================
  // High-Level Operations (use internal config)
  // ===========================================================================

  /**
   * Move a project item to the column for the given status
   *
   * Uses internal projectId and column mapping.
   * No-ops if itemId is null/undefined or no project configured.
   *
   * @param itemId - The project item ID (will be remoteProjectItemId after rename)
   * @param status - The status to move to
   */
  moveItemToStatusColumn(itemId: string | null | undefined, status: TaskStatus): Effect<void>;

  /**
   * Assign an issue to the configured assignee
   *
   * Uses internal assignee configuration.
   * No-ops if no assignee configured.
   *
   * @param issueRef - External issue reference (will be remoteIssueNumber after rename)
   */
  assignIssueToConfiguredUser(issueRef: string): Effect<void>;

  // ===========================================================================
  // Authentication & Validation
  // ===========================================================================

  /**
   * Check if the provider is authenticated and ready to use
   */
  checkAuth(): Effect<AuthResult>;

  /**
   * Check if the current repository/workspace is accessible
   *
   * For GitHub: checks if we're in a git repo with a GitHub remote
   * For Jira: checks if the workspace is configured
   */
  checkRepository(): Effect<RepositoryResult>;

  // ===========================================================================
  // Issue Operations
  // ===========================================================================

  /**
   * Create a new issue in the external system
   */
  createIssue(params: CreateIssueParams): Effect<ExternalIssue>;

  /**
   * Update an existing issue
   */
  updateIssue(params: UpdateIssueParams): Effect<ExternalIssue>;

  /**
   * Close an issue's external issue in the external system
   *
   * Provider abstraction pattern: accepts the whole entity and handles internally:
   * 1. Extracts the external reference from the entity (provider-specific)
   * 2. No-ops gracefully if entity has no external reference
   * 3. Only throws for actual API errors
   *
   * @param issue - The Issue to close externally
   * @param comment - Optional comment to add when closing
   */
  closeIssue(issue: Issue, comment?: string): Effect<void>;

  /**
   * Close a task's external issue in the external system
   *
   * Same pattern as closeIssue but for Task entities.
   *
   * @param task - The Task to close externally
   * @param comment - Optional comment to add when closing
   */
  closeIssueByTask(task: Task, comment?: string): Effect<void>;

  /**
   * Reopen a closed issue
   *
   * @param issueRef - External issue identifier
   */
  reopenIssue(issueRef: string): Effect<void>;

  /**
   * Get issue details
   *
   * @param issueRef - External issue identifier
   * @returns Issue data or null if not found
   */
  getIssue(issueRef: string): Effect<ExternalIssue | null>;

  /**
   * Search for issues matching a query
   *
   * @param query - Search query (matches title and body)
   * @param state - Filter by state (default: "all")
   * @param limit - Maximum number of results (default: 10)
   */
  searchIssues(
    query: string,
    state?: "open" | "closed" | "all",
    limit?: number
  ): Effect<ExternalIssue[]>;

  // ===========================================================================
  // Label/Tag Operations
  // ===========================================================================

  /**
   * Ensure labels/tags exist in the external system
   *
   * Creates any labels that don't already exist.
   *
   * @param labels - Array of label names to ensure exist
   */
  ensureLabelsExist(labels: string[]): Effect<void>;

  // ===========================================================================
  // Project/Board Operations
  // ===========================================================================

  /**
   * Add an issue to a project/board
   *
   * @param issueNodeId - External node ID of the issue (for GraphQL APIs)
   * @param projectId - Project/board identifier
   * @returns Result with project item ID
   */
  addToProject(issueNodeId: string, projectId: string): Effect<ProjectItemResult>;

  /**
   * Move an issue to a specific column/status on a project board
   *
   * @param itemId - Project item ID (from addToProject)
   * @param projectId - Project/board identifier
   * @param columnName - Name of the column/status to move to
   */
  moveToColumn(itemId: string, projectId: string, columnName: string): Effect<void>;

  /**
   * Check if a project/board exists and is accessible
   *
   * @param projectId - Project/board identifier
   * @returns True if accessible
   */
  checkProject(projectId: string): Effect<boolean>;

  /**
   * Get project/board details
   *
   * @param projectId - Project/board identifier
   * @returns Project details or null if not found
   */
  getProjectDetails(projectId: string): Effect<ProjectDetails | null>;

  /**
   * Get the status field information for a project
   *
   * @param projectId - Project/board identifier
   * @returns Status field info with available columns, or null if not applicable
   */
  getProjectStatusField(projectId: string): Effect<ProjectStatusField | null>;

  /**
   * Get all fields for a project
   *
   * Returns field definitions including type and options for single-select fields.
   * Used for label-to-field mapping.
   *
   * @param projectId - Project/board identifier
   * @returns Array of project fields
   */
  getProjectFields(projectId: string): Effect<ProjectField[]>;

  /**
   * Set a field value on a project item
   *
   * For single-select fields, resolves the human-readable value to the option ID.
   * Value matching is case-insensitive.
   *
   * @param projectId - Project/board identifier
   * @param itemId - Project item identifier
   * @param fieldId - Field identifier
   * @param value - The value to set (human-readable for single-select)
   * @returns Result indicating success or failure
   */
  setProjectItemField(
    projectId: string,
    itemId: string,
    fieldId: string,
    value: string
  ): Effect<SetFieldResult>;

  /**
   * Clear a field value on a project item
   *
   * @param projectId - Project/board identifier
   * @param itemId - Project item identifier
   * @param fieldId - Field identifier
   * @returns Result indicating success or failure
   */
  clearProjectItemField(projectId: string, itemId: string, fieldId: string): Effect<SetFieldResult>;

  // ===========================================================================
  // Labels
  // ===========================================================================

  /**
   * Get available labels for issues and tasks
   *
   * Returns labels that can be applied to issues/tasks in this provider.
   * For GitHub: Returns project custom fields (excluding Status).
   * For Jira: Returns custom fields configured for the project.
   *
   * The provider handles field ID resolution internally - callers only
   * work with human-readable label names and values. The provider uses
   * its internally configured project/board identifier.
   *
   * @returns Available labels with their valid values
   */
  getAvailableLabels(): Effect<AvailableLabelsResult>;

  // ===========================================================================
  // Hierarchical Issues (Parent-Child Linking)
  // ===========================================================================

  /**
   * Link an issue as a child of another issue
   *
   * For GitHub: Uses sub-issues API
   * For Jira: Uses issue linking
   * For Linear: Uses parent relationship
   *
   * @param parentRef - External identifier of the parent issue
   * @param childRef - External identifier of the child issue
   */
  linkParentChild(parentRef: string, childRef: string): Effect<void>;

  // ===========================================================================
  // Comments
  // ===========================================================================

  /**
   * Add a comment to an issue
   *
   * @param issueRef - External issue identifier
   * @param body - Comment text (supports markdown)
   */
  addComment(issueRef: string, body: string): Effect<void>;

  // ===========================================================================
  // Assignment
  // ===========================================================================

  /**
   * Assign an issue to a user
   *
   * @param issueRef - External issue identifier
   * @param assignee - Username to assign (provider-specific format)
   */
  assignIssue(issueRef: string, assignee: string): Effect<void>;
}

/**
 * Error thrown by ProjectManagementProvider operations
 */
/**
 * Standalone Service tag for ProjectManagementProvider.
 * Allows operations to yield* ProjectManagementProviderTag.
 */
export class ProjectManagementProviderTag extends Service<ProjectManagementProvider>()(
  "projectManagementProvider"
) {}

export class ProjectManagementProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly operation: string,
    public readonly cause?: Error
  ) {
    super(`[${providerId}] ${operation}: ${message}`);
    this.name = "ProjectManagementProviderError";
  }
}
