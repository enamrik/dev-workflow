/**
 * Claude Worker Service
 *
 * Manages a Claude Code worker that polls for tasks from the dispatch queue.
 * Workers self-register, send heartbeats, and claim tasks atomically.
 *
 * Task info is displayed in the terminal title bar, which works in any terminal
 * including inside tmux panes.
 */

import { spawn, ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  DataSourceFactory,
  SqliteWorkerRepository,
  SqliteDispatchQueueRepository,
  SqliteTaskRepository,
  SqlitePlanRepository,
  SqliteProjectRepository,
  getGlobalDatabasePath,
  resolveConfig,
  type WorkerStatus,
  type SqliteDataSource,
  issues,
  sql,
} from "@dev-workflow/core";

// ============================================================================
// ANSI Terminal Helpers
// ============================================================================

const ESC = "\x1b";
const CSI = `${ESC}[`;

const term = {
  bold: (text: string) => `${CSI}1m${text}${CSI}0m`,
  dim: (text: string) => `${CSI}2m${text}${CSI}0m`,
  cyan: (text: string) => `${CSI}36m${text}${CSI}0m`,
  yellow: (text: string) => `${CSI}33m${text}${CSI}0m`,
  green: (text: string) => `${CSI}32m${text}${CSI}0m`,
  red: (text: string) => `${CSI}31m${text}${CSI}0m`,
};

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the worker service
 */
export interface WorkerConfig {
  /** Worker name (auto-generated if not provided) */
  name?: string;
  /** Heartbeat interval in milliseconds (default: 5000ms = 5s) */
  heartbeatIntervalMs?: number;
  /** Poll interval in milliseconds (default: 2000ms = 2s) */
  pollIntervalMs?: number;
  /** Stale heartbeat threshold in seconds (default: 10s) */
  staleThresholdSeconds?: number;
}

/**
 * State of the Claude worker
 */
export interface WorkerState {
  workerId: string;
  workerName: string;
  status: WorkerStatus;
  currentTaskId: string | null;
  currentClaudeProcess: ChildProcess | null;
}

// ============================================================================
// Claude Worker Service
// ============================================================================

/**
 * Claude Worker Service
 *
 * Manages a worker process that:
 * 1. Registers itself on startup
 * 2. Sends periodic heartbeats
 * 3. Polls for tasks from the dispatch queue
 * 4. Spawns Claude to work on claimed tasks
 * 5. Handles graceful shutdown (DRAINING status)
 */
export class ClaudeWorkerService {
  private dbService: SqliteDataSource | null = null;
  private workerRepository: SqliteWorkerRepository | null = null;
  private dispatchQueueRepository: SqliteDispatchQueueRepository | null = null;
  private taskRepository: SqliteTaskRepository | null = null;
  private planRepository: SqlitePlanRepository | null = null;

  private state: WorkerState = {
    workerId: randomUUID(),
    workerName: "",
    status: "IDLE",
    currentTaskId: null,
    currentClaudeProcess: null,
  };

  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private taskWatchInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  private readonly config: Required<WorkerConfig>;

  constructor(config: WorkerConfig = {}) {
    this.config = {
      name: config.name ?? "",
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 5000,
      pollIntervalMs: config.pollIntervalMs ?? 2000,
      staleThresholdSeconds: config.staleThresholdSeconds ?? 10,
    };
  }

  // ==========================================================================
  // Terminal Title
  // ==========================================================================

  /**
   * Sets the terminal title using ANSI escape sequences.
   * Works in any terminal emulator, including inside tmux panes.
   */
  private setTerminalTitle(title: string): void {
    process.stdout.write(`\x1b]0;${title}\x07`);
  }

  /**
   * Update terminal title based on current state
   * Format: worker | #issue.task title | status
   */
  private updateTitle(): void {
    let title: string;

    if (this.state.status === "DRAINING") {
      title = `${this.state.workerName} | draining...`;
    } else if (this.state.currentTaskId) {
      const task = this.taskRepository?.findById(this.state.currentTaskId);
      const issueNumber = this.getIssueNumber(this.state.currentTaskId);

      if (issueNumber && task) {
        title = `${this.state.workerName} | #${issueNumber}.${task.number} ${task.title} | ${task.status}`;
      } else {
        title = `${this.state.workerName} | working...`;
      }
    } else {
      title = `${this.state.workerName} | polling...`;
    }

    this.setTerminalTitle(title);
  }

  // ==========================================================================
  // Database & Initialization
  // ==========================================================================

