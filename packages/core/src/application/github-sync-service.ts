/**
 * GitHubSyncService - Orchestrates synchronization between local issues and GitHub
 *
 * Follows push-only sync pattern: local issues are source of truth,
 * pushed to GitHub on create/update. GitHub-first approach ensures
 * atomicity: create on GitHub before local to avoid partial state.
 */

import type { Issue, IssueRepository } from "../domain/issue.js";
import type {
  GitHubSyncState,
  GitHubSyncResult,
  GitHubIssueData,
} from "../domain/github.js";
import type { GitHubCLI } from "../infrastructure/github/github-cli.js";
import type { GitHubIssueSync, GitHubLabels } from "./config-service.js";

/**
 * Error thrown when GitHub sync fails
 */
export class GitHubSyncError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "GitHubSyncError";
  }
}

/**
 * GitHubSyncService orchestrates push-only sync to GitHub
 *
 * Key design decisions:
 * - Local issues are source of truth
 * - Push-only: local -> GitHub (no pull)
 * - GitHub-first on create: create on GitHub before local for atomicity
 * - Fail fast: if sync fails, operation fails (no partial state)
 */
export class GitHubSyncService {
  constructor(
    private readonly issueRepository: IssueRepository,
    private readonly githubCLI: GitHubCLI,
    private readonly config: GitHubIssueSync
  ) {}

  /**
   * Create a GitHub issue for a new local issue
   *
   * Called BEFORE creating the local issue to ensure atomicity.
   * If this fails, no local issue is created.
   *
   * @param title - Issue title
   * @param description - Issue description
   * @param acceptanceCriteria - Acceptance criteria for the issue
   * @param type - Issue type (FEATURE, BUG, etc.)
   * @returns GitHub issue data and sync state
   */
  async createGitHubIssue(
    title: string,
    description: string,
    acceptanceCriteria: string[],
    type: string
  ): Promise<{ data: GitHubIssueData; syncState: GitHubSyncState }> {
    // Build labels from config
    const labels = this.buildLabels(type);

    // Ensure labels exist on the repo
    await this.ensureLabelsExist(labels);

    // Build issue body
    const body = this.buildIssueBody(description, acceptanceCriteria);

    // Create on GitHub (gh CLI auto-detects repo from git remotes)
    const data = await this.githubCLI.createIssue(title, body, labels);

    // Add to project if configured
    let projectItemId: string | null = null;
    if (this.config.projectId) {
      try {
        projectItemId = await this.githubCLI.addToProject(
          this.config.projectId,
          data.nodeId
        );
      } catch (error) {
        // Log but don't fail - project is optional
        console.warn("Failed to add to project:", error);
      }
    }

    const syncState: GitHubSyncState = {
      githubIssueNumber: data.number,
      githubUrl: data.url,
      githubNodeId: data.nodeId,
      syncStatus: "SYNCED",
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: null,
      projectItemId,
    };

    return { data, syncState };
  }

  /**
   * Update a GitHub issue for an existing local issue
   *
   * Called BEFORE updating the local issue to ensure atomicity.
   * If this fails, no local update is made.
   *
   * @param issue - The issue being updated (before update)
   * @param updates - The updates being applied
   * @returns Updated sync state
   */
  async updateGitHubIssue(
    issue: Issue,
    updates: Partial<Issue>
  ): Promise<GitHubSyncState> {
    if (!issue.githubSync?.githubIssueNumber) {
      throw new GitHubSyncError("Issue has no GitHub link");
    }

    const githubNumber = issue.githubSync.githubIssueNumber;

    // Merge updates with current values
    const title = updates.title ?? issue.title;
    const description = updates.description ?? issue.description;
    const acceptanceCriteria =
      updates.acceptanceCriteria ?? issue.acceptanceCriteria;
    const type = updates.type ?? issue.type;
    const status = updates.status ?? issue.status;

    // Build labels from config
    const labels = this.buildLabels(type);

    // Ensure labels exist on the repo
    await this.ensureLabelsExist(labels);

    // Build issue body
    const body = this.buildIssueBody(description, acceptanceCriteria);

    // Update on GitHub (gh CLI auto-detects repo from git remotes)
    await this.githubCLI.updateIssue(githubNumber, title, body, labels);

    // Handle status change to CLOSED
    if (status === "CLOSED" && issue.status !== "CLOSED") {
      await this.githubCLI.closeIssue(githubNumber);
    }

    // Handle reopening (CLOSED -> not CLOSED)
    if (status !== "CLOSED" && issue.status === "CLOSED") {
      await this.githubCLI.reopenIssue(githubNumber);
    }

    return {
      ...issue.githubSync,
      syncStatus: "SYNCED",
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: null,
    };
  }

