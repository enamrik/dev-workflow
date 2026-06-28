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
import { existsSync } from "node:fs";
import {
  DbSourceProvider,
  ProjectsResolver,
  PlanDomainService,
  TaskDomainService,
  TypeDomainService,
  resolveProjectInfoByTaskId,
  comparePriorityDesc,
  type DbSource,
  type DbClient,
  type IssuePriority,
  type ProjectInfo,
  type Task,
} from "@dev-workflow/tracking";
import { issues, plans, tasks, sql } from "@dev-workflow/database/schema.js";
import {
  NodeGitWorktreeService,
  generateWorktreeNames,
} from "@dev-workflow/git/worktrees/git-worktree-service.js";
import { getGlobalDatabasePath } from "@dev-workflow/git/track-directory-resolver.js";
import { WorkerSessionLog } from "@dev-workflow/git/worker-session-log.js";
import { DflUpgradeDetector } from "../infrastructure/dfl-upgrade-detector.js";
import { Effect } from "@dev-workflow/effect";
import { PromptResolver } from "../prompts/prompt-resolver.js";
import {
  WORKER_TASK_PROMPT_DEFAULT,
  WORKER_TASK_PROMPT_NAME,
} from "../prompts/worker-task-prompt.js";
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
// Re-exec arg reconstruction
// ============================================================================

/**
 * Grace window (ms) the parent waits after spawning the replacement build
 * before tearing itself down. Spawning succeeds even when the new build dies
 * on startup (e.g. a bad arg), so we only commit to the handoff once the child
 * has survived this window; an exit within it aborts the handoff.
 */
const REEXEC_HANDOFF_GRACE_MS = 500;

/**
 * Build the argv (after `process.execPath`) for re-exec'ing a worker into a
 * freshly-installed dfl bundle. The passthrough `claudeArgs` — everything the
 * user put after `--` on the original `dfl claude` invocation (e.g. `--model`,
 * `--dangerously-skip-permissions`) — must be fenced behind their own `--`
 * separator so the re-exec'd `dfl claude` forwards them to the inner claude
 * process instead of parsing them as its own options (which fails with
 * `unknown option`). Empty `claudeArgs` → no trailing separator.
 */
export function buildReExecArgs(
  bundlePath: string,
  workerName: string,
  claudeArgs: string[]
): string[] {
  return [
    bundlePath,
    "claude",
    "--name",
    workerName,
    ...(claudeArgs.length > 0 ? ["--", ...claudeArgs] : []),
  ];
}

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the worker service
 */
export interface WorkerConfig {
  /** Worker name (auto-generated if not provided) */
  name?: string;
  /** Stable worker identity supplied by the supervisor so a relaunched child resumes its own claim (#47). A fresh UUID is minted when absent. */
  workerId?: string;
  /** Heartbeat interval in milliseconds (default: 5000ms = 5s) */
  heartbeatIntervalMs?: number;
  /** Poll interval in milliseconds (default: 2000ms = 2s) */
  pollIntervalMs?: number;
  /**
   * How often the worker re-asserts its terminal-title banner while a Claude
   * session is active (default: 1000ms = 1s). The spawned `claude` process
   * inherits the TTY and writes its own title; re-asserting on this cadence
   * keeps the worker's banner the one that wins the screen. Lower = wins harder.
   */
  titleAssertIntervalMs?: number;
  /** Stale heartbeat threshold in seconds (default: 10s) */
  staleThresholdSeconds?: number;
  /** Extra flags forwarded verbatim to every spawned `claude` invocation (before the prompt) */
  claudeArgs?: string[];
  /** Running dfl build version (the `__DFL_VERSION__` define) — used to detect an installed-version change and self-restart. */
  runningVersion?: string;
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
  /** Slug carried by the dispatch-queue entry — a label/hint only, never used for resolution. */
  currentProjectSlug: string | null;
  /** Project authoritatively resolved from the task (the source of truth while working). */
  currentProjectInfo: ProjectInfo | null;
  currentClaudeProcess: ChildProcess | null;
  /** Per-task lifecycle log for the in-flight session (null while idle). */
  currentSessionLog: WorkerSessionLog | null;
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
  private readonly promptResolver = new PromptResolver();

