import type { Task } from "./task.js";
import type { DbClient } from "../../data-access/db-client.js";
import { EventBus } from "../../events/event-bus.js";
import { PlanDomainService } from "../plans/plan-domain-service.js";
import { DependencyNotSatisfiedError } from "../errors.js";
import type { GitWorktreeService } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import { generateWorktreeNames } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import type {
  ConflictDetectionService,
  ConflictWarning,
} from "../../conflict-detection-service.js";
import { Effect, Service } from "@dev-workflow/effect";

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
export class TaskSessionService extends Service<TaskSessionService>()("taskSessionService") {
  private readonly eventBus: EventBus;
  private readonly planDomainService: PlanDomainService;

  constructor(
    private readonly db: DbClient,
    private readonly gitWorktreeService?: GitWorktreeService,
    private readonly conflictDetectionService?: ConflictDetectionService,
    private readonly trackDirectory?: string
  ) {
    super();
    this.eventBus = EventBus.getInstance();
    this.planDomainService = new PlanDomainService(db.plans, db.tasks, db.issues);
  }

  /**
   * Get the issue number for a task by looking up its plan and issue
   */
  private getIssueNumberForTask(taskId: string): Effect<number> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.db.tasks.findById(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const plan = yield* self.db.plans.findById(task.planId);
      if (!plan) {
        throw new Error(`Plan not found for task: ${taskId}`);
      }

      const issue = yield* self.db.issues.findById(plan.issueId);
      if (!issue) {
        throw new Error(`Issue not found for task: ${taskId}`);
      }

      return issue.number;
    });
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
  startTaskSession(request: StartTaskSessionRequest): Effect<TaskSession> {
    const self = this;
    return Effect.gen(function* () {
      const { taskId, sessionId, mode = "isolated" } = request;

      // Get task and validate
      const task = yield* self.db.tasks.findById(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      // Terminal states - reject (caller should handle these gracefully)
      if (task.isTerminal) {
        throw new Error(
          `Cannot start session for task in terminal state: ${task.status}. ` +
            "Task is already done."
        );
      }

      // Determine if this is a fresh start or resume
      // Resume if: startedAt is set, OR task is already active (IN_PROGRESS/PR_REVIEW)
      // (handles inconsistent states where task was created directly without proper flow)
      const isResume = (task.startedAt !== undefined && task.startedAt !== null) || task.isActive;

      const now = new Date().toISOString();
      const issueNumber = yield* self.getIssueNumberForTask(taskId);

      // For fresh starts only: validate dependencies and run conflict detection
      let conflictWarnings: ConflictWarning[] | undefined;
      if (!isResume) {
        // Check if dependencies are satisfied
        const depsSatisfied = yield* self.planDomainService.areDependenciesSatisfied(task);
        if (!depsSatisfied) {
          const blockingTasks = yield* self.planDomainService.getBlockingDependencies(task);
          const blockingDetails: {
            id: string;
            number: number;
            title: string;
            status: string;
            issueNumber: number | null;
          }[] = [];
          for (const t of blockingTasks) {
            const blockingPlan = yield* self.db.plans.findById(t.planId);
            const blockingIssue = blockingPlan
              ? yield* self.db.issues.findById(blockingPlan.issueId)
              : null;
            blockingDetails.push({
              id: t.id,
              number: t.number,
              title: t.title,
              status: t.status,
              issueNumber: blockingIssue?.number ?? null,
            });
          }
          throw new DependencyNotSatisfiedError(taskId, task.title, blockingDetails);
        }

        // Run conflict detection if service available (non-blocking)
        if (self.conflictDetectionService) {
          try {
            const result = yield* self.conflictDetectionService.detectConflicts(taskId);
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
        if (!self.gitWorktreeService) {
          throw new Error(
            "GitWorktreeService is required for 'isolated' mode. " +
              "Use 'branch' or 'main' mode if git worktrees are not available."
          );
        }

        const names = generateWorktreeNames(
          issueNumber,
          task.number,
          task.title,
          self.trackDirectory
        );
        branchName = names.branchName;
        worktreePath = yield* Effect.catchAll(
          self.gitWorktreeService.createWorktree(names.worktreePath, branchName!),
          (err) => Effect.promise(() => Promise.reject<string>(err))
        );

        // Update task with worktree info
        yield* self.db.tasks.updateWorktreeInfo(taskId, worktreePath, branchName);
      } else if (mode === "branch" && !branchName) {
        // Branch mode: create branch only, checkout in main repo (only if not already created)
        if (!self.gitWorktreeService) {
          throw new Error(
            "GitWorktreeService is required for 'branch' mode. " +
              "Use 'main' mode if git operations are not available."
          );
        }

        const names = generateWorktreeNames(
          issueNumber,
          task.number,
          task.title,
          self.trackDirectory
        );
        branchName = names.branchName;

        // Create and checkout the branch (no worktree)
        yield* self.gitWorktreeService.run(["checkout", "-b", branchName!]);

        // Update task with branch info only (no worktree path)
        yield* self.db.tasks.update(taskId, { branchName });
      }
      // mode === "main": no branch, no worktree - work directly on main

      // Only for fresh starts: transition status and activate plan
      if (!isResume) {
        // Transition all BACKLOG tasks in this plan to READY
        // This happens when any task in the plan is first started
        const allPlanTasks = yield* self.db.tasks.findByPlanId(task.planId);
        for (const planTask of allPlanTasks) {
          if (planTask.status === "BACKLOG" && planTask.id !== taskId) {
            yield* self.db.tasks.updateStatus(
              planTask.id,
              "READY",
              sessionId,
              "Plan activated - task moved from BACKLOG to READY"
            );
          }
        }

        // Update task status to IN_PROGRESS
        yield* self.db.tasks.updateStatus(taskId, "IN_PROGRESS", sessionId, "Started session");
      }

      // Always update session tracking (idempotent)
      yield* self.db.tasks.updateSessionInfo(
        taskId,
        sessionId,
        isResume ? undefined : now, // Only set sessionStartedAt on fresh start
        now // Always update lastSessionActivityAt
      );

      // Get final task state
      const finalTask = yield* self.db.tasks.findById(taskId);
      if (!finalTask) {
        throw new Error(`Failed to retrieve updated task: ${taskId}`);
      }

      // Emit appropriate event for real-time UI updates
      if (isResume) {
        self.eventBus.emit("task:session_resumed", {
          taskId,
          sessionId,
          issueNumber,
        });
      } else {
        self.eventBus.emit("task:session_started", {
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
    });
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
  completeTaskSession(request: CompleteTaskSessionRequest): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const { taskId, sessionId, notes } = request;

      // Get task and validate
      const task = yield* self.db.tasks.findById(taskId);
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
      if (task.worktreePath && self.gitWorktreeService) {
        // Remove worktree but keep the branch (it has the commits)
        // Log but don't fail completion if worktree cleanup fails
        yield* Effect.catchAll(
          self.gitWorktreeService.removeWorktree(task.worktreePath, false),
          () => {
            console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
            return Effect.succeed(undefined as void);
          }
        );
        // Clear worktree info from task
        yield* self.db.tasks.clearWorktreeInfo(taskId);
      }

      // Update task status to COMPLETED
      yield* self.db.tasks.updateStatus(
        taskId,
        "COMPLETED",
        sessionId,
        notes ?? "Completed session"
      );

      // Clear session association
      yield* self.db.tasks.clearSession(taskId);

      // Get final task state
      const finalTask = yield* self.db.tasks.findById(taskId);
      if (!finalTask) {
        throw new Error(`Failed to retrieve completed task: ${taskId}`);
      }

      // Emit session completed event for real-time UI updates
      const issueNumber = yield* self.getIssueNumberForTask(taskId);
      self.eventBus.emit("task:session_completed", {
        taskId,
        sessionId,
        issueNumber,
      });

      return finalTask;
    });
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
  abandonTask(
    taskId: string,
    sessionId: string,
    reason?: string,
    force: boolean = false
  ): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      // Get task and validate
      const task = yield* self.db.tasks.findById(taskId);
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
      if (task.worktreePath && self.gitWorktreeService) {
        // Remove worktree and delete the branch (abandoned work)
        // Log but don't fail abandonment if worktree cleanup fails
        yield* Effect.catchAll(
          self.gitWorktreeService.removeWorktree(task.worktreePath, true),
          () => {
            console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
            return Effect.succeed(undefined as void);
          }
        );
        // Clear worktree info from task
        yield* self.db.tasks.clearWorktreeInfo(taskId);
      }

      // Update task status to ABANDONED
      yield* self.db.tasks.updateStatus(
        taskId,
        "ABANDONED",
        sessionId,
        reason ?? "Abandoned session"
      );

      // Clear session association
      yield* self.db.tasks.clearSession(taskId);

      // Get final task state
      const finalTask = yield* self.db.tasks.findById(taskId);
      if (!finalTask) {
        throw new Error(`Failed to retrieve abandoned task: ${taskId}`);
      }

      // Emit session abandoned event for real-time UI updates
      const issueNumber = yield* self.getIssueNumberForTask(taskId);
      self.eventBus.emit("task:session_abandoned", {
        taskId,
        sessionId,
        issueNumber,
      });

      return finalTask;
    });
  }

  /**
   * Update session activity timestamp (heartbeat)
   *
   * Used to prevent session timeouts for active sessions.
   */
  updateSessionActivity(taskId: string, sessionId: string): Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.db.tasks.findById(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      if (task.sessionId !== sessionId) {
        throw new Error(
          `Task is not associated with session ${sessionId}. Current session: ${task.sessionId}`
        );
      }

      const now = new Date().toISOString();
      yield* self.db.tasks.updateSessionInfo(
        taskId,
        sessionId,
        undefined, // Don't update sessionStartedAt
        now // Update lastSessionActivityAt
      );
    });
  }

  /**
   * Check if task is available for work
   *
   * A task is available if:
   * - Status is BACKLOG or READY (not started yet)
   * - Dependencies are satisfied
   * - Parent issue is not CLOSED
   */
  isTaskAvailable(taskId: string): Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.db.tasks.findById(taskId);
      if (!task) {
        return false;
      }

      return yield* self.checkTaskAvailability(task);
    });
  }

  /**
   * Get active session for task (if any)
   */
  getActiveSession(taskId: string): Effect<TaskSession | null> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.db.tasks.findById(taskId);
      if (!task || !task.sessionId || !task.sessionStartedAt) {
        return null;
      }

      return {
        task,
        sessionId: task.sessionId,
        startedAt: task.sessionStartedAt,
        resumed: true, // If there's an active session, it's by definition a resumed state
      };
    });
  }

  /**
   * Check if task is available for work
   *
   * A task is available if:
   * - Parent issue is not CLOSED
   * - Status is BACKLOG or READY and dependencies are satisfied
   *
   * Note: IN_PROGRESS/PR_REVIEW tasks are not "available" for fresh starts,
   * but can be resumed via load_task_session. COMPLETED/ABANDONED are terminal.
   */
  private checkTaskAvailability(task: Task): Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      // Check if parent issue is closed - use trait function
      const plan = yield* self.db.plans.findById(task.planId);
      if (plan) {
        const issue = yield* self.db.issues.findById(plan.issueId);
        if (issue && issue.isClosed) {
          return false;
        }
      }

      // Only BACKLOG and READY tasks are available for fresh starts
      if (task.status === "BACKLOG" || task.status === "READY") {
        return yield* self.planDomainService.areDependenciesSatisfied(task);
      }

      return false;
    });
  }
}