  /**
   * Initialize the worker: connect to database and set up repositories
   */
  async initialize(): Promise<void> {
    const dbPath = getGlobalDatabasePath();
    this.dbService = await DataSourceFactory.createSqlite(dbPath);
    const db = this.dbService.getDb();

    this.workerRepository = new SqliteWorkerRepository(db);
    this.dispatchQueueRepository = new SqliteDispatchQueueRepository(db);
    this.taskRepository = new SqliteTaskRepository(db);
    this.planRepository = new SqlitePlanRepository(db);
  }

  /**
   * Start the worker: register, start heartbeat, and begin polling
   */
  async start(): Promise<void> {
    if (!this.workerRepository || !this.dispatchQueueRepository) {
      throw new Error("Worker not initialized. Call initialize() first.");
    }

    // Determine worker name
    if (this.config.name) {
      this.state.workerName = this.config.name;
    } else {
      this.state.workerName = this.workerRepository.getNextWorkerName();
    }

    // Check for existing claim (resume after reconnect)
    const existingClaim = this.dispatchQueueRepository.findClaimByWorker(this.state.workerId);
    if (existingClaim) {
      console.log(`Resuming existing claim: ${existingClaim.taskId}`);
      this.state.currentTaskId = existingClaim.taskId;
      this.state.status = "WORKING";
    }

    // Register worker
    this.workerRepository.register(this.state.workerId, this.state.workerName);
    console.log(
      `Worker registered: ${this.state.workerName} (${this.state.workerId.slice(0, 8)}...)`
    );

    // Update terminal title
    this.updateTitle();

    // Setup signal handlers for graceful shutdown
    this.setupSignalHandlers();

    // Start heartbeat loop
    this.startHeartbeat();

    // Start working or polling
    if (this.state.currentTaskId) {
      await this.workOnTask(this.state.currentTaskId);
    } else {
      this.startPolling();
    }
  }

  /**
   * Stop the worker: graceful shutdown
   */
  async stop(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }
    this.isShuttingDown = true;

    console.log("\nInitiating graceful shutdown...");

    // Stop polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Set DRAINING status
    if (this.workerRepository && this.state.currentTaskId) {
      this.state.status = "DRAINING";
      this.workerRepository.updateStatus(this.state.workerId, "DRAINING");
      console.log("Status: DRAINING (finishing current task)");
      this.updateTitle();

      // Wait for current Claude process to finish
      if (this.state.currentClaudeProcess) {
        console.log("Waiting for current task to complete...");
        await new Promise<void>((resolve) => {
          this.state.currentClaudeProcess?.on("exit", () => resolve());
        });
      }
    }

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Stop task watch
    if (this.taskWatchInterval) {
      clearInterval(this.taskWatchInterval);
      this.taskWatchInterval = null;
    }

    // Unregister worker
    if (this.workerRepository) {
      this.workerRepository.unregister(this.state.workerId);
      console.log("Worker unregistered");
    }

    // Close database
    if (this.dbService) {
      this.dbService.close();
    }

