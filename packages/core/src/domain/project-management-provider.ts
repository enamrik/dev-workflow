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

  /** Project/board item ID (if added to a project/board) */
  readonly projectItemId: string | null;
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

  /** Project item ID (if added to project) */
  readonly projectItemId?: string;

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
  // Authentication & Validation
  // ===========================================================================

  /**
   * Check if the provider is authenticated and ready to use
   */
  checkAuth(): Promise<AuthResult>;

  /**
   * Check if the current repository/workspace is accessible
   *
   * For GitHub: checks if we're in a git repo with a GitHub remote
   * For Jira: checks if the workspace is configured
   */
  checkRepository(): Promise<RepositoryResult>;

  // ===========================================================================
  // Issue Operations
  // ===========================================================================

  /**
   * Create a new issue in the external system
   */
  createIssue(params: CreateIssueParams): Promise<ExternalIssue>;

  /**
   * Update an existing issue
   */
  updateIssue(params: UpdateIssueParams): Promise<ExternalIssue>;

  /**
   * Close an issue
   *
   * @param issueRef - External issue identifier
   * @param comment - Optional comment to add when closing
   */
  closeIssue(issueRef: string, comment?: string): Promise<void>;

  /**
   * Reopen a closed issue
   *
   * @param issueRef - External issue identifier
   */
  reopenIssue(issueRef: string): Promise<void>;

  /**
   * Get issue details
   *
   * @param issueRef - External issue identifier
   * @returns Issue data or null if not found
   */
  getIssue(issueRef: string): Promise<ExternalIssue | null>;

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
  ): Promise<ExternalIssue[]>;

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
  ensureLabelsExist(labels: string[]): Promise<void>;

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
  addToProject(issueNodeId: string, projectId: string): Promise<ProjectItemResult>;

  /**
   * Move an issue to a specific column/status on a project board
   *
   * @param itemId - Project item ID (from addToProject)
   * @param projectId - Project/board identifier
   * @param columnName - Name of the column/status to move to
   */
  moveToColumn(itemId: string, projectId: string, columnName: string): Promise<void>;

  /**
   * Check if a project/board exists and is accessible
   *
   * @param projectId - Project/board identifier
   * @returns True if accessible
   */
  checkProject(projectId: string): Promise<boolean>;

  /**
   * Get project/board details
   *
   * @param projectId - Project/board identifier
   * @returns Project details or null if not found
   */
  getProjectDetails(projectId: string): Promise<ProjectDetails | null>;

  /**
   * Get the status field information for a project
   *
   * @param projectId - Project/board identifier
   * @returns Status field info with available columns, or null if not applicable
   */
  getProjectStatusField(projectId: string): Promise<ProjectStatusField | null>;

  /**
   * Get all fields for a project
   *
   * Returns field definitions including type and options for single-select fields.
   * Used for label-to-field mapping.
   *
   * @param projectId - Project/board identifier
   * @returns Array of project fields
   */
  getProjectFields(projectId: string): Promise<ProjectField[]>;

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
  ): Promise<SetFieldResult>;

  /**
   * Clear a field value on a project item
   *
   * @param projectId - Project/board identifier
   * @param itemId - Project item identifier
   * @param fieldId - Field identifier
   * @returns Result indicating success or failure
   */
  clearProjectItemField(
    projectId: string,
    itemId: string,
    fieldId: string
  ): Promise<SetFieldResult>;

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
  linkParentChild(parentRef: string, childRef: string): Promise<void>;

  // ===========================================================================
  // Comments
  // ===========================================================================

  /**
   * Add a comment to an issue
   *
   * @param issueRef - External issue identifier
   * @param body - Comment text (supports markdown)
   */
  addComment(issueRef: string, body: string): Promise<void>;

  // ===========================================================================
  // Assignment
  // ===========================================================================

  /**
   * Assign an issue to a user
   *
   * @param issueRef - External issue identifier
   * @param assignee - Username to assign (provider-specific format)
   */
  assignIssue(issueRef: string, assignee: string): Promise<void>;
}

/**
 * Error thrown by ProjectManagementProvider operations
 */
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
