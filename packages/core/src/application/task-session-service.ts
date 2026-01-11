import type { Task, TaskRepository } from "../domain/task.js";
import type { PlanRepository } from "../domain/plan.js";
import type { IssueRepository } from "../domain/issue.js";
import { EventBus } from "../infrastructure/events/event-bus.js";
import { DependencyService } from "./dependency-service.js";
import { DependencyNotSatisfiedError } from "../domain/errors.js";
import type { GitWorktreeService } from "../infrastructure/git/git-worktree-service.js";
import { generateWorktreeNames } from "../infrastructure/git/git-worktree-service.js";
import type { ConflictDetectionService, ConflictWarning } from "./conflict-detection-service.js";

/**
 * Execution mode for task sessions
 *
 * - 'isolated': Creates worktree + branch for parallel work (default)
 * - 'branch': Creates branch only, checks out in main repo
 * - 'main': Works directly on main, skips PR review
 */
export type TaskExecutionMode = "isolated" | "branch" | "main";

/**
 * Request to start a task session
 */
export interface StartTaskSessionRequest {
  taskId: string;
  sessionId: string;
  /**
   * Execution mode for the task.
   * - 'isolated' (default): Creates worktree + branch for parallel work
   * - 'branch': Creates branch only, checks out in main repo
   * - 'main': Works directly on main, skips PR review
   */
  mode?: TaskExecutionMode;
}

/**
 * Request to complete a task session
 */
export interface CompleteTaskSessionRequest {
  taskId: string;
  sessionId: string;
  notes?: string;
}

/**
 * Active task session information
 */
export interface TaskSession {
  task: Task;
  sessionId: string;
  startedAt: string;
  /** True if this was a resume of an existing session, false if fresh start */
  resumed: boolean;
  /** Path to worktree if created for isolated execution */
  worktreePath?: string;
  /** Git branch name if worktree was created */
  branchName?: string;
  /** Conflict warnings for files modified by prior tasks (non-blocking) */
  conflictWarnings?: ConflictWarning[];
}

/**
 * TaskSessionService coordinates task session lifecycle management
 *
 * Responsibilities:
 * - Start task sessions (update status to IN_PROGRESS)
 * - Complete task sessions (update status to COMPLETED)
 * - Abandon task sessions (update status to ABANDONED)
 * - Prevent concurrent sessions on same task
 * - Track session activity for timeout detection
 * - Create/cleanup worktrees for isolated task execution
 */
