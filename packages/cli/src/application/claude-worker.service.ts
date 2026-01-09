/**
 * Claude Worker Service
 *
 * Manages a Claude Code worker that polls for tasks from the dispatch queue.
 * Workers self-register, send heartbeats, and claim tasks atomically.
 *
 * Features a fixed terminal header with task info while Claude's output scrolls below.
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
  // Cursor control
  saveCursor: () => process.stdout.write(`${ESC}7`),
  restoreCursor: () => process.stdout.write(`${ESC}8`),
  moveTo: (row: number, col: number) => process.stdout.write(`${CSI}${row};${col}H`),
  hideCursor: () => process.stdout.write(`${CSI}?25l`),
  showCursor: () => process.stdout.write(`${CSI}?25h`),

  // Screen control
  clearScreen: () => process.stdout.write(`${CSI}2J`),
  clearLine: () => process.stdout.write(`${CSI}2K`),
  setScrollRegion: (top: number, bottom: number) => process.stdout.write(`${CSI}${top};${bottom}r`),
  resetScrollRegion: () => process.stdout.write(`${CSI}r`),

  // Colors
  bold: (text: string) => `${CSI}1m${text}${CSI}0m`,
  dim: (text: string) => `${CSI}2m${text}${CSI}0m`,
  cyan: (text: string) => `${CSI}36m${text}${CSI}0m`,
  yellow: (text: string) => `${CSI}33m${text}${CSI}0m`,
  green: (text: string) => `${CSI}32m${text}${CSI}0m`,
  red: (text: string) => `${CSI}31m${text}${CSI}0m`,
};

const HEADER_LINES = 4; // Number of fixed header lines

// ============================================================================
// Types
// ============================================================================

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
 * Info displayed in the header
 */
interface HeaderInfo {
  workerName: string;
  issueNumber: number | string;
  taskNumber: number | string;
  taskTitle: string;
  status: string;
  countdown?: number;
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
 * 4. Spawns Claude to work on claimed tasks with a fixed header UI
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
  private scrollRegionActive = false;

  private readonly config: Required<WorkerConfig>;

  constructor(config: WorkerConfig = {}) {
    this.config = {
      name: config.name ?? "",
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 10000,
      pollIntervalMs: config.pollIntervalMs ?? 2000,
      staleThresholdSeconds: config.staleThresholdSeconds ?? 60,
    };
  }

  // ==========================================================================
  // Terminal UI
  // ==========================================================================

  /**
   * Draw the fixed header with task info
   */
  private drawHeader(info: HeaderInfo): void {
    const cols = process.stdout.columns || 80;
    const border = "═".repeat(Math.max(0, cols - 2));

    term.saveCursor();
    term.moveTo(1, 1);

    // Line 1: Top border
    term.clearLine();
    process.stdout.write(term.cyan(`╔${border}╗`));

    // Line 2: Task info
    term.moveTo(2, 1);
    term.clearLine();
    const taskInfo = ` 🤖 ${info.workerName} | Task #${info.issueNumber}.${info.taskNumber}: ${info.taskTitle} `;
    const truncatedInfo = taskInfo.slice(0, cols - 4);
    const infoPadding = " ".repeat(Math.max(0, cols - truncatedInfo.length - 2));
    process.stdout.write(
      term.cyan("║") + term.bold(term.yellow(truncatedInfo)) + infoPadding + term.cyan("║")
    );

    // Line 3: Status line
    term.moveTo(3, 1);
    term.clearLine();
    let statusText: string;
    if (info.countdown !== undefined) {
      statusText = ` Status: ${term.red(term.bold(`ENDING IN ${info.countdown}s...`))} `;
    } else {
      statusText = ` Status: ${info.status} `;
    }
    // Calculate padding without ANSI codes
    const plainStatus =
      info.countdown !== undefined
        ? ` Status: ENDING IN ${info.countdown}s... `
        : ` Status: ${info.status} `;
    const statusPadding = " ".repeat(Math.max(0, cols - plainStatus.length - 2));
    process.stdout.write(term.cyan("║") + term.dim(statusText) + statusPadding + term.cyan("║"));

    // Line 4: Bottom border
    term.moveTo(4, 1);
    term.clearLine();
    process.stdout.write(term.cyan(`╚${border}╝`));

    term.restoreCursor();
  }

  /**
   * Set up scroll region below the header
   */
  private setupScrollRegion(): void {
    const rows = process.stdout.rows || 24;
    term.clearScreen();
    term.setScrollRegion(HEADER_LINES + 1, rows);
    term.moveTo(HEADER_LINES + 1, 1);
    this.scrollRegionActive = true;

    // Handle terminal resize
    process.stdout.on("resize", () => {
      if (this.scrollRegionActive) {
        const newRows = process.stdout.rows || 24;
        term.setScrollRegion(HEADER_LINES + 1, newRows);
      }
    });
  }