  // Current project's tracking db (set when working on a task)
  private currentSource: DbSource | null = null;

  // Global tracking db (shared by every project) — used to resolve a task's
  // owning project authoritatively, regardless of the dispatch-queue slug.
  private globalSource: DbSource | null = null;

  private state: WorkerState = {
    // Set from this.config.workerId in the constructor (so the supervised id is
    // adopted); the empty placeholder is never observed externally.
    workerId: "",
    workerName: "",
    status: "IDLE",
    currentTaskId: null,
    currentProjectSlug: null,
    currentProjectInfo: null,
    currentClaudeProcess: null,
    currentSessionLog: null,
  };

  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private taskWatchInterval: NodeJS.Timeout | null = null;
  /** Re-asserts the worker banner on a tight cadence so it wins the TTY title. */
  private titleAssertInterval: NodeJS.Timeout | null = null;
  /** Last rendered banner string, re-emitted by titleAssertInterval to win. */
  private currentTitle = "";
  private isShuttingDown = false;
  private resolveShutdown: (() => void) | null = null;
  /** True while a poll tick's async work is still in flight — prevents the timer from overlapping ticks (e.g. claiming twice, or re-execing while a claim is mid-flight). */
  private pollTickInFlight = false;
  /** True once a self-restart has been triggered — stops further poll activity until the process exits. */
  private isRestarting = false;

  private readonly config: Required<WorkerConfig>;

