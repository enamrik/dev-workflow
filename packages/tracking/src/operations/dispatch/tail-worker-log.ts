/**
 * tailWorkerLog - Return the tail of a worker's session log
 *
 * Lets an orchestrating Claude session see what a worker is doing (and whether
 * it's stuck) without shell/filesystem access. Resolves the latest matching log
 * under <DFL_HOME>/worker-logs via the SAME helpers the `dfl worker:logs` CLI
 * uses (listWorkerLogs/latestLogPath), so there's a single source of truth for
 * how the latest log is chosen.
 *
 * Selection: by workerName, workerId, or taskId. With none of them, falls back
 * to the most-recent log across all workers. Always returns a graceful result
 * (found:false + message) rather than failing when nothing can be resolved.
 */

import { z } from "zod";
import { WorkerQueueDbTag } from "@dev-workflow/dispatch/worker-queue-db.js";
import { latestLogPath, tailLogFile, workerLogsDir } from "@dev-workflow/git/worker-session-log.js";
import { Effect } from "@dev-workflow/effect";
import { validateInput } from "../validation.js";

// =============================================================================
// Schema & Types
// =============================================================================

/** Default number of trailing lines returned when the caller omits `lines`. */
export const DEFAULT_TAIL_LINES = 50;
/** Hard cap on lines so a response can never be unbounded. */
export const MAX_TAIL_LINES = 2000;

export const TailWorkerLogSchema = z.object({
  workerId: z.string().min(1).optional(),
  workerName: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  lines: z.number().int().positive().max(MAX_TAIL_LINES).optional(),
});
export type TailWorkerLogInput = z.infer<typeof TailWorkerLogSchema>;

export interface TailWorkerLogResult {
  found: boolean;
  /** The worker name the log was resolved for (null when unresolved/unfiltered). */
  workerName: string | null;
  /** Absolute path to the resolved log file, or null when none was found. */
  path: string | null;
  /** Number of lines returned in `content`. */
  lines: number;
  /** Total number of lines in the resolved file. */
  totalLines: number;
  /** The trailing log content (lines joined by "\n"). Empty when not found. */
  content: string;
  /** The directory logs live in — useful context when nothing was found. */
  logsDir: string;
  /** Present when found:false, explaining why. */
  message?: string;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Tail a worker's session log.
 *
 * 1. Validate input and clamp `lines` to [1, MAX_TAIL_LINES] (default 50).
 * 2. Resolve a worker name from workerName | workerId | taskId (see below).
 * 3. Resolve the latest matching log file (shared with the CLI).
 * 4. Read the trailing lines, or return a graceful "not found" result.
 */
export function tailWorkerLog(input: TailWorkerLogInput) {
  return Effect.gen(function* () {
    const { workerId, workerName, taskId, lines } = validateInput(TailWorkerLogSchema, input);
    const requestedLines = lines ?? DEFAULT_TAIL_LINES;
    const logsDir = workerLogsDir();

    const notFound = (resolvedName: string | null, message: string): TailWorkerLogResult => ({
      found: false,
      workerName: resolvedName,
      path: null,
      lines: 0,
      totalLines: 0,
      content: "",
      logsDir,
      message,
    });

    const workerQueueDb = yield* WorkerQueueDbTag;

    // 1. Resolve which worker's logs to look at.
    let resolvedName: string | null = workerName ?? null;

    if (resolvedName === null && workerId) {
      const worker = workerQueueDb.findWorkerById(workerId);
      if (!worker) {
        return notFound(null, `No worker found with id "${workerId}".`);
      }
      resolvedName = worker.name;
    }

    if (resolvedName === null && taskId) {
      const entry = workerQueueDb.findByTaskId(taskId);
      if (!entry) {
        return notFound(null, `No dispatch queue entry found for task "${taskId}".`);
      }
      if (!entry.workerId) {
        return notFound(null, `Task "${taskId}" has not been claimed by a worker yet.`);
      }
      const worker = workerQueueDb.findWorkerById(entry.workerId);
      if (!worker) {
        return notFound(
          null,
          `Task "${taskId}" was claimed by worker "${entry.workerId}", which is no longer registered.`
        );
      }
      resolvedName = worker.name;
    }

    // 2. Resolve the latest matching log file (single source of truth with the CLI).
    //    A null resolvedName means "most recent log across all workers".
    const filePath = latestLogPath(resolvedName ?? undefined);
    if (!filePath) {
      const scope = resolvedName ? ` for worker "${resolvedName}"` : "";
      return notFound(resolvedName, `No worker session log found${scope} in ${logsDir}.`);
    }

    // 3. Read the tail.
    const tail = tailLogFile(filePath, requestedLines);
    return {
      found: true,
      workerName: resolvedName,
      path: filePath,
      lines: tail.lines.length,
      totalLines: tail.totalLines,
      content: tail.lines.join("\n"),
      logsDir,
    } satisfies TailWorkerLogResult;
  });
}
