/**
 * TaskGitHubSyncService - Orchestrates synchronization between tasks and GitHub issues
 *
 * Key differences from GitHubSyncService:
 * - Syncs tasks (not dev-workflow issues) to GitHub issues
 * - Creates GitHub issues when tasks move from PLANNED → BACKLOG
 * - Keeps task status in sync with GitHub issue state and Project column
 *
 * Follows the same patterns:
 * - Push-only sync: tasks are source of truth
 * - GitHub-first on create: create on GitHub before updating local
 * - Fail fast: if sync fails, operation fails
 */

import type { Task, TaskRepository, TaskStatus } from "../domain/task.js";
import type { Issue, IssueRepository } from "../domain/issue.js";
import type { PlanRepository } from "../domain/plan.js";
import type { GitHubSyncState } from "../domain/github.js";
import type { GitHubCLI } from "../infrastructure/github/github-cli.js";
import {
  DEFAULT_COLUMN_MAPPING,
  type GitHubIssueSyncConfig,
  type GitHubLabelsConfig,
} from "../infrastructure/database/schema.js";
import type { ProjectRepository } from "../domain/project.js";

/**
 * Error thrown when task GitHub sync fails
 */
export class TaskGitHubSyncError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "TaskGitHubSyncError";
  }
}

/**
 * Result of activating planned tasks
 */
export interface TaskActivationResult {
  taskId: string;
  taskNumber: number;
  success: boolean;
  githubIssueNumber?: number;
  githubUrl?: string;
  error?: string;
}

/**
 * Result of the full activation operation
 */
export interface ActivationResult {
  success: boolean;
  tasksActivated: TaskActivationResult[];
  issueTransitioned: boolean;
  error?: string;
}

/**
 * TaskGitHubSyncService - Creates and syncs GitHub issues for tasks
 */
