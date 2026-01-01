/**
 * Domain types for GitHub integration
 *
 * Tracks synchronization state between local issues and GitHub issues.
 * Local issues are the source of truth; GitHub is a sync target.
 */

/**
 * GitHub sync status for an issue
 */
export type GitHubSyncStatus = "NOT_SYNCED" | "SYNCED" | "PUSH_FAILED";

/**
 * GitHub sync state - tracks the link between local and GitHub issue
 *
 * This is a value object that captures the synchronization state.
 * The local issue is always the source of truth.
 */
export interface GitHubSyncState {
  /** GitHub issue number (e.g., 42 for org/repo#42) */
  readonly githubIssueNumber: number | null;

  /** GitHub issue URL for easy access */
  readonly githubUrl: string | null;

  /** GitHub issue node ID (for GraphQL API / Projects) */
  readonly githubNodeId: string | null;

  /** Current sync status */
  readonly syncStatus: GitHubSyncStatus;

  /** Last successful sync timestamp (ISO string) */
  readonly lastSyncedAt: string | null;

  /** Error message if last sync failed */
  readonly lastSyncError: string | null;

  /** GitHub Project item ID (if added to a project) */
  readonly projectItemId: string | null;
}

/**
 * GitHub issue data returned from gh CLI
 */
export interface GitHubIssueData {
  /** GitHub issue number */
  number: number;

  /** Full GitHub issue URL */
  url: string;

  /** GitHub node ID (for GraphQL operations) */
  nodeId: string;

  /** Issue title */
  title: string;

  /** Issue body/description */
  body: string;

  /** Issue state */
  state: "OPEN" | "CLOSED";

  /** Labels on the issue */
  labels: string[];
}

/**
 * GitHub PR state
 */
export type GitHubPRState = "OPEN" | "CLOSED" | "MERGED";

/**
 * Merge strategy for GitHub PRs
 */
export type GitHubMergeStrategy = "merge" | "squash" | "rebase";

/**
 * GitHub PR data returned from gh CLI
 */
export interface GitHubPRData {
  /** GitHub PR number */
  number: number;

  /** Full GitHub PR URL */
  url: string;

  /** GitHub node ID (for GraphQL operations) */
  nodeId: string;

  /** PR title */
  title: string;

  /** PR body/description */
  body: string;

  /** PR state */
  state: GitHubPRState;

  /** Whether the PR is a draft */
  isDraft: boolean;

  /** Head branch (source branch) */
  headBranch: string;

  /** Base branch (target branch) */
  baseBranch: string;

  /** Whether the PR has been merged */
  merged: boolean;

  /** Whether the PR is mergeable */
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
}

/**
 * Result of a sync operation
 */
export interface GitHubSyncResult {
  /** Whether the sync succeeded */
  success: boolean;

  /** What action was taken */
  action: "created" | "updated" | "closed" | "none";

  /** GitHub issue number (if created/updated) */
  githubIssueNumber?: number;

  /** GitHub issue URL (if created/updated) */
  githubUrl?: string;

  /** GitHub node ID (if created) */
  githubNodeId?: string;

  /** Project item ID (if added to project) */
  projectItemId?: string;

  /** Error message (if failed) */
  error?: string;
}
