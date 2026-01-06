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
import type { ProjectManagementProvider } from "../domain/project-management-provider.js";
import {
  DEFAULT_COLUMN_MAPPING,
  type GitHubIssueSyncConfig,
} from "../infrastructure/database/schema.js";
import type { ProjectRepository } from "../domain/project.js";
import type { TemplateService } from "../infrastructure/templates/template-service.js";
import type { TypeService } from "../infrastructure/types/type-service.js";

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
 * Result for a single task sync operation
 */
export interface TaskSyncResult {
  taskId: string;
  taskNumber: number;
  action: "created" | "linked" | "verified" | "skipped";
  githubIssueNumber?: number;
  githubUrl?: string;
  error?: string;
}

/**
 * Result of the sync_issue operation
 */
export interface IssueSyncResult {
  success: boolean;
  issueNumber: number;
  tasksProcessed: number;
  created: TaskSyncResult[];
  linked: TaskSyncResult[];
  verified: TaskSyncResult[];
  skipped: TaskSyncResult[];
  errors: TaskSyncResult[];
}

/**
 * TaskGitHubSyncService - Creates and syncs GitHub issues for tasks
 */
export class TaskGitHubSyncService {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly issueRepository: IssueRepository,
    private readonly planRepository: PlanRepository,
    private readonly provider: ProjectManagementProvider,
    private readonly projectRepository: ProjectRepository,
    private readonly projectId: string,
    private readonly templateService?: TemplateService,
    private readonly typeService?: TypeService
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
   * For imported issues (has sourceGitHubIssueNumber):
   * - 1 task: Link task directly to the parent GitHub issue (no new issue created)
   * - N tasks: Create GitHub sub-issues under the parent, link each task
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

    // Check if this is an imported issue
    const isImportedIssue = issue.sourceGitHubIssueNumber !== undefined;

