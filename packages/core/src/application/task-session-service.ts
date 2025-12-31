import type { Task, TaskRepository } from "../domain/task.js";
import type { PlanRepository } from "../domain/plan.js";
import type { IssueRepository } from "../domain/issue.js";
import { EventBus } from "../infrastructure/events/event-bus.js";
import { DependencyService } from "./dependency-service.js";
import { DependencyNotSatisfiedError } from "../domain/errors.js";

/**
 * Request to start a task session
 */
export interface StartTaskSessionRequest {
  taskId: string;
  sessionId: string;
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
 */
export class TaskSessionService {
  private readonly eventBus: EventBus;
  private readonly dependencyService: DependencyService;

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly planRepository: PlanRepository,
    private readonly issueRepository: IssueRepository
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
   * Start a new session for a task
   *
   * Workflow:
   * 1. Validate task is available (not locked by another session)
   * 2. Update task status to IN_PROGRESS with session info
   */
  async startTaskSession(
    request: StartTaskSessionRequest
  ): Promise<TaskSession> {
    const { taskId, sessionId } = request;

    // Get task and validate
    const task = this.taskRepository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Only PENDING tasks can be started
    if (task.status !== "PENDING") {
      throw new Error(
        `Task must be PENDING to start session. Current status: ${task.status}`
      );
    }

    // Check if dependencies are satisfied
    if (!this.dependencyService.areDependenciesSatisfied(task)) {
      const blockingTasks = this.dependencyService.getBlockingDependencies(
        task
      );
      throw new DependencyNotSatisfiedError(
        taskId,
        task.title,
        blockingTasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
        }))
      );
    }

    // Check if task is available (not locked by another session)
    if (!this.isTaskAvailableSync(task)) {
      throw new Error(
        `Task is already in progress by session: ${task.sessionId}`
      );
    }

    const now = new Date().toISOString();

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

    // Get final task state
    const finalTask = this.taskRepository.findById(taskId);
    if (!finalTask) {
      throw new Error(`Failed to retrieve updated task: ${taskId}`);
    }

    // Emit session started event for real-time UI updates
    const issueNumber = this.getIssueNumberForTask(taskId);
    this.eventBus.emit("task:session_started", {
      taskId,
      sessionId,
      issueNumber,
    });

    return {
      task: finalTask,
      sessionId,
      startedAt: now,
    };
  }

  /**
   * Complete the current session
   *
   * Workflow:
   * 1. Validate session ownership
   * 2. Update task status to COMPLETED
   * 3. Clear session association
   */
  async completeTaskSession(
    request: CompleteTaskSessionRequest
  ): Promise<Task> {
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
      throw new Error(
        `Task must be IN_PROGRESS to complete. Current status: ${task.status}`
      );
    }

    // Update task status to COMPLETED
    this.taskRepository.updateStatus(
      taskId,
      "COMPLETED",
      sessionId,
      notes ?? "Completed session"
    );

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
   * 1. Validate session ownership
   * 2. Update task status to ABANDONED
   * 3. Clear session association
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
    };
  }

  /**
   * Check if task is available (synchronous version)
   *
   * A task is available if:
   * - Status is PENDING and dependencies are satisfied
   * - OR status is IN_PROGRESS but session has timed out (>1 hour inactive)
   */
  private isTaskAvailableSync(task: Task): boolean {
    // PENDING tasks are available if dependencies are satisfied
    if (task.status === "PENDING") {
      return this.dependencyService.areDependenciesSatisfied(task);
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