  /**
   * Sync an existing issue that wasn't synced before
   *
   * @param issue - The issue to sync
   * @returns Sync result
   */
  async syncExistingIssue(issue: Issue): Promise<GitHubSyncResult> {
    try {
      const { data, syncState } = await this.createGitHubIssue(
        issue.title,
        issue.description,
        issue.acceptanceCriteria,
        issue.type
      );

      // Update the issue with sync state
      this.issueRepository.update(issue.id, { githubSync: syncState });

      return {
        success: true,
        action: "created",
        githubIssueNumber: data.number,
        githubUrl: data.url,
        githubNodeId: data.nodeId,
        projectItemId: syncState.projectItemId ?? undefined,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Update issue with error state
      this.issueRepository.update(issue.id, {
        githubSync: {
          githubIssueNumber: null,
          githubUrl: null,
          githubNodeId: null,
          syncStatus: "PUSH_FAILED",
          lastSyncedAt: null,
          lastSyncError: errorMessage,
          projectItemId: null,
        },
      });

      return {
        success: false,
        action: "none",
        error: errorMessage,
      };
    }
  }

  /**
   * Check if GitHub CLI is authenticated
   */
  async checkAuth(): Promise<boolean> {
    return this.githubCLI.checkAuth();
  }


  /**
   * Build labels array from issue type and config
   */
  private buildLabels(type: string): string[] {
    const labels: string[] = [];

    if (this.config.labels?.typeLabels) {
      const typeLabel =
        this.config.labels.typeLabels[
          type as keyof GitHubLabels["typeLabels"]
        ];
      if (typeLabel) {
        labels.push(typeLabel);
      }
    }

    if (this.config.labels?.customLabels) {
      labels.push(...this.config.labels.customLabels);
    }

    return labels;
  }

  /**
   * Build issue body from description and acceptance criteria
   */
  private buildIssueBody(
    description: string,
    acceptanceCriteria: string[]
  ): string {
    const sections: string[] = [description];

    if (acceptanceCriteria.length > 0) {
      sections.push("\n## Acceptance Criteria\n");
      for (const criterion of acceptanceCriteria) {
        sections.push(`- [ ] ${criterion}`);
      }
    }

    return sections.join("\n");
  }

  /**
   * Ensure all required labels exist on the repository
   */
  private async ensureLabelsExist(labels: string[]): Promise<void> {
    if (labels.length === 0) return;

    try {
      // gh CLI auto-detects repo from git remotes
      const existingLabels = await this.githubCLI.listLabels();
      const existingSet = new Set(existingLabels);

      // Default colors for different label types
      const labelColors: Record<string, string> = {
        feature: "a2eeef",
        bug: "d73a4a",
        enhancement: "84b6eb",
        task: "c5def5",
      };

      for (const label of labels) {
        if (!existingSet.has(label)) {
          const color = labelColors[label.toLowerCase()] ?? "ededed";
          await this.githubCLI.createLabel(label, color);
        }
      }
    } catch (error) {
      // Don't fail if we can't ensure labels - just warn
      console.warn("Failed to ensure labels exist:", error);
    }
  }
}
