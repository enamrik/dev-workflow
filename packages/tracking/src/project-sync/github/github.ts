/**
 * Domain types for GitHub integration
 *
 * Contains GitHub-specific types for PR operations (which are Git-hosting specific).
 * Issue/task sync types are provider-agnostic and live in project-management-provider.ts.
 */

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