    console.log("Shutdown complete");
  }

  // ==========================================================================
  // Task Resolution Helpers
  // ==========================================================================

  /**
   * Get issue number for a task by looking up the plan and issue
   */
  private getIssueNumber(taskId: string): number | null {
    if (!this.taskRepository || !this.planRepository || !this.dbService) {
      return null;
    }

    const task = this.taskRepository.findById(taskId);
    if (!task) {
      return null;
    }

    const plan = this.planRepository.findById(task.planId);
    if (!plan) {
      return null;
    }

    const db = this.dbService.getDb();
    const result = db
      .select({ number: issues.number })
      .from(issues)
      .where(sql`${issues.id} = ${plan.issueId}`)
      .get();

    return result?.number ?? null;
  }

  /**
   * Get the project git root path for a task
   */
  private async getProjectPath(taskId: string): Promise<string | null> {
    if (!this.taskRepository || !this.planRepository || !this.dbService) {
      return null;
    }

    const task = this.taskRepository.findById(taskId);
    if (!task) {
      return null;
    }

    const plan = this.planRepository.findById(task.planId);
    if (!plan) {
      return null;
    }

    const db = this.dbService.getDb();

    const issueResult = db
      .select({ projectId: issues.projectId })
      .from(issues)
      .where(sql`${issues.id} = ${plan.issueId}`)
      .get();

    if (!issueResult?.projectId) {
      return null;
    }

    const projectRepository = new SqliteProjectRepository(db);
    const project = await projectRepository.findById(issueResult.projectId);
    if (!project) {
      return null;
    }

    try {
      const config = await resolveConfig(project.slug);
      return config.gitRoot;
    } catch {
      console.error(`Failed to resolve project config for slug: ${project.slug}`);
      return null;
    }
  }

  // ==========================================================================
  // Signal Handlers & Heartbeat
  // ==========================================================================

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    process.on("SIGINT", () => {
      this.stop().then(() => process.exit(0));
    });

    process.on("SIGTERM", () => {
      this.stop().then(() => process.exit(0));
    });
  }

  /**
   * Start the heartbeat loop
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.workerRepository) {
        this.workerRepository.updateHeartbeat(this.state.workerId);
      }
    }, this.config.heartbeatIntervalMs);
  }

  // ==========================================================================
  // Task Polling & Execution
  // ==========================================================================

  /**
   * Start the polling loop to claim tasks
   */
  private startPolling(): void {
    console.log("Polling for tasks...");

    this.pollInterval = setInterval(async () => {
      if (this.isShuttingDown || this.state.status === "DRAINING") {
        return;
      }

      await this.tryClaimTask();
    }, this.config.pollIntervalMs);
  }

  /**
   * Try to claim a task from the dispatch queue
   */
  private async tryClaimTask(): Promise<void> {
    if (!this.dispatchQueueRepository) {
      return;
    }

    const claim = this.dispatchQueueRepository.claimTask(
      this.state.workerId,
      this.config.staleThresholdSeconds
    );

    if (claim) {
      console.log(`Claimed task: ${claim.taskId}`);

      // Stop polling while working
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }

      await this.workOnTask(claim.taskId);
    }
  }

  /**
   * Work on a claimed task by spawning a Claude process
   */
  private async workOnTask(taskId: string): Promise<void> {
    if (!this.workerRepository || !this.taskRepository) {
      return;
    }

    // Update state
    this.state.currentTaskId = taskId;
    this.state.status = "WORKING";
    this.workerRepository.updateStatus(this.state.workerId, "WORKING");
    this.updateTitle();

    // Get task details
    const task = this.taskRepository.findById(taskId);
    if (!task) {
      console.error(`Task not found: ${taskId}`);
      await this.releaseTask(taskId);
      return;
    }

    const issueNumber = this.getIssueNumber(taskId) ?? "?";
    const taskNumber = task.number ?? "?";

    console.log(`Working on task #${issueNumber}.${taskNumber}: ${task.title}`);

    // Get project path for cwd
    const projectPath = await this.getProjectPath(taskId);
    if (!projectPath) {
      console.error(`Could not resolve project path for task: ${taskId}`);
      await this.releaseTask(taskId);
      return;
    }

    console.log(`Project path: ${projectPath}`);

    // Build the prompt for Claude
    const prompt = this.buildClaudePrompt(taskId, issueNumber, taskNumber);

    // Spawn Claude process
    await this.spawnClaudeSession(taskId, prompt, projectPath);
  }

  /**
   * Build the prompt to pass to Claude
   */
  private buildClaudePrompt(
    taskId: string,
    issueNumber: number | string,
    taskNumber: number | string
  ): string {
    return `You are running as a worker process for dev-workflow. A task has been dispatched to you.

Start working on task #${issueNumber}.${taskNumber} (ID: ${taskId}).

Use the dwf-worker-task skill to load the task session and work through the COMPLETE task lifecycle:

1. Load the task with load_task_session
2. Implement the task according to its description and acceptance criteria
3. Create a PR when implementation is done
4. Submit for review
5. WAIT for the PR to be merged (check with get_task_pr_status)
6. Once PR is merged, call complete_task with a finalLogEntry summary
7. After task completion, check if all tasks for issue #${issueNumber} are complete
8. If all tasks are complete, ask the user if they want to close the issue

Follow the skill instructions fully, including asking the user questions when the skill indicates you should (e.g., confirming approaches, validating work, offering next steps). The user is monitoring this worker session and can respond to your prompts.

A task is only complete when it reaches COMPLETED status (PR merged and complete_task called), not when it enters PR_REVIEW.`;
  }

  /**
   * Spawn a Claude session
   */
  private async spawnClaudeSession(taskId: string, prompt: string, cwd: string): Promise<void> {
    console.log(term.dim(`\n--- Claude session starting ---\n`));

    return new Promise<void>((resolve) => {
      // Spawn Claude interactively with the prompt
      const claudeProcess = spawn("claude", [prompt], {
        cwd,
        stdio: "inherit",
        env: process.env,
      });

      this.state.currentClaudeProcess = claudeProcess;

      // Watch for task completion
      let taskCompleted = false;

      // Store task info for title updates
      const taskInfo = {
        issueNumber: this.getIssueNumber(taskId) ?? "?",
        taskNumber: this.taskRepository?.findById(taskId)?.number ?? "?",
        taskTitle: this.taskRepository?.findById(taskId)?.title ?? "Unknown",
      };

      this.taskWatchInterval = setInterval(() => {
        if (!this.taskRepository) {
          return;
        }

        const task = this.taskRepository.findById(taskId);
        if (!task) {
          console.log(term.red("\nTask no longer exists, ending session..."));
          claudeProcess.kill("SIGTERM");
          return;
        }

        // Update terminal title with current status
        this.updateTitle();

        // Check for terminal states
        if (task.status === "COMPLETED" || task.status === "ABANDONED") {
          if (!taskCompleted) {
            taskCompleted = true;

            // Stop task watch
            if (this.taskWatchInterval) {
              clearInterval(this.taskWatchInterval);
              this.taskWatchInterval = null;
            }

            // Start countdown and kill
            this.countdownAndKill(claudeProcess, task.status, taskInfo);
          }
        }
      }, 2000);

      claudeProcess.on("exit", async (code: number | null) => {
        // Stop task watch if still running
        if (this.taskWatchInterval) {
          clearInterval(this.taskWatchInterval);
          this.taskWatchInterval = null;
        }

        console.log("\n" + term.cyan("═".repeat(60)));
        console.log(term.dim(`Claude session ended (exit code: ${code})`));
        console.log(term.cyan("═".repeat(60)) + "\n");

        this.state.currentClaudeProcess = null;

        // Release the task from the queue
        await this.releaseTask(taskId);

        resolve();
      });

      claudeProcess.on("error", async (error: Error) => {
        console.error(term.red("Failed to spawn Claude process:"), error);
        this.state.currentClaudeProcess = null;

        if (this.taskWatchInterval) {
          clearInterval(this.taskWatchInterval);
          this.taskWatchInterval = null;
        }

        await this.releaseTask(taskId);
        resolve();
      });
    });
  }

  /**
   * Countdown and kill Claude process
   */
  private countdownAndKill(
    claudeProcess: ChildProcess,
    finalStatus: string,
    taskInfo: { issueNumber: number | string; taskNumber: number | string; taskTitle: string }
  ): void {
    let countdown = 5;

    console.log(term.green(`\n✓ Task ${finalStatus}! Session ending in ${countdown} seconds...`));
    this.setTerminalTitle(
      `${this.state.workerName} | #${taskInfo.issueNumber}.${taskInfo.taskNumber} ${taskInfo.taskTitle} | ${finalStatus} - ending in ${countdown}s`
    );

    const countdownInterval = setInterval(() => {
      countdown--;

      if (countdown > 0) {
        this.setTerminalTitle(
          `${this.state.workerName} | #${taskInfo.issueNumber}.${taskInfo.taskNumber} ${taskInfo.taskTitle} | ${finalStatus} - ending in ${countdown}s`
        );
      } else {
        clearInterval(countdownInterval);
        this.setTerminalTitle(`${this.state.workerName} | ending session...`);
        claudeProcess.kill("SIGTERM");
      }
    }, 1000);
  }

  // ==========================================================================
  // Task Release & Cleanup
  // ==========================================================================

  /**
   * Release a task from the dispatch queue and return to polling
   *
   * Only removes from queue if task is in terminal state.
   * If task is still in progress, leaves it in WORKING status - staleness
   * mechanism will allow another worker to reclaim if this worker dies.
   */
  private async releaseTask(taskId: string): Promise<void> {
    if (this.dispatchQueueRepository && this.taskRepository) {
      const task = this.taskRepository.findById(taskId);
      const isTerminal = task?.status === "COMPLETED" || task?.status === "ABANDONED";

      if (isTerminal) {
        this.dispatchQueueRepository.remove(taskId);
        console.log(`Task ${task?.status}, removed from queue: ${taskId}`);
      } else {
        // Leave in queue as WORKING - staleness will allow re-claim if worker dies
        console.log(
          `Task ${task?.status ?? "unknown"}, leaving in queue for potential re-claim: ${taskId}`
        );
      }
    }

    // Reset state
    this.state.currentTaskId = null;

    // Only reset to IDLE if not draining
    if (this.state.status !== "DRAINING") {
      this.state.status = "IDLE";
      if (this.workerRepository) {
        this.workerRepository.updateStatus(this.state.workerId, "IDLE");
      }
    }

    this.updateTitle();

    // Resume polling if not shutting down
    if (!this.isShuttingDown && this.state.status !== "DRAINING") {
      console.log(term.dim("\nReturning to polling for next task..."));
      this.startPolling();
    }
  }
}
