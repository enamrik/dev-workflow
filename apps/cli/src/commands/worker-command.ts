/**
 * WorkerCommand - Manage Claude workers and dispatch queue
 *
 * Handles listing workers and starting new worker processes.
 * Receives all dependencies via constructor injection.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { GlobalDbWorkerQueueDb } from "@dev-workflow/local-workers/local-worker-queue-db.js";
import { DbSourceProvider, ProjectsResolver } from "@dev-workflow/tracking";
import { ClaudeWorkerService } from "../application/claude-worker.service.js";
import { WorkerSupervisor, type WorkerRunEnvelope } from "../application/worker-supervisor.js";
import {
  listWorkerLogs,
  latestLogPath,
  workerLogsDir,
} from "@dev-workflow/git/worker-session-log.js";

export interface StartWorkerOptions {
  name?: string;
  /** Stable worker identity supplied by the supervisor so a relaunched child resumes its own claim (#47). Minted by the child when absent. */
  workerId?: string;
  claudeArgs?: string[];
  /** Running dfl build version (the `__DFL_VERSION__` define) — used to detect installed-version drift and self-restart. */
  runningVersion?: string;
}

export interface WorkerLogsOptions {
  name?: string;
  tail?: boolean;
}

export class WorkerCommand {
  constructor(
    private readonly workerQueueDb: GlobalDbWorkerQueueDb,
    private readonly sourceProvider: DbSourceProvider,
    private readonly projectsResolver: ProjectsResolver
  ) {}

  /**
   * List registered workers and dispatch queue (for debugging).
   */
  async list(): Promise<void> {
    try {
      // Get workers with health info
      const workers = this.workerQueueDb.findAllWorkersWithHealth();

      // Get queue stats
      const queueStats = this.workerQueueDb.getQueueStats();

      // Get queue entries for details
      const queueEntries = this.workerQueueDb.findAllEntriesWithHealth();

      console.log("Workers:");
      console.log("========\n");

      if (workers.length === 0) {
        console.log("  No workers registered.\n");
      } else {
        for (const worker of workers) {
          const status = worker.isAlive ? "✓" : "✗";
          const statusText = worker.isAlive ? "alive" : "dead";
          const taskInfo = worker.currentTaskId
            ? `| task: ${worker.currentTaskId.slice(0, 8)}...`
            : "";

          console.log(
            `  ${status} ${worker.name} (${worker.status}) - ${statusText}, ${worker.heartbeatAge}s ago ${taskInfo}`
          );
        }
        console.log();
      }

      console.log("Dispatch Queue:");
      console.log("===============\n");

      console.log(
        `  Total: ${queueStats.total}, Unclaimed: ${queueStats.unclaimed}, Claimed: ${queueStats.claimed}, Stale: ${queueStats.stale}\n`
      );

      if (queueEntries.length > 0) {
        console.log("  Entries:");
        for (const entry of queueEntries) {
          const staleMarker = entry.isStale ? " [STALE]" : "";
          const workerInfo = entry.workerName ? `claimed by ${entry.workerName}` : "unclaimed";
          console.log(`    - ${entry.taskId.slice(0, 8)}... (${workerInfo})${staleMarker}`);
        }
      }
    } catch (error) {
      console.error("Error listing workers:", error);
      process.exit(1);
    }
  }

  /**
   * Run as a Claude worker that polls for and executes dispatched tasks.
   */
  async start(options: StartWorkerOptions = {}): Promise<void> {
    try {
      const worker = new ClaudeWorkerService(
        this.workerQueueDb,
        this.sourceProvider,
        this.projectsResolver,
        {
          name: options.name,
          workerId: options.workerId,
          claudeArgs: options.claudeArgs ?? [],
          runningVersion: options.runningVersion,
        }
      );

      await worker.start();
    } catch (error) {
      console.error("Error running Claude worker:", error);
      process.exit(1);
    }
  }

  /**
   * Run as the long-lived worker SUPERVISOR (`dfl claude`).
   *
   * The supervisor owns the terminal foreground and spawns the worker loop as a
   * replaceable child (the hidden `__worker-run` verb), relaunching it per the
   * exit-code protocol. start() (above) is the child that does the actual work;
   * this method never runs that loop in-process.
   */
  async supervise(options: StartWorkerOptions = {}): Promise<void> {
    // Mint the worker identity ONCE here (not in the supervisor loop, which
    // stays DB-free) and thread it through the envelope to every relaunch.
    // Reusing the SAME id + name lets a relaunched child resume its own
    // in-flight claim instead of minting a fresh UUID (#47).
    const workerId = randomUUID();
    const name = options.name ?? this.workerQueueDb.getNextWorkerName();
    const envelope: WorkerRunEnvelope = {
      workerId,
      name,
      claudeArgs: options.claudeArgs ?? [],
      runningVersion: options.runningVersion ?? "0.0.0-dev",
    };
    const code = await new WorkerSupervisor().run(envelope);
    if (code !== 0) {
      process.exit(code);
    }
  }

  /**
   * Locate (and optionally tail) per-task worker session logs.
   *
   * Lists the captured session logs newest-first so a stuck/blocked worker can
   * be diagnosed without having watched it live. With `--tail`, follows the
   * latest log via `tail -f` (read-only, portable, no extra dependency).
   */
  async logs(options: WorkerLogsOptions = {}): Promise<void> {
    if (options.tail) {
      const latest = latestLogPath(options.name);
      if (!latest) {
        console.log(`No worker logs found in ${workerLogsDir()}`);
        return;
      }
      await new Promise<void>((resolve) => {
        const child = spawn("tail", ["-f", latest], { stdio: "inherit" });
        child.on("exit", () => resolve());
        child.on("error", (error) => {
          console.error("Failed to tail log:", error);
          resolve();
        });
      });
      return;
    }

    const logs = listWorkerLogs(options.name);
    if (logs.length === 0) {
      console.log(`No worker logs found in ${workerLogsDir()}`);
      return;
    }

    console.log(`Worker session logs (newest first) in ${workerLogsDir()}:\n`);
    for (const log of logs) {
      console.log(`  ${log.mtime.toISOString()}  ${log.path}`);
    }
  }
}