  /**
   * Reset scroll region and clean up terminal
   */
  private cleanupScrollRegion(): void {
    if (this.scrollRegionActive) {
      term.resetScrollRegion();
      term.showCursor();
      term.moveTo(process.stdout.rows || 24, 1);
      this.scrollRegionActive = false;
    }
  }

  /**
   * Sets the terminal title using ANSI escape sequences
   */
  private setTerminalTitle(title: string): void {
    process.stdout.write(`\x1b]0;${title}\x07`);
  }

  /**
   * Update terminal title based on current state
   */
  private updateTitle(): void {
    let title: string;

    if (this.state.status === "DRAINING") {
      title = `dev-workflow: ${this.state.workerName} | draining...`;
    } else if (this.state.currentTaskId) {
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

    // Clean up scroll region first
    this.cleanupScrollRegion();

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
  // Task Polling & Claiming
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

  // ==========================================================================
  // Task Execution
  // ==========================================================================

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

    // Spawn Claude process with project cwd
    await this.spawnClaudeSession({
      taskId,
      issueNumber,
      taskNumber,
      taskTitle: task.title,
      prompt,
      cwd: projectPath,
    });
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

Use the dwf-work-task skill to load the task session and work through the COMPLETE task lifecycle:

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
   * Spawn a Claude session with fixed header UI
   */
  private async spawnClaudeSession(params: {
    taskId: string;
    issueNumber: number | string;
    taskNumber: number | string;
    taskTitle: string;
    prompt: string;
    cwd: string;
  }): Promise<void> {
    const { taskId, issueNumber, taskNumber, taskTitle, prompt, cwd } = params;

    // Set up the scroll region UI
    this.setupScrollRegion();

    const headerInfo: HeaderInfo = {
      workerName: this.state.workerName,
      issueNumber,
      taskNumber,
      taskTitle,
      status: "IN_PROGRESS",
    };

    this.drawHeader(headerInfo);

    // Move cursor to scroll region and show session start message
    term.moveTo(HEADER_LINES + 1, 1);
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
      let countdownActive = false;

      this.taskWatchInterval = setInterval(() => {
        if (!this.taskRepository || countdownActive) {
          return;
        }

        const task = this.taskRepository.findById(taskId);
        if (!task) {
          console.log(term.red("\nTask no longer exists, ending session..."));
          claudeProcess.kill("SIGTERM");
          return;
        }

        // Check for terminal states
        if (task.status === "COMPLETED" || task.status === "ABANDONED") {
          if (!taskCompleted) {
            taskCompleted = true;
            countdownActive = true;

            // Stop task watch
            if (this.taskWatchInterval) {
              clearInterval(this.taskWatchInterval);
              this.taskWatchInterval = null;
            }

            // Start countdown
            this.startCountdown(headerInfo, claudeProcess, task.status);
          }
        }
      }, 2000); // Check every 2 seconds

      claudeProcess.on("exit", async (code: number | null) => {
        // Stop task watch if still running
        if (this.taskWatchInterval) {
          clearInterval(this.taskWatchInterval);
          this.taskWatchInterval = null;
        }

        // Clean up scroll region
        this.cleanupScrollRegion();

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

        this.cleanupScrollRegion();
        await this.releaseTask(taskId);
        resolve();
      });
    });
  }

  /**
   * Start countdown in header before ending session
   */
  private startCountdown(
    headerInfo: HeaderInfo,
    claudeProcess: ChildProcess,
    finalStatus: string
  ): void {
    let countdown = 5;

    // Update header with final status
    headerInfo.status = finalStatus;
    headerInfo.countdown = countdown;
    this.drawHeader(headerInfo);

    console.log(term.green(`\n✓ Task ${finalStatus}! Session ending in ${countdown} seconds...`));

    const countdownInterval = setInterval(() => {
      countdown--;

      if (countdown > 0) {
        headerInfo.countdown = countdown;
        this.drawHeader(headerInfo);
      } else {
        clearInterval(countdownInterval);
        headerInfo.countdown = undefined;
        headerInfo.status = "SESSION ENDING";
        this.drawHeader(headerInfo);

        // Kill Claude process
        claudeProcess.kill("SIGTERM");
      }
    }, 1000);
  }

  // ==========================================================================
  // Task Release & Cleanup
  // ==========================================================================

  /**
   * Release a task from the dispatch queue and return to polling
   */
  private async releaseTask(taskId: string): Promise<void> {
    if (this.dispatchQueueRepository && this.taskRepository) {
      const task = this.taskRepository.findById(taskId);
      const isTerminal = task?.status === "COMPLETED" || task?.status === "ABANDONED";

      if (isTerminal) {
        this.dispatchQueueRepository.releaseClaim(taskId);
        console.log(`Task ${task?.status}, removed from queue: ${taskId}`);
      } else {
        this.dispatchQueueRepository.releaseTask(taskId);
        console.log(`Task ${task?.status ?? "unknown"}, marked as RELEASED in queue: ${taskId}`);
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
