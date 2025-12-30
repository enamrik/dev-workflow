import type { Task, TaskRepository } from "../domain/task.js";
import type { HookResult } from "../domain/hook-config.js";
import type { HookConfigService } from "./hook-config-service.js";
import type { HookExecutor } from "./hook-executor.js";

/**
 * Request to start a task session
 */
export interface StartTaskSessionRequest {
  taskId: string;
  sessionId: string;
  skipHooks?: boolean;
}

/**
 * Request to complete a task session
 */
export interface CompleteTaskSessionRequest {
  taskId: string;
  sessionId: string;
  notes?: string;
  skipHooks?: boolean;
}

/**
 * Active task session information
 */
export interface TaskSession {
  task: Task;
  sessionId: string;
  startedAt: string;
  hookResults: HookResult[];
}

/**
 * TaskSessionService coordinates task session lifecycle management
 *
 * Responsibilities:
 * - Start task sessions with pre/post-start hooks
 * - Complete task sessions with pre/post-complete hooks
 * - Abandon task sessions with on-abandon hooks
 * - Prevent concurrent sessions on same task
 * - Track session activity for timeout detection
 * - Record hook execution results in history
 *
 * Uses:
 * - HookConfigService to load and merge hook configurations
 * - HookExecutor to run shell commands
 * - TaskRepository to persist task state changes
 */
