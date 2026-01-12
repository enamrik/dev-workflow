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
  DbSourceProvider,
  runSqliteMigrations,
  getGlobalDatabasePath,
  resolveConfig,
  type DbSource,
  type DbClient,
  type WorkerStatus,
  type Task,
  issues,
  plans,
  tasks,
  dispatchQueue,
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
  /** Automatically claim READY tasks when dependencies complete */
  autoClaim?: boolean;
}

/**
 * Source of how a task was claimed
 */
export type ClaimSource = "queue" | "auto-claim";

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
  private sourceProvider: DbSourceProvider | null = null;
  private source: DbSource | null = null;
  // Cache client per project for task/plan lookups
  private projectClients: Map<string, DbClient> = new Map();

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
      autoClaim: config.autoClaim ?? false,
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
   * Get or create a project-scoped client
   */
  private getProjectClient(projectId: string): DbClient | null {
    if (!this.source) {
      return null;
    }
    let client = this.projectClients.get(projectId);
    if (!client) {
      client = this.source.createClient(projectId);
      this.projectClients.set(projectId, client);
    }
    return client;
  }

  /**
   * Find a task by ID, looking up the project from the issue
   */
  private findTaskById(taskId: string): Task | null {
    if (!this.source) {
      return null;
    }
    // We need to query tasks directly - use raw query to find the task and its project
    const db = this.source.getDb();
    const result = db
      .select()
      .from(issues)
      .innerJoin(dispatchQueue, sql`${dispatchQueue.taskId} = ${taskId}`)
      .limit(1)
      .all();

    if (result.length === 0) {
      return null;
    }

    const projectId = result[0]?.issues.projectId;
    if (!projectId) {
      return null;
    }

    const client = this.getProjectClient(projectId);
    return client?.tasks.findById(taskId) ?? null;
  }

  /**
   * Update terminal title based on current state
   * Format: worker | #issue.task [N/M] - title | status
   */
  private updateTitle(): void {
    let title: string;

    if (this.state.status === "DRAINING") {
      title = `${this.state.workerName} | draining...`;
    } else if (this.state.currentTaskId) {
      const task = this.findTaskById(this.state.currentTaskId);
      const issueNumber = this.getIssueNumber(this.state.currentTaskId);
      const totalTasks = task ? this.getTotalTaskCount(task.planId) : null;

      if (issueNumber && task) {
        const taskPosition = totalTasks ? ` [${task.number}/${totalTasks}]` : "";
        title = `${this.state.workerName} | #${issueNumber}.${task.number}${taskPosition} - ${task.title} | ${task.status}`;
      } else {
        title = `${this.state.workerName} | working...`;
      }
    } else {
      title = `${this.state.workerName} | polling...`;
    }

    this.setTerminalTitle(title);
  }

  /**
   * Get the total number of tasks for a plan
   */
  private getTotalTaskCount(planId: string): number | null {
    // This is trickier - we need to find which project the plan belongs to
    // For now, iterate through cached clients
    for (const client of this.projectClients.values()) {
      const tasks = client.tasks.findByPlanId(planId);
      if (tasks.length > 0) {
        return tasks.length;
      }
    }
    return null;
  }

  // ==========================================================================
  // Database & Initialization
  // ==========================================================================

  /**
   * Initialize the worker: connect to database and set up repositories
   */
  async initialize(): Promise<void> {
    const dbPath = getGlobalDatabasePath();
    runSqliteMigrations(dbPath);
    this.sourceProvider = new DbSourceProvider();
    this.source = this.sourceProvider.getOrCreate({ connectionString: dbPath });
    // DependencyService needs a client for project-scoped operations
    // We'll create it lazily when needed
  }

  /**
   * Start the worker: register, start heartbeat, and begin polling
   */
  async start(): Promise<void> {
    if (!this.source) {
      throw new Error("Worker not initialized. Call initialize() first.");
    }

    // Determine worker name
    if (this.config.name) {
      this.state.workerName = this.config.name;
    } else {
      this.state.workerName = this.source.workers.getNextWorkerName();
    }

    // Check for existing claim (resume after reconnect)
    const existingClaim = this.source.dispatchQueue.findClaimByWorker(this.state.workerId);
    if (existingClaim) {
      console.log(`Resuming existing claim: ${existingClaim.taskId}`);
      this.state.currentTaskId = existingClaim.taskId;
      this.state.status = "WORKING";
    }

    // Register worker with process ID (for killing stale workers)
    this.source.workers.register(this.state.workerId, this.state.workerName, process.pid);
    const autoClaimSuffix = this.config.autoClaim ? " [auto-claim enabled]" : "";
    console.log(
      `Worker registered: ${this.state.workerName} (${this.state.workerId.slice(0, 8)}...)${autoClaimSuffix}`
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
    if (this.source && this.state.currentTaskId) {
      this.state.status = "DRAINING";
      this.source!.workers.updateStatus(this.state.workerId, "DRAINING");
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
    if (this.source) {
      this.source!.workers.unregister(this.state.workerId);
      console.log("Worker unregistered");
    }

    // Close database
    if (this.source) {
      this.sourceProvider!.closeAll();
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
    if (!this.source) {
      return null;
    }

    const db = this.source.getDb();
    const result = db
      .select({ number: issues.number })
      .from(tasks)
      .innerJoin(plans, sql`${plans.id} = ${tasks.planId}`)
      .innerJoin(issues, sql`${issues.id} = ${plans.issueId}`)
      .where(sql`${tasks.id} = ${taskId}`)
      .get();

    return result?.number ?? null;
  }

  /**
   * Get the project git root path for a task
   */
  private async getProjectPath(taskId: string): Promise<string | null> {
    if (!this.source) {
      return null;
    }

    const db = this.source.getDb();

    const issueResult = db
      .select({ projectId: issues.projectId })
      .from(tasks)
      .innerJoin(plans, sql`${plans.id} = ${tasks.planId}`)
      .innerJoin(issues, sql`${issues.id} = ${plans.issueId}`)
      .where(sql`${tasks.id} = ${taskId}`)
      .get();

    if (!issueResult?.projectId) {
      return null;
    }

    const project = await this.source.projects.findById(issueResult.projectId);
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
      if (this.source) {
        // Update heartbeat with PID (in case PID somehow changed, though unlikely)
        this.source!.workers.updateHeartbeat(this.state.workerId, process.pid);
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
   * Try to claim a task from the dispatch queue, or auto-claim if enabled
   */
  private async tryClaimTask(): Promise<void> {
    if (!this.source) {
      return;
    }

    // First, try to claim from the dispatch queue (priority)
    const claim = this.source!.dispatchQueue.claimTask(
      this.state.workerId,
      this.config.staleThresholdSeconds
    );

    if (claim) {
      console.log(term.green(`Claimed from queue: ${claim.taskId}`));

      // Stop polling while working
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }

      await this.workOnTask(claim.taskId, "queue");
      return;
    }

    // If no queued task and auto-claim is enabled, try to find a READY task
    if (this.config.autoClaim) {
      const autoClaimedTask = await this.tryAutoClaimTask();
      if (autoClaimedTask) {
        console.log(term.cyan(`Auto-claimed: ${autoClaimedTask.id}`));

        // Stop polling while working
        if (this.pollInterval) {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
        }

        await this.workOnTask(autoClaimedTask.id, "auto-claim");
      }
    }
  }

  /**
   * Try to auto-claim a READY task with satisfied dependencies
   *
   * Scans for READY tasks that:
   * 1. Have all dependencies satisfied (COMPLETED or ABANDONED)
   * 2. Are not already claimed by another session
   * 3. Are not already in the dispatch queue
   *
   * When a task is auto-claimed, it's added to the dispatch queue so the
   * claudeDone mechanism works correctly (end_worker_session sets claudeDone
   * flag which the worker polls for to know when to terminate).
   *
   * @returns The claimed task, or null if none available
   */
  private async tryAutoClaimTask(): Promise<Task | null> {
    if (!this.source) {
      return null;
    }

    // Get all task IDs currently in the dispatch queue
    const db = this.source.getDb();

    // Find READY tasks that are not already in the dispatch queue and have no session
    const readyTasks = db
      .select()
      .from(tasks)
      .where(sql`${tasks.status} = 'READY' AND ${tasks.isDeleted} = 0`)
      .all() as Task[];
    const queuedTaskIds = new Set(
      db
        .select({ taskId: dispatchQueue.taskId })
        .from(dispatchQueue)
        .all()
        .map((r) => r.taskId)
    );

    // Filter for claimable tasks
    for (const task of readyTasks) {
      // Skip if already in dispatch queue
      if (queuedTaskIds.has(task.id)) {
        continue;
      }

      // Skip if already claimed by another session
      if (task.sessionId) {
        continue;
      }

      // Skip if dependencies are not satisfied
      // Dependencies are satisfied when all dependent tasks are COMPLETED or ABANDONED
      if (task.dependsOn && task.dependsOn.length > 0) {
        const depTasks = db
          .select()
          .from(tasks)
          .where(sql`${tasks.id} IN (${task.dependsOn.map((id) => `'${id}'`).join(",")})`)
          .all() as Task[];

        const allSatisfied =
          depTasks.length === task.dependsOn.length &&
          depTasks.every((d) => d.status === "COMPLETED" || d.status === "ABANDONED");

        if (!allSatisfied) {
          continue;
        }
      }

      // Found a claimable task - add to dispatch queue and claim atomically
      // First, enqueue the task (idempotent - returns existing if already queued)
      this.source!.dispatchQueue.enqueue(task.id);

      // Then claim it from the queue using the standard mechanism
      const claim = this.source!.dispatchQueue.claimTask(
        this.state.workerId,
        this.config.staleThresholdSeconds
      );

      if (!claim || claim.taskId !== task.id) {
        // Lost the race or got a different task, try the next one
        continue;
      }

      // Return the task (status will be updated by load_task_session when Claude runs)
      return this.findTaskById(task.id);
    }

    return null;
  }

  /**
   * Work on a claimed task by spawning a Claude process
   *
   * @param taskId - ID of the task to work on
   * @param claimSource - How the task was claimed: 'queue' or 'auto-claim'
   */
  private async workOnTask(taskId: string, claimSource: ClaimSource = "queue"): Promise<void> {
    if (!this.source) {
      return;
    }

    // Update state
    this.state.currentTaskId = taskId;
    this.state.status = "WORKING";
    this.source!.workers.updateStatus(this.state.workerId, "WORKING");
    this.updateTitle();

    // Get task details
    const task = this.findTaskById(taskId);
    if (!task) {
      console.error(`Task not found: ${taskId}`);
      await this.releaseTask(taskId);
      return;
    }

    const issueNumber = this.getIssueNumber(taskId) ?? "?";
    const taskNumber = task.number ?? "?";
    const sourceLabel = claimSource === "auto-claim" ? " (auto-claimed)" : "";

    console.log(`Working on task #${issueNumber}.${taskNumber}: ${task.title}${sourceLabel}`);

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
    const workerId = this.state.workerId;

    return `You are running as a worker process for dev-workflow. A task has been dispatched to you.

**WORKER ID: ${workerId}**

Start working on task #${issueNumber}.${taskNumber} (ID: ${taskId}).

Use the dwf-worker-task skill to load the task session and work through the COMPLETE task lifecycle:

1. Load the task with load_task_session
   - **CRITICAL: You MUST pass workerId="${workerId}" to load_task_session**
   - Workers are required to use isolated mode (the default) and must pass their workerId
   - The MCP tool will reject your call if you pass workerId with any mode other than "isolated"
2. Implement the task according to its description and acceptance criteria
3. Create a PR when implementation is done
4. Submit for review
5. WAIT for the PR to be merged (check with get_task_pr_status)
6. Once PR is merged, call complete_task with a finalLogEntry summary
7. After task completion, check if all tasks for issue #${issueNumber} are complete
8. If all tasks are complete, ask the user if they want to close the issue

**REMINDER: When calling load_task_session, include workerId="${workerId}"**

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

      // Watch for task completion via claudeDone flag
      // Worker waits indefinitely until Claude calls end_worker_session
      let sessionEnded = false;

      this.taskWatchInterval = setInterval(() => {
        if (!this.source) {
          return;
        }

        const task = this.findTaskById(taskId);
        if (!task) {
          console.log(term.red("\nTask no longer exists, ending session..."));
          claudeProcess.kill("SIGTERM");
          return;
        }

        // Update terminal title with current status
        this.updateTitle();

        // Check for claudeDone flag from the dispatch queue
        // This is the ONLY way the session should end - when Claude explicitly signals completion
        const queueEntry = this.source!.dispatchQueue.findByTaskId(taskId);
        if (queueEntry?.claudeDone) {
          if (!sessionEnded) {
            sessionEnded = true;

            // Stop task watch
            if (this.taskWatchInterval) {
              clearInterval(this.taskWatchInterval);
              this.taskWatchInterval = null;
            }

            console.log(term.green("\n✓ Claude signaled session complete via end_worker_session"));
            this.terminateSession(claudeProcess, task.status);
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
   * Terminate the Claude session
   * Called when claudeDone flag is received (Claude called end_worker_session)
   */
  private terminateSession(claudeProcess: ChildProcess, finalStatus: string): void {
    console.log(term.green(`\n✓ Task ${finalStatus}! Terminating session...`));
    this.setTerminalTitle(`${this.state.workerName} | ${finalStatus} - terminating...`);
    claudeProcess.kill("SIGTERM");
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
    if (this.source) {
      const task = this.findTaskById(taskId);
      const isTerminal = task?.status === "COMPLETED" || task?.status === "ABANDONED";

      if (isTerminal) {
        this.source!.dispatchQueue.remove(taskId);
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
      if (this.source) {
        this.source!.workers.updateStatus(this.state.workerId, "IDLE");
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