  /** Detects when the installed dfl bundle is a different version than this build. */
  private readonly upgradeDetector: DflUpgradeDetector;

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
      workerId: config.workerId ?? randomUUID(),
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 5000,
      pollIntervalMs: config.pollIntervalMs ?? 2000,
      titleAssertIntervalMs: config.titleAssertIntervalMs ?? 1000,
      staleThresholdSeconds: config.staleThresholdSeconds ?? 10,
      claudeArgs: config.claudeArgs ?? [],
      runningVersion: config.runningVersion ?? "0.0.0-dev",
    };
    // Adopt the (possibly supervised) worker identity so start()'s resume logic
    // (findClaimByWorker(this.state.workerId)) matches a claim left by a prior
    // relaunch carrying the same id (#47).
    this.state.workerId = this.config.workerId;
    this.upgradeDetector = new DflUpgradeDetector(this.config.runningVersion);
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
   * Stop the per-session timers (task watch + title re-assert). Safe to call
   * repeatedly — each guarded clear is idempotent.
   */
  private stopSessionTimers(): void {
    if (this.taskWatchInterval) {
      clearInterval(this.taskWatchInterval);
      this.taskWatchInterval = null;
    }
    if (this.titleAssertInterval) {
      clearInterval(this.titleAssertInterval);
      this.titleAssertInterval = null;
    }
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

    // Cache the rendered banner so titleAssertInterval can cheaply re-emit it
    // (without re-querying the DB) to keep winning the TTY against Claude.
    this.currentTitle = title;
    this.setTerminalTitle(title);
  }

  // ==========================================================================
  // Task Resolution Helpers (use current tracking db)
  // ==========================================================================

  /**
   * Lazily build (and cache) the DbSource for the global tracking database.
   *
   * Every project shares this single database, so resolving a task's owning
   * project from it needs no project knowledge. This is what lets the worker
   * resolve the project authoritatively from the task rather than trusting the
   * dispatch-queue slug.
   */
  private getGlobalSource(): DbSource {
    if (!this.globalSource) {
      this.globalSource = this.sourceProvider.getOrCreate({
        connectionString: `sqlite://${getGlobalDatabasePath()}`,
      });
    }
    return this.globalSource;
  }

  /**
   * Find a task by ID in the current tracking database
   */
  private async findTaskById(taskId: string): Promise<Task | null> {
    if (!this.currentSource || !this.state.currentProjectInfo) {
      return null;
    }

    try {
      const client = this.currentSource.createClient(this.state.currentProjectInfo.projectId);
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
    if (!this.currentSource || !this.state.currentProjectInfo) {
      return null;
    }

    try {
      const client = this.currentSource.createClient(this.state.currentProjectInfo.projectId);
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
    console.log(
      `Worker registered: ${this.state.workerName} (${this.state.workerId.slice(0, 8)}...)`
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

    // Stop the per-session timers (task watch + title re-assert)
    this.stopSessionTimers();

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
      if (this.isShuttingDown || this.state.status === "DRAINING" || this.isRestarting) {
        return;
      }

      // Don't overlap ticks: a tick whose async work (e.g. the availability
      // check between claiming a queue row and marking it WORKING) outruns the
      // poll interval must finish before the next one starts. Otherwise a
      // re-entrant tick could claim a second task or re-exec while a claim is
      // mid-flight (the queue row is already ours but currentTaskId isn't set).
      if (this.pollTickInFlight) {
        return;
      }
      this.pollTickInFlight = true;

      try {
        // Between tasks / while idle is the natural boundary to adopt a freshly
        // installed dfl build. If we restart here, the process is on its way
        // out — don't also try to claim a task.
        if (this.maybeRestartForUpgrade()) {
          return;
        }

        await this.tryClaimTask();
      } finally {
        this.pollTickInFlight = false;
      }
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

      // Enforce dependency readiness: skip tasks with unmet prerequisites.
      // The task remains in the tracking DB and will be auto-claimed once its
      // dependencies reach terminal state.
      if (!(await this.isClaimedTaskAvailable(claim.taskId))) {
        console.log(
          term.yellow(
            `Skipping task ${claim.taskId}: dependencies not yet satisfied. ` +
              `Removing from dispatch queue — will be auto-claimed when prerequisites complete.`
          )
        );
        this.queue.remove(claim.taskId);
        return;
      }

      // Stop polling while working
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }

      await this.workOnTask(claim.taskId, claim.projectSlug, "queue");
      return;
    }

    // Queue is empty — scan for READY tasks with satisfied dependencies
    await this.tryAutoClaimReadyTask();
  }

  /**
   * Check whether a queue-claimed task is actually ready to work on.
   *
   * A task is available when: its parent issue is open, its status is
   * BACKLOG or READY, and all dependsOn prerequisites are terminal
   * (COMPLETED or ABANDONED). Mirrors the check tryAutoClaimReadyTask uses.
   */
  private async isClaimedTaskAvailable(taskId: string): Promise<boolean> {
    try {
      // Resolve the owning project AUTHORITATIVELY from the task itself, never
      // from the dispatch-queue slug (which can be poisoned). This keeps the
      // availability gate consistent with workOnTask so a poisoned row is
      // judged against its TRUE owner instead of the wrong project.
      const projectInfo = await Effect.runPromise(
        resolveProjectInfoByTaskId(this.getGlobalSource(), this.projectsResolver, taskId)
      );
      if (!projectInfo) {
        return false;
      }
      const source = this.sourceProvider.getOrCreate(projectInfo.sourceInfo);
      const client = source.createClient(projectInfo.projectId);
      const taskDomainService = new TaskDomainService(client.tasks, client.plans, client.issues);
      return await Effect.runPromise(taskDomainService.isTaskAvailable(taskId));
    } catch (error) {
      // Fail safe: if availability cannot be determined, do not work the task
      console.error(term.red(`Could not check availability for task ${taskId}: ${error}`));
      return false;
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

        // Find READY tasks, ordered so higher-priority work is claimed first:
        // by inherited issue priority (CRITICAL→HIGH→MEDIUM→LOW) then oldest-first.
        const readyTasks = await Effect.runPromise(client.tasks.findMany({ status: "READY" }));
        const orderedTasks = await this.orderReadyTasksByPriority(client, readyTasks);

        for (const task of orderedTasks) {
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
   * Order READY candidates for auto-claim: by inherited issue priority
   * (CRITICAL→HIGH→MEDIUM→LOW) then oldest-first (createdAt ascending) as a
   * tiebreaker, so higher-priority work is claimed before lower-priority work.
   *
   * Tasks carry no priority of their own — priority is inherited from the
   * parent issue via task → plan → issue. Priority is resolved once per plan
   * and cached so tasks sharing a plan don't each re-fetch it. Tasks whose
   * issue can't be resolved fall back to LOW so they sort last but are still
   * considered.
   */
  private async orderReadyTasksByPriority(client: DbClient, tasks: Task[]): Promise<Task[]> {
    const priorityByPlanId = new Map<string, IssuePriority>();
    const resolvePriority = async (planId: string): Promise<IssuePriority> => {
      const cached = priorityByPlanId.get(planId);
      if (cached) return cached;

      const plan = await Effect.runPromise(client.plans.findById(planId));
      const issue = plan ? await Effect.runPromise(client.issues.findById(plan.issueId)) : null;
      if (!issue) {
        // A READY task whose plan/issue can't be resolved is an integrity
        // violation; surface it rather than silently deprioritizing to LOW.
        console.error(
          term.dim(`Could not resolve issue priority for plan ${planId}; defaulting to LOW`)
        );
      }
      const priority: IssuePriority = issue?.priority ?? "LOW";
      priorityByPlanId.set(planId, priority);
      return priority;
    };

    const ranked: Array<{ task: Task; priority: IssuePriority }> = [];
    for (const task of tasks) {
      ranked.push({ task, priority: await resolvePriority(task.planId) });
    }

    return ranked
      .sort((a, b) => {
        const byPriority = comparePriorityDesc(a.priority, b.priority);
        if (byPriority !== 0) return byPriority;
        return new Date(a.task.createdAt).getTime() - new Date(b.task.createdAt).getTime();
      })
      .map((entry) => entry.task);
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
    // Resolve the owning project AUTHORITATIVELY from the task itself, never
    // from the dispatch-queue slug (which can be the claiming worker's home
    // project, not the task's). The slug is kept only as a logging hint.
    let projectInfo: ProjectInfo | null;
    try {
      projectInfo = await Effect.runPromise(
        resolveProjectInfoByTaskId(this.getGlobalSource(), this.projectsResolver, taskId)
      );
    } catch (error) {
      console.error(
        `Failed to resolve project for task ${taskId} (queue slug: ${projectSlug})`,
        error
      );
      await this.releaseTask(taskId);
      return;
    }

    if (!projectInfo) {
      console.error(
        term.red(
          `Could not resolve owning project for task ${taskId} (queue slug: ${projectSlug}); ` +
            `task, issue, or project missing. Releasing.`
        )
      );
      await this.releaseTask(taskId);
      return;
    }

    // Connect to the RESOLVED project's tracking database.
    this.currentSource = this.sourceProvider.getOrCreate(projectInfo.sourceInfo);
    this.state.currentTaskId = taskId;
    this.state.currentProjectSlug = projectSlug;
    this.state.currentProjectInfo = projectInfo;
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

    // Begin capturing this session's lifecycle to a per-task log file. Use the
    // authoritatively-resolved owner slug (projectInfo.slug), not the queue hint.
    const sessionLog = new WorkerSessionLog({
      workerName: this.state.workerName,
      workerId: this.state.workerId,
      issueNumber,
      taskNumber,
    });
    sessionLog.claimed(claimSource, projectInfo.slug);
    this.state.currentSessionLog = sessionLog;

    console.log(`Working on task #${issueNumber}.${taskNumber}: ${task.title}${sourceLabel}`);
    console.log(`Project: ${projectInfo.slug} (${projectInfo.gitRoot})`);
    if (projectSlug !== projectInfo.slug) {
      console.log(
        term.yellow(
          `Note: dispatch-queue slug "${projectSlug}" differs from resolved owner "${projectInfo.slug}" — using resolved owner.`
        )
      );
      // Self-heal the poisoned queue row so its stored label stops lying.
      this.queue.updateProjectSlug(taskId, projectInfo.slug);
    }

    // Pre-create (or adopt) the task's worktree BEFORE spawning, so the Claude
    // session runs inside the worktree and load_task_session adopts it instead
    // of creating a second one. Bails out (releases) on failure.
    const worktreePath = await this.ensureWorktree(task, projectInfo, issueNumber);
    if (!worktreePath) {
      await this.releaseTask(taskId);
      return;
    }

    // Build the prompt for Claude (per-repo overrides resolved against the
    // task's owning project gitRoot).
    const prompt = this.buildClaudePrompt(taskId, issueNumber, taskNumber, projectInfo.gitRoot);

    // Spawn Claude process inside the task's worktree (not the main repo).
    await this.spawnClaudeSession(taskId, prompt, worktreePath, sessionLog);
  }

  /**
   * Ensure the task's git worktree exists and is persisted on the task.
   *
   * Reuses the SAME worktree-creation path as load_task_session
   * ({@link generateWorktreeNames} + {@link NodeGitWorktreeService.createWorktree}
   * against the project gitRoot, persisted via
   * {@link TaskDomainService.updateWorktreeInfo}). Persisting is what makes the
   * later load_task_session call ADOPT this worktree via its `if (!worktreePath)`
   * guard rather than create a second one.
   *
   * - Fresh task → compute names, create the worktree, persist path + branch.
   * - Re-claim/resume (task already has a worktreePath) → adopt it; only
   *   re-create if the directory is missing.
   *
   * @returns the absolute worktree path to use as the session cwd, or null on failure.
   */
  private async ensureWorktree(
    task: Task,
    projectInfo: ProjectInfo,
    issueNumber: number | string
  ): Promise<string | null> {
    // Guard against an unresolved issue number ("?" → Number("?") is NaN),
    // which would otherwise produce an `issue-NaN-task-N` worktree/branch.
    if (!Number.isInteger(Number(issueNumber))) {
      console.error(term.red(`Cannot resolve issue number for task ${task.id}; skipping worktree`));
      return null;
    }

    const worktreeService = new NodeGitWorktreeService(projectInfo.gitRoot);

    try {
      // Re-claim / resume: adopt the existing worktree unless its directory is gone.
      if (task.worktreePath) {
        if (existsSync(task.worktreePath)) {
          return task.worktreePath;
        }
        const branchName =
          task.branchName ??
          generateWorktreeNames(Number(issueNumber), task.number, task.title).branchName;
        const recreated = await Effect.runPromise(
          worktreeService.createWorktree(task.worktreePath, branchName)
        );
        await this.persistWorktreeInfo(projectInfo, task.id, recreated, branchName);
        return recreated;
      }

      // Fresh task: compute names exactly as load_task_session does (relative
      // path resolved against gitRoot), create, then persist.
      const names = generateWorktreeNames(Number(issueNumber), task.number, task.title);
      const createdPath = await Effect.runPromise(
        worktreeService.createWorktree(names.worktreePath, names.branchName)
      );
      await this.persistWorktreeInfo(projectInfo, task.id, createdPath, names.branchName);
      return createdPath;
    } catch (error) {
      console.error(term.red(`Failed to prepare worktree for task ${task.id}: ${error}`));
      return null;
    }
  }

  /**
   * Persist worktreePath/branchName on the task via the domain service — the
   * same call load_task_session uses — so the later session adopts this worktree.
   */
  private async persistWorktreeInfo(
    projectInfo: ProjectInfo,
    taskId: string,
    worktreePath: string,
    branchName: string
  ): Promise<void> {
    const source = this.sourceProvider.getOrCreate(projectInfo.sourceInfo);
    const client = source.createClient(projectInfo.projectId);
    const taskDomainService = new TaskDomainService(client.tasks, client.plans, client.issues);
    await Effect.runPromise(taskDomainService.updateWorktreeInfo(taskId, worktreePath, branchName));
  }

  /**
   * Build the prompt to pass to Claude.
   *
   * The prompt is operator-customizable: it resolves via {@link PromptResolver}
   * against a per-repo override (`<gitRoot>/.dfl/prompts/worker-task.md`), then a
   * shared override (`<DFL_HOME-or-~/.dfl>/prompts/worker-task.md`), falling back
   * to the embedded {@link WORKER_TASK_PROMPT_DEFAULT} when no override files exist.
   *
   * @param gitRoot owning project's git root for the per-repo override layer
   */
  private buildClaudePrompt(
    taskId: string,
    issueNumber: number | string,
    taskNumber: number | string,
    gitRoot: string
  ): string {
    return this.promptResolver.resolve(
      WORKER_TASK_PROMPT_NAME,
      WORKER_TASK_PROMPT_DEFAULT,
      {
        workerId: this.state.workerId,
        issueNumber,
        taskNumber,
        taskId,
      },
      gitRoot
    );
  }

  /**
   * Spawn a Claude session
   */
  private async spawnClaudeSession(
    taskId: string,
    prompt: string,
    cwd: string,
    sessionLog: WorkerSessionLog
  ): Promise<void> {
    console.log(term.dim(`\n--- Claude session starting ---\n`));
    console.log(`  logs: ${sessionLog.path}`);
    sessionLog.sessionStarted(cwd);

    return new Promise<void>((resolve) => {
      // Spawn Claude interactively with the prompt
      const claudeProcess = spawn("claude", [...this.config.claudeArgs, prompt], {
        cwd,
        stdio: "inherit",
        env: process.env,
      });

      this.state.currentClaudeProcess = claudeProcess;

      // Watch for task completion via claudeDone flag
      // Worker waits indefinitely until Claude calls end_worker_session
      let sessionEnded = false;

      // Competing-writer (issue #23): the spawned `claude` process inherits this
      // TTY (stdio: "inherit") and writes its OWN terminal title ("Execute Task
      // #N.N…"). We can't stop it from writing — so instead of backing off, the
      // worker WINS by re-asserting its banner on a tight cadence. Whatever Claude
      // paints is overwritten within titleAssertIntervalMs, so the worker's
      // `worker-N | …` banner is the one that persists on screen. The banner string
      // is cached (currentTitle, already painted once by workOnTask before spawn),
      // so this re-emit is a cheap stdout write with no DB query; the 2s watch loop
      // below refreshes the content (status segment).
      this.titleAssertInterval = setInterval(() => {
        if (this.currentTitle) this.setTerminalTitle(this.currentTitle);
      }, this.config.titleAssertIntervalMs);

      this.taskWatchInterval = setInterval(async () => {
        const task = await this.findTaskById(taskId);
        if (!task) {
          console.log(term.red("\nTask no longer exists, ending session..."));
          claudeProcess.kill("SIGTERM");
          return;
        }

        // Refresh the banner content (picks up status changes); titleAssertInterval
        // keeps re-emitting it between ticks so the worker keeps winning the TTY.
        await this.updateTitle();

        // Heartbeat the log so a stuck/blocked worker is visible from the file.
        sessionLog.progressTick(task.status);

        // Check for claudeDone flag from the dispatch queue
        const queueEntry = this.queue.findByTaskId(taskId);
        if (queueEntry?.claudeDone) {
          if (!sessionEnded) {
            sessionEnded = true;

            // Stop the session timers (task watch + title re-assert)
            this.stopSessionTimers();

            sessionLog.signaledComplete();
            console.log(term.green("\n✓ Claude signaled session complete via end_worker_session"));
            this.terminateSession(claudeProcess, task.status);
          }
        }
      }, 2000);

      claudeProcess.on("exit", async (code: number | null) => {
        // Stop the session timers if still running
        this.stopSessionTimers();

        console.log("\n" + term.cyan("═".repeat(60)));
        console.log(term.dim(`Claude session ended (exit code: ${code})`));
        console.log(term.cyan("═".repeat(60)) + "\n");

        this.state.currentClaudeProcess = null;
        sessionLog.sessionEnded(code);

        // Release the task from the queue (also flushes + closes the session log)
        await this.releaseTask(taskId);

        resolve();
      });

      claudeProcess.on("error", async (error: Error) => {
        console.error(term.red("Failed to spawn Claude process:"), error);
        this.state.currentClaudeProcess = null;
        sessionLog.errored(error);

        this.stopSessionTimers();

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

    // Reset state. Flush + close the session log here so EVERY release path
    // (normal exit, spawn error, AND early bail-outs that constructed the log
    // but never spawned — e.g. ensureWorktree returning null) tears the stream
    // down in one place rather than relying on each caller to remember.
    this.state.currentTaskId = null;
    this.state.currentProjectSlug = null;
    this.state.currentProjectInfo = null;
    if (this.state.currentSessionLog) {
      await this.state.currentSessionLog.close();
      this.state.currentSessionLog = null;
    }
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

  // ==========================================================================
  // Self-restart on dfl upgrade
  // ==========================================================================

  /**
   * At a natural boundary (idle, between tasks), check whether the dfl bundle
   * installed on disk is a different version than the one this worker is running
   * and, if so, re-exec into it. Returns true when a restart was triggered so
   * the poll loop knows to stop (the process is on its way out). Never restarts
   * mid-task: the poll loop only runs while idle, and this re-checks defensively.
   */
  private maybeRestartForUpgrade(): boolean {
    // #42: self-restart is DISABLED by default. Node has no execve, so reExec()
    // spawns a replacement child and exits the parent — which orphans the new
    // worker (it is no longer the terminal's foreground process). Its interactive
    // `claude` sessions then hit EOF on the TTY and instant-exit, spinning the
    // worker in an infinite claim -> exit -> reclaim loop. Re-enable only behind a
    // TTY-safe relauncher (the supervisor, #37); opt in with DFL_WORKER_SELF_RESTART=1.
    if (process.env["DFL_WORKER_SELF_RESTART"] !== "1") {
      return false;
    }
    if (this.isShuttingDown || this.state.status === "DRAINING" || this.state.currentTaskId) {
      return false;
    }
    const upgrade = this.upgradeDetector.detectUpgrade();
    if (!upgrade) {
      return false;
    }
    console.log(
      term.yellow(
        `\ndfl updated on disk (${upgrade.from} → ${upgrade.to}); restarting worker into the new build...`
      )
    );
    // Latch so no further poll activity (claim or another restart) runs before
    // the process exits; cleared only if the spawn fails (see reExec).
    this.isRestarting = true;
    this.reExec();
    return true;
  }

  /**
   * Re-exec this worker into the freshly-installed dfl bundle, preserving the
   * worker name and forwarded claude args. We only reach here while idle (the
   * poll-tick guards ensure no task — and no in-flight claim — is live), so the
   * new process registers fresh and resumes polling; any queue entry left
   * behind is recovered by the existing stale-reclaim path.
   *
   * Node has no execve, so we spawn the replacement sharing this terminal and
   * exit once it's up. If the spawn fails we clear the restart latch and stay
   * on the current build rather than leaving the worker dead.
   */
  private reExec(): void {
    const args = buildReExecArgs(
      this.upgradeDetector.installedBundlePath,
      this.state.workerName,
      this.config.claudeArgs
    );
    console.log(term.dim(`Re-exec: ${process.execPath} ${args.join(" ")}`));

    const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });

    // Node has no execve, so the replacement is a child that must actually come
    // up before we exit. `spawn()` succeeding (the "spawn" event) only means the
    // process started — a bad re-exec arg makes it die immediately afterward, so
    // exiting on "spawn" alone would leave the worker dead. Instead we hand the
    // terminal over only after the child survives a short grace window; an exit
    // (or error) within it aborts the handoff and keeps us on the current build.
    let handoffTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const stayOnCurrentBuild = (reason: string): void => {
      if (settled) return;
      settled = true;
      if (handoffTimer) {
        clearTimeout(handoffTimer);
        handoffTimer = null;
      }
      // Release the latch so the still-running poll loop resumes.
      this.isRestarting = false;
      console.error(term.red(`${reason} Staying on current build.`));
    };

    child.once("spawn", () => {
      handoffTimer = setTimeout(() => {
        // A stay-alive path always clears this timer, so reaching here means the
        // child survived the grace window. The guard makes that invariant
        // explicit and defends against any future path that settles otherwise.
        if (settled) return;
        handoffTimer = null;
        settled = true;
        // The new worker survived startup and owns the terminal — tear down this
        // process so it takes over cleanly.
        this.clearTimers();
        this.queue.unregisterWorker(this.state.workerId);
        process.exit(0);
      }, REEXEC_HANDOFF_GRACE_MS);
    });

    child.once("exit", (code, signal) => {
      // The replacement died before the grace window elapsed — the re-exec
      // failed (e.g. `unknown option`). If the window already elapsed we'd have
      // exited above, so reaching here is always an early/failed handoff.
      const how = code !== null ? `exited (code ${code})` : `was killed (signal ${signal})`;
      stayOnCurrentBuild(`Re-exec child ${how} during startup.`);
    });

    child.once("error", (error: Error) => {
      stayOnCurrentBuild(`Failed to re-exec into the new dfl build: ${error}.`);
    });
  }

  /** Clear all background intervals (poll, heartbeat, task-watch, title-assert) if running. */
  private clearTimers(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.taskWatchInterval) {
      clearInterval(this.taskWatchInterval);
      this.taskWatchInterval = null;
    }
    if (this.titleAssertInterval) {
      clearInterval(this.titleAssertInterval);
      this.titleAssertInterval = null;
    }
  }
}