export class TaskSessionService {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly hookConfigService: HookConfigService,
    private readonly hookExecutor: HookExecutor,
    private readonly trackDirectory: string
  ) {}

  /**
   * Start a new session for a task
   *
   * Workflow:
   * 1. Validate task is available (not locked by another session)
   * 2. Load and merge hook configs from task's hookConfigLabels
   * 3. Execute pre-start hooks
   * 4. Update task status to IN_PROGRESS with session info
   * 5. Execute post-start hooks
   * 6. Record hook results in status history
   */
  async startTaskSession(
    request: StartTaskSessionRequest
  ): Promise<TaskSession> {
    const { taskId, sessionId, skipHooks } = request;

    // Get task and validate
    const task = this.taskRepository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Check if task is available
    if (!this.isTaskAvailableSync(task)) {
      throw new Error(
        `Task is already in progress by session: ${task.sessionId}`
      );
    }

    // Only PENDING tasks can be started
    if (task.status !== "PENDING") {
      throw new Error(
        `Task must be PENDING to start session. Current status: ${task.status}`
      );
    }

    const allHookResults: HookResult[] = [];
    const now = new Date().toISOString();

    // Load and merge hook configs (only if not skipping hooks)
    const hookConfig = skipHooks
      ? null
      : await this.hookConfigService.loadAndMergeConfigs(
          task.hookConfigLabels ?? []
        );

    // Execute pre-start hooks
    if (!skipHooks && hookConfig?.hooks.preStart) {
      const preStartResults = await this.hookExecutor.executeHooks(
        hookConfig.hooks.preStart,
        {
          taskId: task.id,
          taskTitle: task.title,
          workingDirectory: this.trackDirectory,
          environment: hookConfig?.environment,
          timeout: hookConfig?.timeout,
        }
      );

      // Add stage information to results
      preStartResults.forEach((r) => (r.hookStage = "pre-start"));
      allHookResults.push(...preStartResults);

      // Check if any pre-start hook failed
      const failed = preStartResults.find((r) => r.exitCode !== 0);
      if (failed) {
        throw new Error(
          `Pre-start hook failed: ${failed.command}\n\nOutput:\n${failed.output}`
        );
      }
    }

    // Update task status to IN_PROGRESS and set session info
    this.taskRepository.updateStatus(
      taskId,
      "IN_PROGRESS",
      sessionId,
      "Started session"
    );

    // Update session tracking
    this.taskRepository.updateSessionInfo(
      taskId,
      sessionId,
      now, // sessionStartedAt
      now // lastSessionActivityAt
    );

    // Execute post-start hooks
    if (!skipHooks && hookConfig?.hooks.postStart) {
      const postStartResults = await this.hookExecutor.executeHooks(
        hookConfig.hooks.postStart,
        {
          taskId: task.id,
          taskTitle: task.title,
          workingDirectory: this.trackDirectory,
          environment: hookConfig?.environment,
          timeout: hookConfig?.timeout,
        }
      );

      // Add stage information to results
      postStartResults.forEach((r) => (r.hookStage = "post-start"));
      allHookResults.push(...postStartResults);

      // Post-start hook failures are non-fatal (just log)
    }

    // Get final task state
    const finalTask = this.taskRepository.findById(taskId);
    if (!finalTask) {
      throw new Error(`Failed to retrieve updated task: ${taskId}`);
    }

    return {
      task: finalTask,
      sessionId,
      startedAt: now,
      hookResults: allHookResults,
    };
  }

  /**
   * Complete the current session
   *
   * Workflow:
   * 1. Validate session ownership
   * 2. Load and merge hook configs
   * 3. Execute pre-complete hooks (MUST PASS)
   * 4. Update task status to COMPLETED
   * 5. Execute post-complete hooks
   * 6. Clear session association
   * 7. Record hook results in history
   */
  async completeTaskSession(
    request: CompleteTaskSessionRequest
  ): Promise<Task> {
    const { taskId, sessionId, notes, skipHooks } = request;

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
      throw new Error(
        `Task must be IN_PROGRESS to complete. Current status: ${task.status}`
      );
    }

    const allHookResults: HookResult[] = [];

    // Load and merge hook configs (only if not skipping hooks)
    const hookConfig = skipHooks
      ? null
      : await this.hookConfigService.loadAndMergeConfigs(
          task.hookConfigLabels ?? []
        );

    // Execute pre-complete hooks (MUST PASS!)
    if (!skipHooks && hookConfig?.hooks.preComplete) {
      const preCompleteResults = await this.hookExecutor.executeHooks(
        hookConfig.hooks.preComplete,
        {
          taskId: task.id,
          taskTitle: task.title,
          workingDirectory: this.trackDirectory,
          environment: hookConfig?.environment,
          timeout: hookConfig?.timeout,
        }
      );

      // Add stage information to results
      preCompleteResults.forEach((r) => (r.hookStage = "pre-complete"));
      allHookResults.push(...preCompleteResults);

      // Check if any pre-complete hook failed
      const failed = preCompleteResults.find((r) => r.exitCode !== 0);
      if (failed) {
        throw new Error(
          `Pre-complete hook failed. Task cannot be completed.\n\nCommand: ${failed.command}\n\nOutput:\n${failed.output}`
        );
      }
    }

    // Update task status to COMPLETED
    this.taskRepository.updateStatus(
      taskId,
      "COMPLETED",
      sessionId,
      notes ?? "Completed session"
    );

    // Execute post-complete hooks
    if (!skipHooks && hookConfig?.hooks.postComplete) {
      const postCompleteResults = await this.hookExecutor.executeHooks(
        hookConfig.hooks.postComplete,
        {
          taskId: task.id,
          taskTitle: task.title,
          workingDirectory: this.trackDirectory,
          environment: hookConfig?.environment,
          timeout: hookConfig?.timeout,
        }
      );

      // Add stage information to results
      postCompleteResults.forEach((r) => (r.hookStage = "post-complete"));
      allHookResults.push(...postCompleteResults);

      // Post-complete hook failures are non-fatal (just log)
    }

    // Clear session association
    this.taskRepository.clearSession(taskId);

    // Get final task state
    const finalTask = this.taskRepository.findById(taskId);
    if (!finalTask) {
      throw new Error(`Failed to retrieve completed task: ${taskId}`);
    }

    return finalTask;
  }

  /**
   * Abandon the current session
   *
   * Workflow:
   * 1. Validate session ownership
   * 2. Load and merge hook configs
   * 3. Execute on-abandon hooks
   * 4. Update task status to ABANDONED
   * 5. Clear session association
   * 6. Record hook results in history
   */
  async abandonTaskSession(
    taskId: string,
    sessionId: string,
    reason?: string
  ): Promise<Task> {
    // Get task and validate
    const task = this.taskRepository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Validate session ownership (allow abandoning if no session or matching session)
    if (task.sessionId && task.sessionId !== sessionId) {
      throw new Error(
        `Task is not associated with session ${sessionId}. Current session: ${task.sessionId}`
      );
    }

    const allHookResults: HookResult[] = [];

    // Load and merge hook configs
    const hookConfig = await this.hookConfigService.loadAndMergeConfigs(
      task.hookConfigLabels ?? []
    );

    // Execute on-abandon hooks
    if (hookConfig.hooks.onAbandon) {
      const abandonResults = await this.hookExecutor.executeHooks(
        hookConfig.hooks.onAbandon,
        {
          taskId: task.id,
          taskTitle: task.title,
          workingDirectory: this.trackDirectory,
          environment: hookConfig.environment,
          timeout: hookConfig.timeout,
        }
      );

      // Add stage information to results
      abandonResults.forEach((r) => (r.hookStage = "on-abandon"));
      allHookResults.push(...abandonResults);

      // On-abandon hook failures are non-fatal (just log)
    }

    // Update task status to ABANDONED
    this.taskRepository.updateStatus(
      taskId,
      "ABANDONED",
      sessionId,
      reason ?? "Abandoned session"
    );

    // Clear session association
    this.taskRepository.clearSession(taskId);

    // Get final task state
    const finalTask = this.taskRepository.findById(taskId);
    if (!finalTask) {
      throw new Error(`Failed to retrieve abandoned task: ${taskId}`);
    }

    return finalTask;
  }

  /**
   * Update session activity timestamp (heartbeat)
   *
   * Used to prevent session timeouts for active sessions.
   */
  async updateSessionActivity(
    taskId: string,
    sessionId: string
  ): Promise<void> {
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
   * - Status is PENDING (not started yet)
   * - OR status is IN_PROGRESS but session has timed out (>1 hour inactive)
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
      hookResults: [], // Historical hook results not retrieved here
    };
  }

  /**
   * Check if task is available (synchronous version)
   */
  private isTaskAvailableSync(task: Task): boolean {
    // PENDING tasks are always available
    if (task.status === "PENDING") {
      return true;
    }

    // IN_PROGRESS tasks are available if session has timed out
    if (task.status === "IN_PROGRESS" && task.lastSessionActivityAt) {
      const lastActivity = new Date(task.lastSessionActivityAt);
      const now = new Date();
      const hoursSinceActivity =
        (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60);

      // Consider session dead after 1 hour of inactivity
      if (hoursSinceActivity > 1) {
        return true;
      }
    }

    // COMPLETED and ABANDONED tasks are not available
    return false;
  }
}
