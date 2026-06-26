/**
 * WorkerCommand - Manage Claude workers and dispatch queue
 *
 * Handles listing workers and starting new worker processes.
 * Receives all dependencies via constructor injection.
 */

import { GlobalDbWorkerQueueDb } from "@dev-workflow/local-workers/local-worker-queue-db.js";
import { DbSourceProvider, ProjectsResolver } from "@dev-workflow/tracking";
import { ClaudeWorkerService } from "../application/claude-worker.service.js";

export interface StartWorkerOptions {
  name?: string;
  claudeArgs?: string[];
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
          claudeArgs: options.claudeArgs ?? [],
        }
      );

      await worker.start();
    } catch (error) {
      console.error("Error running Claude worker:", error);
      process.exit(1);
    }
  }
}
