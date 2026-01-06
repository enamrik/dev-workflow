/**
 * Claude Worker Service
 *
 * Manages a Claude Code worker that polls for tasks from the dispatch queue.
 * Workers self-register, send heartbeats, and claim tasks atomically.
 */

import { spawn, ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  DatabaseService,
  SqliteWorkerRepository,
  SqliteDispatchQueueRepository,
  SqliteTaskRepository,
  SqlitePlanRepository,
  getGlobalDatabasePath,
  type WorkerStatus,
  issues,
  sql,
} from "@dev-workflow/core";

/**
 * Configuration for the worker service
 */
export interface WorkerConfig {
  /** Worker name (auto-generated if not provided) */
  name?: string;
  /** Heartbeat interval in milliseconds (default: 10000ms = 10s) */
  heartbeatIntervalMs?: number;
  /** Poll interval in milliseconds (default: 2000ms = 2s) */
  pollIntervalMs?: number;
  /** Stale heartbeat threshold in seconds (default: 60s) */
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

/**
 * Sets the terminal title using ANSI escape sequences
 */
function setTerminalTitle(title: string): void {
  // ESC ] 0 ; <title> BEL
  process.stdout.write(`\x1b]0;${title}\x07`);
}

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
  private dbService: DatabaseService | null = null;
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
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 10000,
      pollIntervalMs: config.pollIntervalMs ?? 2000,
      staleThresholdSeconds: config.staleThresholdSeconds ?? 60,
    };
  }

  /**
   * Initialize the worker: connect to database and set up repositories
   */
  async initialize(): Promise<void> {
    const dbPath = getGlobalDatabasePath();
    this.dbService = await DatabaseService.create(dbPath);
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

    // If we have an existing claim, resume working on it
    if (this.state.currentTaskId) {
      await this.workOnTask(this.state.currentTaskId);
    } else {
      // Start polling for new tasks
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

    // Query the issue directly using raw SQL since we don't have projectId
    const db = this.dbService.getDb();
    const result = db
      .select({ number: issues.number })
      .from(issues)
      .where(sql`${issues.id} = ${plan.issueId}`)
      .get();

    return result?.number ?? null;
  }

  /**
   * Update terminal title based on current state
   */
  private updateTitle(): void {
    let title: string;

    if (this.state.status === "DRAINING") {
      title = `dev-workflow: ${this.state.workerName} | draining...`;
    } else if (this.state.currentTaskId) {
      // Get task and issue info for display
      const task = this.taskRepository?.findById(this.state.currentTaskId);
      const issueNumber = this.state.currentTaskId
        ? this.getIssueNumber(this.state.currentTaskId)
        : null;

      if (issueNumber && task) {
        title = `dev-workflow: ${this.state.workerName} | #${issueNumber}.${task.number}`;
      } else {
        title = `dev-workflow: ${this.state.workerName} | working...`;
      }
    } else {
      title = `dev-workflow: ${this.state.workerName} | waiting...`;
    }

    setTerminalTitle(title);
  }

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

    // Get task details for the prompt
    const task = this.taskRepository.findById(taskId);
    if (!task) {
      console.error(`Task not found: ${taskId}`);
      await this.releaseTask(taskId);
      return;
    }

    const issueNumber = this.getIssueNumber(taskId) ?? "?";
    const taskNumber = task.number ?? "?";

    console.log(`Working on task #${issueNumber}.${taskNumber}: ${task.title}`);

    // Build the prompt for Claude
    const prompt = this.buildClaudePrompt(taskId, issueNumber, taskNumber);

    // Spawn Claude process
    await this.spawnClaude(prompt, taskId);
  }

  /**
   * Build the prompt to pass to Claude
   */
  private buildClaudePrompt(
    taskId: string,
    issueNumber: number | string,
    taskNumber: number | string
  ): string {
    // The prompt instructs Claude to start working on the task
    // It uses the dwf-work-task skill which will load the task session
    return `You are running as a worker process for dev-workflow. A task has been dispatched to you.

Start working on task #${issueNumber}.${taskNumber} (ID: ${taskId}).

Use the dwf-work-task skill to load the task session and begin working. Follow the skill instructions for:
1. Loading the task with load_task_session
2. Implementing the task according to its description and acceptance criteria
3. Creating a PR when done
4. Submitting for review

Important: You are running in worker mode. Do NOT ask for user confirmation - proceed autonomously with the implementation.`;
  }

  /**
   * Spawn a Claude process to work on the task
   */
  private async spawnClaude(prompt: string, taskId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      // Spawn claude with the prompt
      const claudeProcess = spawn("claude", ["--print", prompt], {
        stdio: "inherit",
        env: process.env,
      });

      this.state.currentClaudeProcess = claudeProcess;

      // Start watching task status
      this.startTaskWatch(taskId, claudeProcess);

      claudeProcess.on("exit", async (code: number | null) => {
        console.log(`Claude process exited with code ${code}`);
        this.state.currentClaudeProcess = null;

        // Stop task watch
        if (this.taskWatchInterval) {
          clearInterval(this.taskWatchInterval);
          this.taskWatchInterval = null;
        }

        // Release the task from the queue
        await this.releaseTask(taskId);

        resolve();
      });

      claudeProcess.on("error", async (error: Error) => {
        console.error("Failed to spawn Claude process:", error);
        this.state.currentClaudeProcess = null;

        // Stop task watch
        if (this.taskWatchInterval) {
          clearInterval(this.taskWatchInterval);
          this.taskWatchInterval = null;
        }

        // Release the task from the queue
        await this.releaseTask(taskId);

        resolve();
      });
    });
  }

  /**
   * Start watching task status for terminal states
   */
  private startTaskWatch(taskId: string, claudeProcess: ChildProcess): void {
    this.taskWatchInterval = setInterval(() => {
      if (!this.taskRepository) {
        return;
      }

      const task = this.taskRepository.findById(taskId);
      if (!task) {
        console.log("Task no longer exists, killing Claude process");
        claudeProcess.kill();
        return;
      }

      // Check for terminal states
      if (task.status === "COMPLETED" || task.status === "ABANDONED") {
        console.log(`Task reached terminal state: ${task.status}`);
        claudeProcess.kill();
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Release a task from the dispatch queue and return to polling
   */
  private async releaseTask(taskId: string): Promise<void> {
    if (this.dispatchQueueRepository) {
      this.dispatchQueueRepository.releaseClaim(taskId);
      console.log(`Released task: ${taskId}`);
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
      this.startPolling();
    }
  }
}