    // Process each PLANNED task
    for (const task of plannedTasks) {
      try {
        if (config?.enabled) {
          let syncState: GitHubSyncState;

          if (isImportedIssue) {
            // Imported issue - use special handling
            syncState = await this.handleImportedIssueTask(issue, task, plannedTasks.length);
          } else {
            // Normal issue - create new GitHub issue
            syncState = await this.createGitHubIssueForTask(issue, task);
          }

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
   * Handle task activation for imported issues
   *
   * For imported issues (has sourceGitHubIssueNumber):
   * - 1 task: Link task directly to the parent GitHub issue (no new issue created)
   * - N tasks: Create a new GitHub issue as a sub-issue of the parent
   *
   * @param issue - The parent dev-workflow issue (imported)
   * @param task - The task to activate
   * @param totalTaskCount - Total number of tasks being activated
   * @returns The GitHub sync state for the task
   */
  private async handleImportedIssueTask(
    issue: Issue,
    task: Task,
    totalTaskCount: number
  ): Promise<GitHubSyncState> {
    const parentIssueNumber = issue.sourceGitHubIssueNumber!;

    if (totalTaskCount === 1) {
      // 1 task case: Link directly to the parent GitHub issue
      return await this.linkTaskToParentIssue(parentIssueNumber, issue);
    } else {
      // N tasks case: Create a sub-issue under the parent
      return await this.createSubIssueForTask(parentIssueNumber, issue, task);
    }
  }

  /**
   * Link a task directly to an existing GitHub issue (for 1-task imported issues)
   *
   * @param parentIssueNumber - The GitHub issue number to link to
   * @param _issue - The dev-workflow issue for label context (reserved for future use)
   * @returns The GitHub sync state pointing to the parent issue
   */
  private async linkTaskToParentIssue(
    parentIssueNumber: number,
    _issue: Issue
  ): Promise<GitHubSyncState> {
    // Fetch the parent GitHub issue to get its nodeId and URL
    const parentIssue = await this.provider.getIssue(String(parentIssueNumber));
    if (!parentIssue) {
      throw new TaskGitHubSyncError(`Parent GitHub issue #${parentIssueNumber} not found`);
    }

    const config = this.getConfig()!;

    // Add to project if configured
    let projectItemId: string | null = null;
    if (config.projectId && parentIssue.nodeId) {
      try {
        const result = await this.provider.addToProject(parentIssue.nodeId, config.projectId);

        if (!result.success || !result.itemId) {
          throw new TaskGitHubSyncError(
            result.error ??
              `Project association returned empty item ID for project ${config.projectId}`
          );
        }

        projectItemId = result.itemId;

        // Move to Backlog column
        await this.provider.moveToColumn(projectItemId, config.projectId, "Backlog");
      } catch (error) {
        if (error instanceof TaskGitHubSyncError) {
          throw error;
        }
        throw new TaskGitHubSyncError(
          `Failed to add parent issue to GitHub Project ${config.projectId}`,
          error
        );
      }
    }

    return {
      githubIssueNumber: parentIssue.numericId ?? parseInt(parentIssue.id, 10),
      githubUrl: parentIssue.url,
      githubNodeId: parentIssue.nodeId ?? null,
      syncStatus: "SYNCED",
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: null,
      projectItemId,
    };
  }

  /**
   * Create a GitHub sub-issue for a task (for N-tasks imported issues)
   *
   * Creates a new GitHub issue and links it as a sub-issue of the parent.
   *
   * @param parentIssueNumber - The parent GitHub issue number
   * @param issue - The dev-workflow issue for context
   * @param task - The task to create a sub-issue for
   * @returns The GitHub sync state for the new sub-issue
   */
  private async createSubIssueForTask(
    parentIssueNumber: number,
    issue: Issue,
    task: Task
  ): Promise<GitHubSyncState> {
    // Create a new GitHub issue for this task
    const syncState = await this.createGitHubIssueForTask(issue, task);

    // Link as sub-issue of the parent using the provider
    // The provider abstracts away the details of fetching IDs and linking
    await this.provider.linkParentChild(
      String(parentIssueNumber),
      String(syncState.githubIssueNumber)
    );

    return syncState;
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
    // Uses task template if available (based on task type)
    const body = await this.buildTaskBody(issue, task);

    // Build labels using task type (for GitHub label mapping)
    const labels = await this.buildLabels(config, task.type);

    // Ensure labels exist on the repo
    await this.provider.ensureLabelsExist(labels);

    // Create on GitHub via provider
    const externalIssue = await this.provider.createIssue({ title, body, labels });

    // Add to project if configured
    let projectItemId: string | null = null;
    if (config.projectId && externalIssue.nodeId) {
      try {
        const result = await this.provider.addToProject(externalIssue.nodeId, config.projectId);

        if (!result.success || !result.itemId) {
          throw new TaskGitHubSyncError(
            result.error ??
              `Project association returned empty item ID for project ${config.projectId}`
          );
        }

        projectItemId = result.itemId;

        // Move to Backlog column (initial status for activated tasks)
        await this.provider.moveToColumn(projectItemId, config.projectId, "Backlog");
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
      githubIssueNumber: externalIssue.numericId ?? parseInt(externalIssue.id, 10),
      githubUrl: externalIssue.url,
      githubNodeId: externalIssue.nodeId ?? null,
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
        await this.provider.closeIssue(String(githubNumber));
      } catch (error) {
        syncError = `Failed to close GitHub issue: ${error instanceof Error ? error.message : String(error)}`;
        console.warn(syncError);
      }
    }

    // Move in project kanban if configured
    if (config.projectId && task.githubSync.projectItemId) {
      const columnName = this.getColumnNameForStatus(config, newStatus);
      try {
        await this.provider.moveToColumn(
          task.githubSync.projectItemId,
          config.projectId,
          columnName
        );
      } catch (error) {
        syncError = `Failed to move to column ${columnName}: ${error instanceof Error ? error.message : String(error)}`;
        console.warn(syncError);
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
          await this.provider.closeIssue(String(task.githubSync.githubIssueNumber));

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
   * Sync GitHub issues for all tasks in an issue
   *
   * This tool repairs GitHub sync state by:
   * - Creating missing GitHub issues for tasks
   * - Linking existing GitHub issues found by title search
   * - Verifying already-linked GitHub issues still exist
   * - Ensuring GitHub Project state is correct
   *
   * Idempotent: safe to run multiple times, produces same result.
   * Non-destructive: never deletes GitHub issues.
   *
   * Handles same scenarios as move_issue_to_backlog:
   * - Imported issues (sourceGitHubIssueNumber): 1 task links to parent, N tasks create sub-issues
   * - Non-imported issues: each task gets its own GitHub issue
   *
   * @param issueNumber - The dev-workflow issue number
   * @returns Sync result with details for each task
   */
  async syncIssue(issueNumber: number): Promise<IssueSyncResult> {
    const issue = this.issueRepository.findByNumber(issueNumber);
    if (!issue) {
      return {
        success: false,
        issueNumber,
        tasksProcessed: 0,
        created: [],
        linked: [],
        verified: [],
        skipped: [],
        errors: [
          {
            taskId: "",
            taskNumber: 0,
            action: "skipped",
            error: `Issue #${issueNumber} not found`,
          },
        ],
      };
    }

    const config = this.getConfig();
    if (!config?.enabled) {
      return {
        success: false,
        issueNumber,
        tasksProcessed: 0,
        created: [],
        linked: [],
        verified: [],
        skipped: [],
        errors: [
          { taskId: "", taskNumber: 0, action: "skipped", error: "GitHub sync is not enabled" },
        ],
      };
    }

    const plan = this.planRepository.findByIssueId(issue.id);
    if (!plan) {
      return {
        success: false,
        issueNumber,
        tasksProcessed: 0,
        created: [],
        linked: [],
        verified: [],
        skipped: [],
        errors: [
          {
            taskId: "",
            taskNumber: 0,
            action: "skipped",
            error: `No plan found for issue #${issueNumber}`,
          },
        ],
      };
    }

    const allTasks = this.taskRepository.findByPlanId(plan.id);

    // Only sync non-terminal tasks (exclude PLANNED, COMPLETED, ABANDONED)
    const tasksToSync = allTasks.filter(
      (t) =>
        t.status === "BACKLOG" ||
        t.status === "READY" ||
        t.status === "IN_PROGRESS" ||
        t.status === "PR_REVIEW"
    );

    if (tasksToSync.length === 0) {
      return {
        success: true,
        issueNumber,
        tasksProcessed: 0,
        created: [],
        linked: [],
        verified: [],
        skipped: [],
        errors: [],
      };
    }

    const created: TaskSyncResult[] = [];
    const linked: TaskSyncResult[] = [];
    const verified: TaskSyncResult[] = [];
    const skipped: TaskSyncResult[] = [];
    const errors: TaskSyncResult[] = [];

    // Check if this is an imported issue
    const isImportedIssue = issue.sourceGitHubIssueNumber !== undefined;

    for (const task of tasksToSync) {
      try {
        const result = await this.syncTask(
          issue,
          task,
          tasksToSync.length,
          isImportedIssue,
          config
        );

        switch (result.action) {
          case "created":
            created.push(result);
            break;
          case "linked":
            linked.push(result);
            break;
          case "verified":
            verified.push(result);
            break;
          case "skipped":
            skipped.push(result);
            break;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          taskId: task.id,
          taskNumber: task.number,
          action: "skipped",
          error: errorMessage,
        });
      }
    }

    return {
      success: errors.length === 0,
      issueNumber,
      tasksProcessed: tasksToSync.length,
      created,
      linked,
      verified,
      skipped,
      errors,
    };
  }

  /**
   * Sync a single task's GitHub issue state
   *
   * @param issue - The parent dev-workflow issue
   * @param task - The task to sync
   * @param totalTaskCount - Total number of tasks being synced (for imported issue logic)
   * @param isImportedIssue - Whether the issue was imported from GitHub
   * @param config - GitHub sync config
   * @returns Sync result for this task
   */
  private async syncTask(
    issue: Issue,
    task: Task,
    totalTaskCount: number,
    isImportedIssue: boolean,
    config: GitHubIssueSyncConfig
  ): Promise<TaskSyncResult> {
    // Case 1: Task already has GitHub sync - verify it exists
    if (task.githubSync?.githubIssueNumber) {
      const existingIssue = await this.provider.getIssue(String(task.githubSync.githubIssueNumber));

      if (existingIssue) {
        // Issue exists - verify project state and return verified
        await this.ensureProjectState(task, config);

        return {
          taskId: task.id,
          taskNumber: task.number,
          action: "verified",
          githubIssueNumber: existingIssue.numericId ?? parseInt(existingIssue.id, 10),
          githubUrl: existingIssue.url,
        };
      }

      // Issue was deleted - clear sync state and proceed to create/link
      this.taskRepository.updateGitHubSync(task.id, {
        githubIssueNumber: null,
        githubUrl: null,
        githubNodeId: null,
        syncStatus: "NOT_SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: "GitHub issue was deleted, re-syncing",
        projectItemId: null,
      });
    }

    // Case 2: No GitHub sync - search for existing issue by title pattern
    const searchPattern = `Task ${issue.number}.${task.number}:`;
    const searchResults = await this.provider.searchIssues(searchPattern, "all", 5);

    // Look for an exact match in the body (footer pattern)
    const matchingIssue = searchResults.find((gh) =>
      gh.body.includes(`Task ${issue.number}.${task.number}: ${task.title}`)
    );

    if (matchingIssue) {
      // Found existing issue - link it
      const syncState = await this.linkExistingGitHubIssue(matchingIssue, task, config);
      this.taskRepository.updateGitHubSync(task.id, syncState);

      return {
        taskId: task.id,
        taskNumber: task.number,
        action: "linked",
        githubIssueNumber: matchingIssue.numericId ?? parseInt(matchingIssue.id, 10),
        githubUrl: matchingIssue.url,
      };
    }

    // Case 3: No existing issue found - create new one
    let syncState: GitHubSyncState;

    if (isImportedIssue) {
      syncState = await this.handleImportedIssueTask(issue, task, totalTaskCount);
    } else {
      syncState = await this.createGitHubIssueForTask(issue, task);
    }

    this.taskRepository.updateGitHubSync(task.id, syncState);

    // Move to correct column based on current task status
    if (syncState.projectItemId && config.projectId) {
      const columnName = this.getColumnNameForStatus(config, task.status);
      await this.provider.moveToColumn(syncState.projectItemId, config.projectId, columnName);
    }

    return {
      taskId: task.id,
      taskNumber: task.number,
      action: "created",
      githubIssueNumber: syncState.githubIssueNumber ?? undefined,
      githubUrl: syncState.githubUrl ?? undefined,
    };
  }

  /**
   * Link an existing GitHub issue to a task
   *
   * @param externalIssue - The existing external issue data
   * @param task - The task to link
   * @param config - GitHub sync config
   * @returns The GitHub sync state for the task
   */
  private async linkExistingGitHubIssue(
    externalIssue: { id: string; numericId?: number; url: string; nodeId?: string },
    task: Task,
    config: GitHubIssueSyncConfig
  ): Promise<GitHubSyncState> {
    // Add to project if configured
    let projectItemId: string | null = null;
    if (config.projectId && externalIssue.nodeId) {
      try {
        const result = await this.provider.addToProject(externalIssue.nodeId, config.projectId);

        // Move to correct column based on task status
        if (result.success && result.itemId) {
          projectItemId = result.itemId;
          const columnName = this.getColumnNameForStatus(config, task.status);
          await this.provider.moveToColumn(projectItemId, config.projectId, columnName);
        }
      } catch (error) {
        // Log but don't fail - project linking is not critical
        console.warn(
          `Failed to add issue to project: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      githubIssueNumber: externalIssue.numericId ?? parseInt(externalIssue.id, 10),
      githubUrl: externalIssue.url,
      githubNodeId: externalIssue.nodeId ?? null,
      syncStatus: "SYNCED",
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: null,
      projectItemId,
    };
  }

  /**
   * Ensure a task's GitHub issue is in the correct project state
   *
   * @param task - The task with existing GitHub sync
   * @param config - GitHub sync config
   */
  private async ensureProjectState(task: Task, config: GitHubIssueSyncConfig): Promise<void> {
    if (!config.projectId || !task.githubSync) {
      return;
    }

    // If no project item ID, try to add to project
    if (!task.githubSync.projectItemId && task.githubSync.githubNodeId) {
      try {
        const result = await this.provider.addToProject(
          task.githubSync.githubNodeId,
          config.projectId
        );

        if (result.success && result.itemId) {
          // Update task with project item ID
          this.taskRepository.updateGitHubSync(task.id, {
            ...task.githubSync,
            projectItemId: result.itemId,
            lastSyncedAt: new Date().toISOString(),
          });

          // Move to correct column
          const columnName = this.getColumnNameForStatus(config, task.status);
          await this.provider.moveToColumn(result.itemId, config.projectId, columnName);
        }
      } catch (error) {
        console.warn(
          `Failed to add to project: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else if (task.githubSync.projectItemId) {
      // Already has project item - ensure correct column
      const columnName = this.getColumnNameForStatus(config, task.status);
      await this.provider.moveToColumn(task.githubSync.projectItemId, config.projectId, columnName);
    }
  }

  /**
   * Build the GitHub issue body for a task
   *
   * If a template service is configured, attempts to use task template
   * based on task type. Templates support placeholders:
   * - {{description}} - Task description
   * - {{acceptanceCriteria}} - Formatted acceptance criteria list
   * - {{parentIssueLink}} - Dev-workflow issue reference
   *
   * Falls back to hardcoded format if no template is found.
   *
   * Dev-workflow reference is added as an unobtrusive footer note.
   */
  private async buildTaskBody(issue: Issue, task: Task): Promise<string> {
    // Try to use task template if template service is available
    if (this.templateService) {
      try {
        const template = await this.templateService.getTaskTemplate(task.type);
        if (template) {
          const body = this.applyTaskPlaceholders(template.content, issue, task);
          return this.appendFooter(body, issue, task);
        }
      } catch {
        // Log but don't fail - fall back to default behavior
        console.warn(
          `Failed to load task template for type ${task.type}, falling back to default format`
        );
      }
    }

    // Fall back to hardcoded format
    return this.buildDefaultTaskBody(issue, task);
  }

  /**
   * Apply placeholders to task template content
   *
   * Replaces:
   * - {{description}} with task description
   * - {{acceptanceCriteria}} with formatted bullet list
   * - {{parentIssueLink}} with dev-workflow issue reference
   */
  private applyTaskPlaceholders(content: string, issue: Issue, task: Task): string {
    let result = content;

    // Replace {{description}}
    result = result.replace(/\{\{description\}\}/g, task.description);

    // Replace {{acceptanceCriteria}}
    const criteriaList =
      task.acceptanceCriteria.length > 0
        ? task.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n")
        : "_No acceptance criteria defined._";
    result = result.replace(/\{\{acceptanceCriteria\}\}/g, criteriaList);

    // Replace {{parentIssueLink}}
    const parentLink = `dev-workflow issue #${issue.number}: ${issue.title}`;
    result = result.replace(/\{\{parentIssueLink\}\}/g, parentLink);

    return result;
  }

  /**
   * Append dev-workflow footer to body
   */
  private appendFooter(body: string, issue: Issue, task: Task): string {
    return `${body}\n\n---\nTask ${issue.number}.${task.number}: ${task.title}`;
  }

  /**
   * Build default task body (fallback when no template)
   */
  private buildDefaultTaskBody(issue: Issue, task: Task): string {
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
   * Build labels array from task type
   *
   * Uses TypeService to look up the remote label for the task type.
   * Falls back to lowercase type name if no explicit remoteLabel is configured.
   *
   * @param config - GitHub sync config (for custom labels)
   * @param taskType - The task's type (e.g., "FEATURE", "BUG")
   * @returns Array of labels to apply to the GitHub issue
   */
  private async buildLabels(config: GitHubIssueSyncConfig, taskType: string): Promise<string[]> {
    const labels: string[] = [];

    // Look up the remote label for this task type via TypeService
    let typeLabel: string | undefined;

    if (this.typeService) {
      try {
        const typeDef = await this.typeService.getTypeByName(taskType);
        if (typeDef) {
          typeLabel = typeDef.remoteLabel;
        }
      } catch {
        // Log but don't fail - fall back to lowercase
        console.warn(`Failed to look up type ${taskType}, falling back to lowercase`);
      }
    }

    // Fallback to lowercase type name if no TypeService or no explicit label
    if (!typeLabel) {
      typeLabel = taskType.toLowerCase();
    }

    labels.push(typeLabel);

    // Add custom labels from config
    if (config.labels?.customLabels) {
      labels.push(...config.labels.customLabels);
    }

    // Add a "task" label to distinguish task issues from regular issues
    labels.push("task");

    return labels;
  }

  /**
   * Get the column name for a task status using configured mapping
   *
   * @param config - GitHub sync config with optional column mapping
   * @param status - The task status to map
   * @returns The column name for the status
   */
  private getColumnNameForStatus(config: GitHubIssueSyncConfig, status: TaskStatus): string {
    const configuredMapping = config.columnMapping ?? {};
    const columnMapping: Record<TaskStatus, string> = {
      ...DEFAULT_COLUMN_MAPPING,
      ...configuredMapping,
    };
    return columnMapping[status];
  }
}
