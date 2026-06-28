/**
 * WorkerSessionLog — a per-task, on-disk record of a worker's Claude session lifecycle.
 *
 * Workers spawn their Claude session with stdio:"inherit", so the transcript is
 * never persisted and there's no way to tell — after the fact or from another
 * session — whether a worker is progressing, blocked, or stuck. This object owns
 * a single session's append-only log file: naming, the write stream, retention,
 * and discovery. It captures the WORKER's lifecycle/progress events (claim,
 * start, heartbeat ticks, completion, exit, errors) — it does NOT replace or pipe
 * the child's stdio.
 *
 * Storage mirrors the on-disk-artifact pattern in port-manager.ts: paths resolve
 * per-call via resolveGlobalTrackDir() so they honor DFL_HOME, and directories are
 * created at write time. Logs live under <DFL_HOME-or-~/.dfl>/track/worker-logs/.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveGlobalTrackDir } from "@dev-workflow/git/track-directory-resolver.js";

/** How a task was claimed — mirrors ClaimSource on the worker service. */
type ClaimSource = "queue" | "auto-claim";

export interface WorkerSessionLogInit {
  workerName: string;
  workerId: string;
  /** Issue number; may be the string "?" when unresolved (sanitized into the filename). */
  issueNumber: number | string;
  /** Task number; may be the string "?" when unresolved (sanitized into the filename). */
  taskNumber: number | string;
}

/** Number of most-recent logs retained per worker name; older ones are pruned. */
const RETENTION = 5;

/**
 * The worker-logs directory under the dfl home. Resolved per-call so it honors
 * DFL_HOME, exactly like port-manager.ts's pidFile().
 */
export function workerLogsDir(): string {
  return path.join(resolveGlobalTrackDir(), "worker-logs");
}

/**
 * Sanitize a path/filename segment so it's filesystem- and glob-safe.
 * Notably maps the "?" fallback (used when an issue/task number can't be
 * resolved) to a literal, since "?" is a shell glob metacharacter.
 */
function safeSegment(value: number | string): string {
  const cleaned = String(value)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned === "" ? "unknown" : cleaned;
}

/** Basic-ISO UTC timestamp with separators stripped, e.g. 20260628T123456789Z. */
function timestampToken(date: Date): string {
  return date.toISOString().replace(/[:.-]/g, "");
}

export class WorkerSessionLog {
  private readonly filePath: string;
  private readonly stream: fs.WriteStream;

  constructor(init: WorkerSessionLogInit) {
    const dir = workerLogsDir();
    fs.mkdirSync(dir, { recursive: true });

    // Prune to the most recent RETENTION logs for THIS worker name BEFORE
    // opening, so the new file is never counted against the cap.
    this.pruneForWorker(dir, init.workerName);

    const fileName =
      `${safeSegment(init.workerName)}__` +
      `issue-${safeSegment(init.issueNumber)}-task-${safeSegment(init.taskNumber)}__` +
      `${timestampToken(new Date())}__` +
      `${init.workerId.slice(0, 8)}.log`;

    this.filePath = path.join(dir, fileName);
    this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
    // Logging is best-effort: a write/open failure must never crash the worker.
    this.stream.on("error", () => {});
  }

  /** Absolute path to this session's log file. */
  get path(): string {
    return this.filePath;
  }

  claimed(source: ClaimSource, projectSlug: string): void {
    this.write(`claimed (${source}) project=${projectSlug}`);
  }

  sessionStarted(cwd: string): void {
    this.write(`session started cwd=${cwd}`);
  }

  progressTick(taskStatus: string): void {
    this.write(`tick status=${taskStatus}`);
  }

  signaledComplete(): void {
    this.write("claude signaled session complete (end_worker_session)");
  }

  sessionEnded(code: number | null): void {
    this.write(`session ended exit=${code}`);
  }

  errored(err: Error): void {
    this.write(`error ${err.message}`);
  }

  /** Flush and close the stream. Resolves once the file is fully written. */
  close(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.stream.end(() => resolve());
    });
  }

  /** Append one timestamped line. */
  private write(message: string): void {
    this.stream.write(`${new Date().toISOString()} ${message}\n`);
  }

  /**
   * Delete logs for `workerName` beyond the RETENTION most-recent (by mtime).
   * Tolerates a missing directory and races where a file vanishes mid-prune.
   */
  private pruneForWorker(dir: string, workerName: string): void {
    const prefix = `${safeSegment(workerName)}__`;
    let entries: { path: string; mtime: number }[];
    try {
      entries = fs
        .readdirSync(dir)
        .filter((name) => name.startsWith(prefix) && name.endsWith(".log"))
        .map((name) => {
          const full = path.join(dir, name);
          return { path: full, mtime: fs.statSync(full).mtimeMs };
        });
    } catch {
      return;
    }

    entries.sort((a, b) => b.mtime - a.mtime);
    for (const stale of entries.slice(RETENTION - 1)) {
      try {
        fs.unlinkSync(stale.path);
      } catch {
        // ignore if already gone
      }
    }
  }
}

/**
 * List worker session logs, newest first. Optionally filter to a worker name.
 * Returns an empty list if the directory doesn't exist yet.
 */
export function listWorkerLogs(
  workerName?: string
): { path: string; workerName: string; mtime: Date }[] {
  const dir = workerLogsDir();
  const prefix = workerName ? `${safeSegment(workerName)}__` : "";

  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  return names
    .filter((name) => name.endsWith(".log") && name.startsWith(prefix))
    .map((name) => {
      const full = path.join(dir, name);
      return {
        path: full,
        workerName: name.split("__")[0] ?? "",
        mtime: fs.statSync(full).mtime,
      };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/** Path to the most-recent log (optionally for a worker name), or null if none. */
export function latestLogPath(workerName?: string): string | null {
  return listWorkerLogs(workerName)[0]?.path ?? null;
}
