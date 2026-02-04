/**
 * Claude Worker Service
 *
 * Manages a Claude Code worker that polls for tasks from the dispatch queue.
 * Workers self-register, send heartbeats, and claim tasks atomically.
 *
 * Architecture:
 * - WorkerQueueDb: Worker registration and dispatch queue (separate from tracking)
 * - DbSourceProvider: Connects to tracking databases per project
 * - ProjectsResolver: Resolves project config (gitRoot, sourceInfo) by slug
 *
 * The worker can run from any directory. When a task is claimed, the queue
 * entry contains projectSlug, which is used to resolve the project's tracking
 * database and gitRoot.
 */

import { spawn, ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  DbSourceProvider,
  ProjectsResolver,
  PlanDomainService,
  TypeDomainService,
  type DbSource,
  type Task,
} from "@dev-workflow/tracking";
import { issues, plans, tasks, sql } from "@dev-workflow/database/schema.js";
import { Effect } from "@dev-workflow/effect";
import type { WorkerQueueDb } from "@dev-workflow/dispatch/worker-queue-db.js";
import type { WorkerStatus } from "@dev-workflow/dispatch/worker.js";

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
  currentProjectSlug: string | null;
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
  private readonly queue: WorkerQueueDb;
  private readonly sourceProvider: DbSourceProvider;
  private readonly projectsResolver: ProjectsResolver;

  // Current project's tracking db (set when working on a task)
  private currentSource: DbSource | null = null;

  private state: WorkerState = {
    workerId: randomUUID(),
    workerName: "",
    status: "IDLE",
    currentTaskId: null,
    currentProjectSlug: null,
    currentClaudeProcess: null,
  };

  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private taskWatchInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private resolveShutdown: (() => void) | null = null;

  private readonly config: Required<WorkerConfig>;

  constructor(
    queue: WorkerQueueDb,
    sourceProvider: DbSourceProvider,
    projectsResolver: ProjectsResolver,
    config: WorkerConfig = {}
  ) {
    this.queue = queue;
    this.sourceProvider = sourceProvider;
    this.projectsResolver = projectsResolver;
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
   * Update terminal title based on current state
   */
  private async updateTitle(): Promise<void> {
    let title: string;

    if (this.state.status === "DRAINING") {
      title = `${this.state.workerName} | draining...`;
    } else if (this.state.currentTaskId && this.currentSource) {
      const task = await this.findTaskById(this.state.currentTaskId);
      const issueNumber = this.getIssueNumber(this.state.currentTaskId);
      const totalTasks = task ? await this.getTotalTaskCount(task.planId) : null;

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

  // ==========================================================================
  // Task Resolution Helpers (use current tracking db)
  // ==========================================================================

  /**
   * Find a task by ID in the current tracking database
   */
  private async findTaskById(taskId: string): Promise<Task | null> {
    if (!this.currentSource || !this.state.currentProjectSlug) {
      return null;
    }

    // Get project info to get projectId
    try {
      const projectInfo = this.projectsResolver.getProjectBySlugSync(this.state.currentProjectSlug);
      if (!projectInfo) return null;

      const client = this.currentSource.createClient(projectInfo.projectId);
      return (await Effect.runPromise(client.tasks.findById(taskId))) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get issue number for a task
   */
  private getIssueNumber(taskId: string): number | null {
    if (!this.currentSource) {
      return null;
    }

    const db = this.currentSource.getDb();
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
   * Get the total number of tasks for a plan
   */
  private async getTotalTaskCount(planId: string): Promise<number | null> {
    if (!this.currentSource || !this.state.currentProjectSlug) {
      return null;
    }

    try {
      const projectInfo = this.projectsResolver.getProjectBySlugSync(this.state.currentProjectSlug);
      if (!projectInfo) return null;

      const client = this.currentSource.createClient(projectInfo.projectId);
      const planTasks = await Effect.runPromise(client.tasks.findByPlanId(planId));
      return planTasks.length > 0 ? planTasks.length : null;
    } catch {
      return null;
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the worker: register, start heartbeat, and begin polling
   */
  async start(): Promise<void> {
    // Determine worker name
    if (this.config.name) {
      this.state.workerName = this.config.name;
    } else {
      this.state.workerName = this.queue.getNextWorkerName();
    }

    // Check for existing claim (resume after reconnect)
    const existingClaim = this.queue.findClaimByWorker(this.state.workerId);
    if (existingClaim) {
      console.log(`Resuming existing claim: ${existingClaim.taskId}`);
      this.state.currentTaskId = existingClaim.taskId;
      this.state.currentProjectSlug = existingClaim.projectSlug;
      this.state.status = "WORKING";
    }

    // Register worker with process ID (for killing stale workers)
    this.queue.registerWorker(this.state.workerId, this.state.workerName, process.pid);
    const autoClaimSuffix = this.config.autoClaim ? " [auto-claim enabled]" : "";
    console.log(
      `Worker registered: ${this.state.workerName} (${this.state.workerId.slice(0, 8)}...)${autoClaimSuffix}`
    );

    // Update terminal title
    await this.updateTitle();

    // Setup signal handlers for graceful shutdown
    this.setupSignalHandlers();

    // Start heartbeat loop
    this.startHeartbeat();

    // Start working or polling
    if (this.state.currentTaskId && this.state.currentProjectSlug) {
      await this.workOnTask(this.state.currentTaskId, this.state.currentProjectSlug);
    } else {
      this.startPolling();
    }

    // Keep the promise pending until shutdown completes.
    // Without this, the caller (createCliCommand) would dispose the
    // DI container while polling timers are still running.
    await new Promise<void>((resolve) => {
      this.resolveShutdown = resolve;
    });
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
    if (this.state.currentTaskId) {
      this.state.status = "DRAINING";
      this.queue.updateStatus(this.state.workerId, "DRAINING");
      console.log("Status: DRAINING (finishing current task)");
      await this.updateTitle();

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
    this.queue.unregisterWorker(this.state.workerId);
    console.log("Worker unregistered");

    // Close queue database
    this.queue.close();

    // Close source provider
    this.sourceProvider.closeAll();

    console.log("Shutdown complete");

    // Resolve the pending start() promise so the caller can clean up
    if (this.resolveShutdown) {
      this.resolveShutdown();
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
      this.queue.updateHeartbeat(this.state.workerId, process.pid);
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
    // Try to claim from the dispatch queue
    const claim = this.queue.claimTask(this.state.workerId, this.config.staleThresholdSeconds);

    if (claim) {
      console.log(
        term.green(`Claimed from queue: ${claim.taskId} (project: ${claim.projectSlug})`)
      );

      // Stop polling while working
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }

      await this.workOnTask(claim.taskId, claim.projectSlug, "queue");
      return;
    }

    // If auto-claim is enabled and queue is empty, look for READY tasks
    if (this.config.autoClaim) {
      // tryAutoClaimReadyTask handles everything: enqueue, claim, work
      // Returns the task if claimed, null if nothing available
      await this.tryAutoClaimReadyTask();
    }
  }

  /**
   * Try to auto-claim a READY task with satisfied dependencies
   *
   * Scans all configured projects for READY tasks that:
   * 1. Have all dependencies satisfied (COMPLETED or ABANDONED)
   * 2. Are not already claimed by another session
   * 3. Are not already in the dispatch queue
   *
   * When a task is auto-claimed, it's added to the dispatch queue so the
   * claudeDone mechanism works correctly (end_worker_session sets claudeDone
   * flag which the worker polls for to know when to terminate).
   *
   * Based on the original tryAutoClaimTask from commit 38eea40, adapted for
   * multi-project architecture with separate worker queue database.
   *
   * @returns The claimed task, or null if none available
   */
  private async tryAutoClaimReadyTask(): Promise<Task | null> {
    // Get all configured projects
    const projects = await Effect.runPromise(this.projectsResolver.getAllProjects());

    for (const projectInfo of projects) {
      try {
        const source = this.sourceProvider.getOrCreate(projectInfo.sourceInfo);
        const client = source.createClient(projectInfo.projectId);

        // Create PlanDomainService for dependency checking
        const typeDomainService = new TypeDomainService(source.types);
        const planDomainService = new PlanDomainService(
          client.plans,
          client.tasks,
          client.issues,
          typeDomainService
        );

        // Find READY tasks
        const readyTasks = await Effect.runPromise(client.tasks.findMany({ status: "READY" }));

        for (const task of readyTasks) {
          // Skip if already in dispatch queue
          const existing = this.queue.findByTaskId(task.id);
          if (existing) {
            continue;
          }

          // Skip if already claimed by another session
          if (task.sessionId) {
            continue;
          }

          // Skip if dependencies are not satisfied
          if (!(await Effect.runPromise(planDomainService.areDependenciesSatisfied(task)))) {
            continue;
          }

          // Found a claimable task - add to dispatch queue and claim atomically
          // First, enqueue the task (idempotent - returns existing if already queued)
          this.queue.enqueue(task.id, projectInfo.slug);

          // Then claim it from the queue using the standard mechanism
          const claim = this.queue.claimTask(
            this.state.workerId,
            this.config.staleThresholdSeconds
          );

          // Verify we claimed the exact task we dispatched (race condition check)
          if (!claim || claim.taskId !== task.id) {
            // Lost the race or got a different task, try the next one
            continue;
          }

          console.log(term.cyan(`Auto-claimed: ${task.title} (project: ${projectInfo.slug})`));

          // Stop polling while working
          if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
          }

          await this.workOnTask(claim.taskId, claim.projectSlug, "auto-claim");
          return task;
        }
      } catch (error) {
        // Skip projects that can't be accessed
        console.error(term.dim(`Failed to check project ${projectInfo.slug}: ${error}`));
      }
    }

    return null;
  }

  /**
   * Work on a claimed task by spawning a Claude process
   *
   * @param taskId - ID of the task to work on
   * @param projectSlug - Project slug from queue entry
   * @param claimSource - How the task was claimed: 'queue' or 'auto-claim'
   */
  private async workOnTask(
    taskId: string,
    projectSlug: string,
    claimSource: ClaimSource = "queue"
  ): Promise<void> {
    // Resolve project config
    let projectInfo;
    try {
      projectInfo = await Effect.runPromise(this.projectsResolver.getProjectBySlug(projectSlug));
    } catch (error) {
      console.error(`Failed to resolve project: ${projectSlug}`, error);
      await this.releaseTask(taskId);
      return;
    }

    // Connect to tracking database
    this.currentSource = this.sourceProvider.getOrCreate(projectInfo.sourceInfo);
    this.state.currentTaskId = taskId;
    this.state.currentProjectSlug = projectSlug;
    this.state.status = "WORKING";
    this.queue.updateStatus(this.state.workerId, "WORKING");
    await this.updateTitle();

    // Get task details
    const task = await this.findTaskById(taskId);
    if (!task) {
      console.error(`Task not found: ${taskId}`);
      await this.releaseTask(taskId);
      return;
    }

    const issueNumber = this.getIssueNumber(taskId) ?? "?";
    const taskNumber = task.number ?? "?";
    const sourceLabel = claimSource === "auto-claim" ? " (auto-claimed)" : "";

    console.log(`Working on task #${issueNumber}.${taskNumber}: ${task.title}${sourceLabel}`);
    console.log(`Project: ${projectSlug} (${projectInfo.gitRoot})`);

    // Build the prompt for Claude
    const prompt = this.buildClaudePrompt(taskId, issueNumber, taskNumber);

    // Spawn Claude process with project gitRoot as cwd
    await this.spawnClaudeSession(taskId, prompt, projectInfo.gitRoot);
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

      this.taskWatchInterval = setInterval(async () => {
        const task = await this.findTaskById(taskId);
        if (!task) {
          console.log(term.red("\nTask no longer exists, ending session..."));
          claudeProcess.kill("SIGTERM");
          return;
        }

        // Update terminal title with current status
        await this.updateTitle();

        // Check for claudeDone flag from the dispatch queue
        const queueEntry = this.queue.findByTaskId(taskId);
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
   */
  private async releaseTask(taskId: string): Promise<void> {
    const task = await this.findTaskById(taskId);
    const taskIsTerminal = task ? task.isTerminal : false;

    if (taskIsTerminal) {
      this.queue.remove(taskId);
      console.log(`Task ${task?.status}, removed from queue: ${taskId}`);
    } else {
      // Leave in queue as WORKING - staleness will allow re-claim if worker dies
      console.log(
        `Task ${task?.status ?? "unknown"}, leaving in queue for potential re-claim: ${taskId}`
      );
    }

    // Reset state
    this.state.currentTaskId = null;
    this.state.currentProjectSlug = null;
    this.currentSource = null;

    // Only reset to IDLE if not draining
    if (this.state.status !== "DRAINING") {
      this.state.status = "IDLE";
      this.queue.updateStatus(this.state.workerId, "IDLE");
    }

    await this.updateTitle();

    // Resume polling if not shutting down
    if (!this.isShuttingDown && this.state.status !== "DRAINING") {
      console.log(term.dim("\nReturning to polling for next task..."));
      this.startPolling();
    }
  }
}
