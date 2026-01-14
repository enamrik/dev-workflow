/**
 * SnapshotTool - Issue versioning and snapshot operations
 *
 * Provides operations for viewing version history, reverting to
 * previous snapshots, and time-travel viewing of issue state.
 */

import type { IssueService, VersioningService } from "@dev-workflow/core";

// =============================================================================
// Types
// =============================================================================

export interface GetSnapshotHistoryInput {
  issueId?: string;
  issueNumber?: number;
}

export interface RevertToSnapshotInput {
  issueNumber: number;
  version: number;
  notes?: string;
}

export interface ViewSnapshotInput {
  issueNumber: number;
  version: number;
}

// =============================================================================
// SnapshotTool Class
// =============================================================================

export class SnapshotTool {
  constructor(
    private readonly issueService: IssueService,
    private readonly versioningService: VersioningService
  ) {}

  /**
   * Get version history for an issue showing all snapshots.
   */
  getSnapshotHistory(input: GetSnapshotHistoryInput) {
    const { issueId, issueNumber } = input;

    // Resolve issue number from ID if needed
    let resolvedIssueNumber = issueNumber;
    if (!resolvedIssueNumber && issueId) {
      const issue = this.issueService.findById(issueId);
      if (!issue) {
        throw new Error(`Issue not found: ${issueId}`);
      }
      resolvedIssueNumber = issue.number;
    }

    if (!resolvedIssueNumber) {
      throw new Error("Either issueId or issueNumber is required");
    }

    return this.versioningService.getSnapshotHistory(resolvedIssueNumber);
  }

  /**
   * Revert issue to a previous version snapshot.
   * Creates new snapshot based on old data.
   */
  revertToSnapshot(input: RevertToSnapshotInput) {
    const { issueNumber, version, notes } = input;
    return this.versioningService.revertToSnapshot(issueNumber, version, "claude-agent", notes);
  }

  /**
   * View the complete state of an issue at a specific version (time travel, read-only).
   */
  viewSnapshot(input: ViewSnapshotInput) {
    const { issueNumber, version } = input;
    return this.versioningService.viewSnapshot(issueNumber, version);
  }
}