export class TaskSessionService {
  private readonly eventBus: EventBus;
  private readonly dependencyService: DependencyService;

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly planRepository: PlanRepository,
    private readonly issueRepository: IssueRepository,
    private readonly gitWorktreeService?: GitWorktreeService,
    private readonly conflictDetectionService?: ConflictDetectionService,
    private readonly trackDirectory?: string
  ) {
    this.eventBus = EventBus.getInstance();
    this.dependencyService = new DependencyService(taskRepository);
  }

  /**
   * Get the issue number for a task by looking up its plan and issue
   */
  private getIssueNumberForTask(taskId: string): number {
    const task = this.taskRepository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const plan = this.planRepository.findById(task.planId);
    if (!plan) {
      throw new Error(`Plan not found for task: ${taskId}`);
    }

    const issue = this.issueRepository.findById(plan.issueId);
    if (!issue) {
      throw new Error(`Issue not found for task: ${taskId}`);
    }

    return issue.number;
  }

  /**
   * Start or resume a session for a task (idempotent)
   *
   * This method is idempotent - safe to call multiple times:
   * - Only transitions status if BACKLOG/READY (skips if already IN_PROGRESS/PR_REVIEW)
   * - Only creates worktree if isolated mode AND worktree doesn't exist
   * - Always updates session tracking
   *
   * Throws for terminal states (COMPLETED/ABANDONED) - caller should handle those.
   *
   * @returns TaskSession with `resumed: true` if task was already started, `false` if fresh start
   */
  async startTaskSession(request: StartTaskSessionRequest): Promise<TaskSession> {
    const { taskId, sessionId, mode = "isolated" } = request;

    // Get task and validate
    const task = this.taskRepository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Terminal states - reject (caller should handle these gracefully)
    if (task.status === "COMPLETED" || task.status === "ABANDONED") {
      throw new Error(
        `Cannot start session for task in terminal state: ${task.status}. ` +
          "Task is already done."
      );
    }

    // Determine if this is a fresh start or resume
    // Resume if: startedAt is set, OR status is already IN_PROGRESS/PR_REVIEW
    // (handles inconsistent states where task was created directly without proper flow)
    const isResume =
      (task.startedAt !== undefined && task.startedAt !== null) ||
      task.status === "IN_PROGRESS" ||
      task.status === "PR_REVIEW";

    const now = new Date().toISOString();
    const issueNumber = this.getIssueNumberForTask(taskId);

    // For fresh starts only: validate dependencies and run conflict detection
    let conflictWarnings: ConflictWarning[] | undefined;
    if (!isResume) {
      // Check if dependencies are satisfied
      if (!this.dependencyService.areDependenciesSatisfied(task)) {
        const blockingTasks = this.dependencyService.getBlockingDependencies(task);
        throw new DependencyNotSatisfiedError(
          taskId,
          task.title,
          blockingTasks.map((t) => {
            // Resolve issue number for each blocking task
            const blockingPlan = this.planRepository.findById(t.planId);
            const blockingIssue = blockingPlan
              ? this.issueRepository.findById(blockingPlan.issueId)
              : null;
            return {
              id: t.id,
              number: t.number,
              title: t.title,
              status: t.status,
              issueNumber: blockingIssue?.number ?? null,
            };
          })
        );
      }

      // Run conflict detection if service available (non-blocking)
      if (this.conflictDetectionService) {
        try {
          const result = this.conflictDetectionService.detectConflicts(taskId);
          if (result.hasConflicts) {
            conflictWarnings = result.warnings;
          }
        } catch {
          // Conflict detection failures should not block task start
          console.warn(`Conflict detection failed for task ${taskId}`);
        }
      }
    }

    // Setup worktree/branch based on execution mode (only if doesn't exist)
    let worktreePath: string | undefined = task.worktreePath;
    let branchName: string | undefined = task.branchName;

    if (mode === "isolated" && !worktreePath) {
      // Isolated mode: create worktree + branch (only if not already created)
      if (!this.gitWorktreeService) {
        throw new Error(
          "GitWorktreeService is required for 'isolated' mode. " +
            "Use 'branch' or 'main' mode if git worktrees are not available."
        );
      }

      const names = generateWorktreeNames(
        issueNumber,
        task.number,
        task.title,
        this.trackDirectory
      );
      branchName = names.branchName;
      worktreePath = await this.gitWorktreeService.createWorktree(names.worktreePath, branchName);

      // Update task with worktree info
      this.taskRepository.updateWorktreeInfo(taskId, worktreePath, branchName);
    } else if (mode === "branch" && !branchName) {
      // Branch mode: create branch only, checkout in main repo (only if not already created)
      if (!this.gitWorktreeService) {
        throw new Error(
          "GitWorktreeService is required for 'branch' mode. " +
            "Use 'main' mode if git operations are not available."
        );
      }

      const names = generateWorktreeNames(
        issueNumber,
        task.number,
        task.title,
        this.trackDirectory
      );
      branchName = names.branchName;

      // Create and checkout the branch (no worktree)
      await this.gitWorktreeService.run(["checkout", "-b", branchName]);

      // Update task with branch info only (no worktree path)
      this.taskRepository.update(taskId, { branchName });
    }
    // mode === "main": no branch, no worktree - work directly on main

    // Only for fresh starts: transition status and activate plan
    if (!isResume) {
      // Transition all BACKLOG tasks in this plan to READY
      // This happens when any task in the plan is first started
      const allPlanTasks = this.taskRepository.findByPlanId(task.planId);
      for (const planTask of allPlanTasks) {
        if (planTask.status === "BACKLOG" && planTask.id !== taskId) {
          this.taskRepository.updateStatus(
            planTask.id,
            "READY",
            sessionId,
            "Plan activated - task moved from BACKLOG to READY"
          );
        }
      }

      // Update task status to IN_PROGRESS
      this.taskRepository.updateStatus(taskId, "IN_PROGRESS", sessionId, "Started session");
    }

    // Always update session tracking (idempotent)
    this.taskRepository.updateSessionInfo(
      taskId,
      sessionId,
      isResume ? undefined : now, // Only set sessionStartedAt on fresh start
      now // Always update lastSessionActivityAt
    );

    // Get final task state
    const finalTask = this.taskRepository.findById(taskId);
    if (!finalTask) {
      throw new Error(`Failed to retrieve updated task: ${taskId}`);
    }

    // Emit appropriate event for real-time UI updates
    if (isResume) {
      this.eventBus.emit("task:session_resumed", {
        taskId,
        sessionId,
        issueNumber,
      });
    } else {
      this.eventBus.emit("task:session_started", {
        taskId,
        sessionId,
        issueNumber,
      });
    }

    return {
      task: finalTask,
      sessionId,
      startedAt: finalTask.startedAt ?? now,
      resumed: isResume,
      worktreePath,
      branchName,
      conflictWarnings,
    };
  }

  /**
   * Complete the current session
   *
   * Workflow:
   * 1. Validate session ownership
   * 2. Update task status to COMPLETED
   * 3. Cleanup worktree if present
   * 4. Clear session association
   */
  async completeTaskSession(request: CompleteTaskSessionRequest): Promise<Task> {
    const { taskId, sessionId, notes } = request;

    // Get task and validate
    const task = this.taskRepository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Validate session ownership
    if (task.sessionId !== sessionId) {
      throw new Error(
        `Task is not associated with session ${sessionId}. Current session: ${task.sessionId}`
      );
    }

    // Only IN_PROGRESS tasks can be completed
    if (task.status !== "IN_PROGRESS") {
      throw new Error(`Task must be IN_PROGRESS to complete. Current status: ${task.status}`);
    }

    // Cleanup worktree if present
    if (task.worktreePath && this.gitWorktreeService) {
      try {
        // Remove worktree but keep the branch (it has the commits)
        await this.gitWorktreeService.removeWorktree(task.worktreePath, false);
      } catch {
        // Log but don't fail completion if worktree cleanup fails
        console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
      }
      // Clear worktree info from task
      this.taskRepository.clearWorktreeInfo(taskId);
    }

    // Update task status to COMPLETED
    this.taskRepository.updateStatus(taskId, "COMPLETED", sessionId, notes ?? "Completed session");

    // Clear session association
    this.taskRepository.clearSession(taskId);

    // Get final task state
    const finalTask = this.taskRepository.findById(taskId);
    if (!finalTask) {
      throw new Error(`Failed to retrieve completed task: ${taskId}`);
    }

    // Emit session completed event for real-time UI updates
    const issueNumber = this.getIssueNumberForTask(taskId);
    this.eventBus.emit("task:session_completed", {
      taskId,
      sessionId,
      issueNumber,
    });

    return finalTask;
  }

  /**
   * Abandon the current session
   *
   * Workflow:
   * 1. Validate session ownership (skipped if force=true)
   * 2. Update task status to ABANDONED
   * 3. Cleanup worktree if present (and delete the branch)
   * 4. Clear session association
   *
   * @param force - Bypass session ownership validation when state has drifted
   */
  async abandonTaskSession(
    taskId: string,
    sessionId: string,
    reason?: string,
    force: boolean = false
  ): Promise<Task> {
    // Get task and validate
    const task = this.taskRepository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Validate session ownership (allow abandoning if no session, matching session, or force=true)
    if (task.sessionId && task.sessionId !== sessionId && !force) {
      throw new Error(
        `Task is not associated with session ${sessionId}. Current session: ${task.sessionId}. ` +
          "Use force=true to bypass this check if the session has drifted."
      );
    }

    // Cleanup worktree if present (delete branch too since task is abandoned)
    if (task.worktreePath && this.gitWorktreeService) {
      try {
        // Remove worktree and delete the branch (abandoned work)
        await this.gitWorktreeService.removeWorktree(task.worktreePath, true);
      } catch {
        // Log but don't fail abandonment if worktree cleanup fails
        console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
      }
      // Clear worktree info from task
      this.taskRepository.clearWorktreeInfo(taskId);
    }

    // Update task status to ABANDONED
    this.taskRepository.updateStatus(taskId, "ABANDONED", sessionId, reason ?? "Abandoned session");

    // Clear session association
    this.taskRepository.clearSession(taskId);

    // Get final task state
    const finalTask = this.taskRepository.findById(taskId);
    if (!finalTask) {
      throw new Error(`Failed to retrieve abandoned task: ${taskId}`);
    }

    // Emit session abandoned event for real-time UI updates
    const issueNumber = this.getIssueNumberForTask(taskId);
    this.eventBus.emit("task:session_abandoned", {
      taskId,
      sessionId,
      issueNumber,
    });

    return finalTask;
  }

  /**
   * Update session activity timestamp (heartbeat)
   *
   * Used to prevent session timeouts for active sessions.
   */
  async updateSessionActivity(taskId: string, sessionId: string): Promise<void> {
    const task = this.taskRepository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.sessionId !== sessionId) {
      throw new Error(
        `Task is not associated with session ${sessionId}. Current session: ${task.sessionId}`
      );
    }

    const now = new Date().toISOString();
    this.taskRepository.updateSessionInfo(
      taskId,
      sessionId,
      undefined, // Don't update sessionStartedAt
      now // Update lastSessionActivityAt
    );
  }

  /**
   * Check if task is available for work
   *
   * A task is available if:
   * - Status is BACKLOG or READY (not started yet)
   * - Dependencies are satisfied
   * - Parent issue is not CLOSED
   */
  async isTaskAvailable(taskId: string): Promise<boolean> {
    const task = this.taskRepository.findById(taskId);
    if (!task) {
      return false;
    }

    return this.isTaskAvailableSync(task);
  }

  /**
   * Get active session for task (if any)
   */
  async getActiveSession(taskId: string): Promise<TaskSession | null> {
    const task = this.taskRepository.findById(taskId);
    if (!task || !task.sessionId || !task.sessionStartedAt) {
      return null;
    }

    return {
      task,
      sessionId: task.sessionId,
      startedAt: task.sessionStartedAt,
      resumed: true, // If there's an active session, it's by definition a resumed state
    };
  }

  /**
   * Check if task is available (synchronous version)
   *
   * A task is available if:
   * - Parent issue is not CLOSED
   * - Status is BACKLOG or READY and dependencies are satisfied
   *
   * Note: IN_PROGRESS/PR_REVIEW tasks are not "available" for fresh starts,
   * but can be resumed via load_task_session. COMPLETED/ABANDONED are terminal.
   */
  private isTaskAvailableSync(task: Task): boolean {
    // Check if parent issue is closed
    const plan = this.planRepository.findById(task.planId);
    if (plan) {
      const issue = this.issueRepository.findById(plan.issueId);
      if (issue && issue.status === "CLOSED") {
        return false;
      }
    }

    // Only BACKLOG and READY tasks are available for fresh starts
    if (task.status === "BACKLOG" || task.status === "READY") {
      return this.dependencyService.areDependenciesSatisfied(task);
    }

    return false;
  }
}
