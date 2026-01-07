/**
 * GitHubSyncService - Orchestrates synchronization between local issues and external project management systems
 *
 * Follows push-only sync pattern: local issues are source of truth,
 * pushed to external system on create/update. External-first approach ensures
 * atomicity: create on external system before local to avoid partial state.
 *
 * Uses ProjectManagementProvider for abstraction, allowing sync with GitHub, Jira, Linear, etc.
 */

import type { Issue, IssueRepository } from "../domain/issue.js";
import type { GitHubSyncState, GitHubSyncResult } from "../domain/github.js";
import type { ProjectManagementProvider } from "../domain/project-management-provider.js";
import type {
  GitHubIssueSyncConfig,
  GitHubLabelsConfig,
} from "../infrastructure/database/schema.js";
import type { ProjectRepository } from "../domain/project.js";

/**
 * Error thrown when sync fails
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
 * GitHubSyncService orchestrates push-only sync to external project management systems
 *
 * Key design decisions:
 * - Local issues are source of truth
 * - Push-only: local -> external (no pull)
 * - External-first on create: create externally before local for atomicity
 * - Fail fast: if sync fails, operation fails (no partial state)
 * - Config is read fresh from database on each call (not cached)
 * - Uses ProjectManagementProvider for abstraction
 */
export class GitHubSyncService {
  constructor(
    private readonly issueRepository: IssueRepository,
    private readonly provider: ProjectManagementProvider,
    private readonly projectRepository: ProjectRepository,
    private readonly projectId: string
  ) {}

  /**
   * Get fresh GitHub sync config from the database
   * This ensures we always use the latest config, even if updated after server start
   */
  private async getConfig(): Promise<GitHubIssueSyncConfig | null> {
    const project = await this.projectRepository.findById(this.projectId);
    return project?.githubSync ?? null;
  }

  /**
   * Create an external issue for a new local issue
   *
   * Called BEFORE creating the local issue to ensure atomicity.
   * If this fails, no local issue is created.
   *
   * @param title - Issue title
   * @param description - Issue description
   * @param acceptanceCriteria - Acceptance criteria for the issue
   * @param type - Issue type (FEATURE, BUG, etc.)
   * @returns External issue data and sync state
   */
  async createGitHubIssue(
    title: string,
    description: string,
    acceptanceCriteria: string[],
    type: string
  ): Promise<{
    data: { number: number; url: string; nodeId: string };
    syncState: GitHubSyncState;
  }> {
    // Get fresh config from database
    const config = await this.getConfig();
    if (!config?.enabled) {
      throw new GitHubSyncError("GitHub sync is not enabled");
    }

    // Build labels from config
    const labels = this.buildLabels(config, type);

    // Ensure labels exist on the repo (provider handles this)
    await this.provider.ensureLabelsExist(labels);

    // Build issue body
    const body = this.buildIssueBody(description, acceptanceCriteria);

    // Create on external system via provider
    const externalIssue = await this.provider.createIssue({ title, body, labels });

    // Add to project if configured - fail fast if association fails
    let projectItemId: string | null = null;
    if (config.projectId && externalIssue.nodeId) {
      try {
        const result = await this.provider.addToProject(externalIssue.nodeId, config.projectId);

        // Verify the association succeeded - projectItemId should be a valid string
        if (!result.success || !result.itemId) {
          throw new GitHubSyncError(
            `Project association returned empty item ID for project ${config.projectId}`
          );
        }
        projectItemId = result.itemId;
      } catch (error) {
        // Wrap and re-throw with context - don't silently ignore
        if (error instanceof GitHubSyncError) {
          throw error;
        }
        throw new GitHubSyncError(
          `Failed to add issue to GitHub Project ${config.projectId}`,
          error
        );
      }
    }

    const syncState: GitHubSyncState = {
      githubIssueNumber: externalIssue.numericId ?? parseInt(externalIssue.id, 10),
      githubUrl: externalIssue.url,
      githubNodeId: externalIssue.nodeId ?? null,
      syncStatus: "SYNCED",
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: null,
      projectItemId,
    };

    // Return data in expected format for backwards compatibility
    const data = {
      number: externalIssue.numericId ?? parseInt(externalIssue.id, 10),
      url: externalIssue.url,
      nodeId: externalIssue.nodeId ?? "",
    };

    return { data, syncState };
  }

  /**
   * Update an external issue for an existing local issue
   *
   * Called BEFORE updating the local issue to ensure atomicity.
   * If this fails, no local update is made.
   *
   * @param issue - The issue being updated (before update)
   * @param updates - The updates being applied
   * @returns Updated sync state
   */
  async updateGitHubIssue(issue: Issue, updates: Partial<Issue>): Promise<GitHubSyncState> {
    // Get fresh config from database
    const config = await this.getConfig();
    if (!config?.enabled) {
      throw new GitHubSyncError("GitHub sync is not enabled");
    }

    if (!issue.githubSync?.githubIssueNumber) {
      throw new GitHubSyncError("Issue has no GitHub link");
    }

    const issueRef = String(issue.githubSync.githubIssueNumber);

    // Merge updates with current values
    const title = updates.title ?? issue.title;
    const description = updates.description ?? issue.description;
    const acceptanceCriteria = updates.acceptanceCriteria ?? issue.acceptanceCriteria;
    const type = updates.type ?? issue.type;
    const status = updates.status ?? issue.status;

    // Build labels from config
    const labels = this.buildLabels(config, type);

    // Ensure labels exist on the repo (provider handles this)
    await this.provider.ensureLabelsExist(labels);

    // Build issue body
    const body = this.buildIssueBody(description, acceptanceCriteria);

    // Update on external system via provider
    await this.provider.updateIssue({ issueRef, title, body, labels });

    // Handle status change to CLOSED
    if (status === "CLOSED" && issue.status !== "CLOSED") {
      await this.provider.closeIssue(issueRef);
    }

    // Handle reopening (CLOSED -> not CLOSED)
    if (status !== "CLOSED" && issue.status === "CLOSED") {
      await this.provider.reopenIssue(issueRef);
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
      const errorMessage = error instanceof Error ? error.message : String(error);

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
   * Check if GitHub sync is currently enabled
   * This reads fresh config from the database
   */
  async isEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return config?.enabled ?? false;
  }

  /**
   * Check if the provider is authenticated
   */
  async checkAuth(): Promise<boolean> {
    const result = await this.provider.checkAuth();
    return result.authenticated;
  }

  /**
   * Build labels array from issue type and config
   */
  private buildLabels(config: GitHubIssueSyncConfig, type: string): string[] {
    const labels: string[] = [];

    if (config.labels?.typeLabels) {
      const typeLabel = config.labels.typeLabels[type as keyof GitHubLabelsConfig["typeLabels"]];
      if (typeLabel) {
        labels.push(typeLabel);
      }
    }

    if (config.labels?.customLabels) {
      labels.push(...config.labels.customLabels);
    }

    return labels;
  }

  /**
   * Build issue body from description and acceptance criteria
   */
  private buildIssueBody(description: string, acceptanceCriteria: string[]): string {
    const sections: string[] = [description];

    if (acceptanceCriteria.length > 0) {
      sections.push("\n## Acceptance Criteria\n");
      for (const criterion of acceptanceCriteria) {
        sections.push(`- [ ] ${criterion}`);
      }
    }

    return sections.join("\n");
  }
}