export class TaskGitHubSyncService {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly issueRepository: IssueRepository,
    private readonly planRepository: PlanRepository,
    private readonly githubCLI: GitHubCLI,
    private readonly projectRepository: ProjectRepository,
    private readonly projectId: string
  ) {}

  /**
   * Get fresh GitHub sync config from the database
   */
  private getConfig(): GitHubIssueSyncConfig | null {
    const project = this.projectRepository.findById(this.projectId);
    return project?.githubSync ?? null;
  }

  /**
   * Check if GitHub sync is currently enabled
   */
  isEnabled(): boolean {
    const config = this.getConfig();
    return config?.enabled ?? false;
  }

  /**
   * Activate all PLANNED tasks for an issue
   *
   * This is the main entry point called by move_issue_to_backlog.
   * For each PLANNED task:
   * 1. Creates a GitHub issue (if sync enabled)
   * 2. Transitions task from PLANNED → BACKLOG
   *
   * If the issue itself is PLANNED, it's transitioned to OPEN.
   *
   * Uses GitHub-first pattern: create on GitHub before updating local.
   * Fails fast: if any GitHub operation fails, entire operation fails.
   *
   * @param issueId - The dev-workflow issue ID
   * @returns Activation result with details for each task
   */
  async activatePlannedTasks(issueId: string): Promise<ActivationResult> {
    const issue = this.issueRepository.findById(issueId);
    if (!issue) {
      return {
        success: false,
        tasksActivated: [],
        issueTransitioned: false,
        error: `Issue not found: ${issueId}`,
      };
    }

    const plan = this.planRepository.findByIssueId(issueId);
    if (!plan) {
      return {
        success: false,
        tasksActivated: [],
        issueTransitioned: false,
        error: `No plan found for issue: ${issueId}`,
      };
    }

    const allTasks = this.taskRepository.findByPlanId(plan.id);
    const plannedTasks = allTasks.filter((t) => t.status === "PLANNED");

    if (plannedTasks.length === 0) {
      // No PLANNED tasks - just ensure issue is OPEN
      const issueTransitioned = issue.status === "PLANNED";
      if (issueTransitioned) {
        this.issueRepository.update(issue.id, { status: "OPEN" });
      }
      return {
        success: true,
        tasksActivated: [],
        issueTransitioned,
      };
    }

    const config = this.getConfig();
    const results: TaskActivationResult[] = [];

    // Process each PLANNED task
    for (const task of plannedTasks) {
      try {
        if (config?.enabled) {
          // GitHub-first: create issue on GitHub before local update
          const syncState = await this.createGitHubIssueForTask(issue, task);

          // Update task with GitHub sync state
          this.taskRepository.updateGitHubSync(task.id, syncState);
        }

        // Transition task from PLANNED → BACKLOG
        this.taskRepository.updateStatus(
          task.id,
          "BACKLOG",
          "system",
          "Activated via move_issue_to_backlog"
        );

        results.push({
          taskId: task.id,
          taskNumber: task.number,
          success: true,
          githubIssueNumber: config?.enabled
            ? (this.taskRepository.findById(task.id)?.githubSync?.githubIssueNumber ?? undefined)
            : undefined,
          githubUrl: config?.enabled
            ? (this.taskRepository.findById(task.id)?.githubSync?.githubUrl ?? undefined)
            : undefined,
        });
      } catch (error) {
        // Fail fast - if any task fails, entire operation fails
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new TaskGitHubSyncError(
          `Failed to activate task ${task.number}: ${errorMessage}`,
          error
        );
      }
    }

    // Transition issue from PLANNED → OPEN
    const issueTransitioned = issue.status === "PLANNED";
    if (issueTransitioned) {
      this.issueRepository.update(issue.id, { status: "OPEN" });
    }

    return {
      success: true,
      tasksActivated: results,
      issueTransitioned,
    };
  }

  /**
   * Create a GitHub issue for a single task
   *
   * @param issue - The parent dev-workflow issue
   * @param task - The task to create a GitHub issue for
   * @returns The GitHub sync state for the task
   */
  async createGitHubIssueForTask(issue: Issue, task: Task): Promise<GitHubSyncState> {
    const config = this.getConfig();
    if (!config?.enabled) {
      throw new TaskGitHubSyncError("GitHub sync is not enabled");
    }

    // Use plain task title (no prefix) to avoid confusing teammates not using dev-workflow
    const title = task.title;

    // Build body with task description and dev-workflow reference as footer
    const body = this.buildTaskBody(issue, task);

    // Build labels (include issue type label)
    const labels = this.buildLabels(config, issue.type);

    // Ensure labels exist on the repo
    await this.ensureLabelsExist(labels);

    // Create on GitHub (gh CLI auto-detects repo from git remotes)
    const data = await this.githubCLI.createIssue(title, body, labels);

    // Add to project if configured
    let projectItemId: string | null = null;
    if (config.projectId) {
      try {
        projectItemId = await this.githubCLI.addToProject(config.projectId, data.nodeId);

        if (!projectItemId) {
          throw new TaskGitHubSyncError(
            `Project association returned empty item ID for project ${config.projectId}`
          );
        }

        // Move to Backlog column (initial status for activated tasks)
        await this.moveToColumn(projectItemId, config.projectId, "BACKLOG");
      } catch (error) {
        if (error instanceof TaskGitHubSyncError) {
          throw error;
        }
        throw new TaskGitHubSyncError(
          `Failed to add task to GitHub Project ${config.projectId}`,
          error
        );
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

    return syncState;
  }

  /**
   * Sync a task status change to GitHub
   *
   * Called after a task status is updated to keep GitHub in sync.
   * - Moves the project item to the appropriate column
   * - Closes the GitHub issue if task is COMPLETED or ABANDONED
   *
   * @param taskId - The task UUID
   * @param newStatus - The new status that was just set
   */
  async syncTaskStatus(taskId: string, newStatus: TaskStatus): Promise<void> {
    const task = this.taskRepository.findById(taskId);
    if (!task?.githubSync?.githubIssueNumber) {
      // Task doesn't have GitHub sync - nothing to do
      return;
    }

    const config = this.getConfig();
    if (!config?.enabled) {
      return;
    }

    const githubNumber = task.githubSync.githubIssueNumber;
    let syncError: string | null = null;

    // Handle terminal states - close the GitHub issue
    if (newStatus === "COMPLETED" || newStatus === "ABANDONED") {
      try {
        await this.githubCLI.closeIssue(githubNumber);
      } catch (error) {
        syncError = `Failed to close GitHub issue: ${error instanceof Error ? error.message : String(error)}`;
        console.warn(syncError);
      }
    }

    // Move in project kanban if configured
    if (config.projectId && task.githubSync.projectItemId) {
      const result = await this.moveToColumn(
        task.githubSync.projectItemId,
        config.projectId,
        newStatus
      );
      if (!result.success && result.error) {
        syncError = result.error;
      }
    }

    // Update sync state - record any errors
    this.taskRepository.updateGitHubSync(taskId, {
      ...task.githubSync,
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: syncError,
    });
  }

  /**
   * Close GitHub issues for abandoned tasks
   *
   * Called when tasks are abandoned during plan regeneration.
   *
   * @param taskIds - Array of task UUIDs that were abandoned
   */
  async closeAbandonedTaskIssues(taskIds: string[]): Promise<void> {
    const config = this.getConfig();
    if (!config?.enabled) {
      return;
    }

    for (const taskId of taskIds) {
      const task = this.taskRepository.findById(taskId);
      if (task?.githubSync?.githubIssueNumber) {
        try {
          await this.githubCLI.closeIssue(task.githubSync.githubIssueNumber);

          // Update sync state
          this.taskRepository.updateGitHubSync(taskId, {
            ...task.githubSync,
            lastSyncedAt: new Date().toISOString(),
          });
        } catch (error) {
          // Log but don't fail - best effort to close abandoned issues
          console.warn(`Failed to close GitHub issue for abandoned task ${taskId}:`, error);
        }
      }
    }
  }

  /**
   * Build the GitHub issue body for a task
   *
   * Uses clean format without "Parent Issue" linking to avoid confusing
   * teammates not using dev-workflow. Dev-workflow reference is added
   * as an unobtrusive footer note.
   */
  private buildTaskBody(issue: Issue, task: Task): string {
    const sections: string[] = [task.description];

    if (task.acceptanceCriteria.length > 0) {
      sections.push("\n## Acceptance Criteria\n");
      for (const criterion of task.acceptanceCriteria) {
        sections.push(`- [ ] ${criterion}`);
      }
    }

    // Add dev-workflow reference as unobtrusive footer note
    sections.push("");
    sections.push("---");
    sections.push(`Task ${issue.number}.${task.number}: ${task.title}`);

    return sections.join("\n");
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

    // Add a "task" label to distinguish task issues from regular issues
    labels.push("task");

    return labels;
  }

  /**
   * Ensure all required labels exist on the repository
   */
  private async ensureLabelsExist(labels: string[]): Promise<void> {
    if (labels.length === 0) return;

    try {
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

  /**
   * Move a project item to the appropriate column based on task status
   *
   * Uses GitHub Projects v2 GraphQL API to update the Status field.
   * Column names are configurable via project settings (githubSync.columnMapping).
   */
  private async moveToColumn(
    projectItemId: string,
    projectId: string,
    status: TaskStatus
  ): Promise<{ success: boolean; error?: string }> {
    // Get configured column mapping (with defaults for any missing statuses)
    const config = this.getConfig();
    const configuredMapping = config?.columnMapping ?? {};
    const columnMapping: Record<TaskStatus, string> = {
      ...DEFAULT_COLUMN_MAPPING,
      ...configuredMapping,
    };

    const columnName = columnMapping[status];

    try {
      // First, get the project's Status field ID and option ID for the column
      const fieldInfo = await this.getProjectStatusField(projectId);
      if (!fieldInfo) {
        const error = `Could not find Status field in project ${projectId}`;
        console.warn(error);
        return { success: false, error };
      }

      const optionId = fieldInfo.options.find(
        (o) => o.name.toLowerCase() === columnName.toLowerCase()
      )?.id;

      if (!optionId) {
        const error = `Could not find "${columnName}" option in project Status field`;
        console.warn(error);
        return { success: false, error };
      }

      // Update the item's Status field
      await this.updateProjectItemField(projectId, projectItemId, fieldInfo.fieldId, optionId);
      return { success: true };
    } catch (error) {
      // Log but don't fail - project column moves are not critical
      const errorMsg = `Failed to move project item to ${columnName}: ${error instanceof Error ? error.message : String(error)}`;
      console.warn(errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Get the Status field info for a project
   */
  private async getProjectStatusField(
    projectId: string
  ): Promise<{ fieldId: string; options: Array<{ id: string; name: string }> } | null> {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 20) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await this.githubCLI.run([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `projectId=${projectId}`,
    ]);

    if (!result.success) {
      return null;
    }

    try {
      const data = JSON.parse(result.stdout) as {
        data?: {
          node?: {
            fields?: {
              nodes?: Array<{
                id?: string;
                name?: string;
                options?: Array<{ id: string; name: string }>;
              }>;
            };
          };
        };
      };

      const fields = data.data?.node?.fields?.nodes ?? [];
      const statusField = fields.find((f) => f.name?.toLowerCase() === "status" && f.options);

      if (!statusField?.id || !statusField?.options) {
        return null;
      }

      return {
        fieldId: statusField.id,
        options: statusField.options,
      };
    } catch {
      return null;
    }
  }

  /**
   * Update a project item's field value
   */
  private async updateProjectItemField(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string
  ): Promise<void> {
    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { singleSelectOptionId: $optionId }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    const result = await this.githubCLI.run([
      "api",
      "graphql",
      "-f",
      `query=${mutation}`,
      "-f",
      `projectId=${projectId}`,
      "-f",
      `itemId=${itemId}`,
      "-f",
      `fieldId=${fieldId}`,
      "-f",
      `optionId=${optionId}`,
    ]);

    if (!result.success) {
      throw new TaskGitHubSyncError(`Failed to update project item field: ${result.stderr}`);
    }
  }
}
