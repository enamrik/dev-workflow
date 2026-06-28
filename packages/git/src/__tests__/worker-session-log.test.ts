/**
 * WorkerSessionLog — filename scheme, DFL_HOME honoring, retention, discovery.
 *
 * Logs live under <DFL_HOME>/worker-logs (resolveGlobalTrackDir() returns
 * $DFL_HOME directly when set). Tests point DFL_HOME at a temp dir so they
 * never touch real ~/.dfl.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  WorkerSessionLog,
  workerLogsDir,
  listWorkerLogs,
  latestLogPath,
  tailLogFile,
} from "../worker-session-log.js";

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env["DFL_HOME"];
  home = mkdtempSync(path.join(tmpdir(), "dfl-worker-log-"));
  process.env["DFL_HOME"] = home;
});

afterEach(() => {
  if (prevHome === undefined) {
    delete process.env["DFL_HOME"];
  } else {
    process.env["DFL_HOME"] = prevHome;
  }
  rmSync(home, { recursive: true, force: true });
});

/** Create N log files for a worker with strictly increasing mtimes. */
function seedLogs(workerName: string, count: number): string[] {
  const dir = workerLogsDir();
  mkdirSync(dir, { recursive: true });
  const created: string[] = [];
  for (let i = 0; i < count; i++) {
    const file = path.join(
      dir,
      `${workerName}__issue-1-task-${i}__20260628T0000${i}0Z__abcd1234.log`
    );
    writeFileSync(file, "");
    // Spread mtimes 1s apart, oldest first.
    const t = new Date(2026, 0, 1, 0, 0, i);
    utimesSync(file, t, t);
    created.push(file);
  }
  return created;
}

describe("WorkerSessionLog", () => {
  it("honors DFL_HOME and creates the log under <DFL_HOME>/worker-logs", () => {
    const log = new WorkerSessionLog({
      workerName: "worker-1",
      workerId: "0123456789abcdef",
      issueNumber: 11,
      taskNumber: 2,
    });

    expect(workerLogsDir()).toBe(path.join(home, "worker-logs"));
    expect(log.path.startsWith(path.join(home, "worker-logs"))).toBe(true);
    void log.close();
  });

  it("uses a discoverable filename scheme (worker, issue, task, workerId8)", () => {
    const log = new WorkerSessionLog({
      workerName: "worker-1",
      workerId: "0123456789abcdef",
      issueNumber: 11,
      taskNumber: 2,
    });

    const name = path.basename(log.path);
    expect(name).toMatch(/^worker-1__issue-11-task-2__\d{8}T\d+Z__01234567\.log$/);
    void log.close();
  });

  it("sanitizes unresolved '?' issue/task numbers into glob-safe segments", () => {
    const log = new WorkerSessionLog({
      workerName: "worker-1",
      workerId: "0123456789abcdef",
      issueNumber: "?",
      taskNumber: "?",
    });

    const name = path.basename(log.path);
    expect(name).not.toContain("?");
    expect(name).toMatch(/^worker-1__issue-unknown-task-unknown__/);
    void log.close();
  });

  it("prunes to the most recent 5 for THIS worker name (by mtime)", async () => {
    // Seed 6 existing logs (indices 0..5, mtime increasing). Opening a new log
    // prunes (synchronously) BEFORE opening, keeping RETENTION-1 == 4 existing
    // so that with the new file the total is 5.
    const existing = seedLogs("worker-1", 6);

    const log = new WorkerSessionLog({
      workerName: "worker-1",
      workerId: "0123456789abcdef",
      issueNumber: 99,
      taskNumber: 9,
    });
    log.sessionStarted("/tmp/x");
    await log.close(); // flush so the new file lands on disk before we read

    const remaining = readdirSync(workerLogsDir());
    expect(remaining.length).toBe(5);
    // Oldest two (indices 0 and 1) pruned; 4 newest existing kept.
    expect(remaining).not.toContain(path.basename(existing[0]!));
    expect(remaining).not.toContain(path.basename(existing[1]!));
    expect(remaining).toContain(path.basename(existing[5]!));
    expect(remaining).toContain(path.basename(log.path));
  });

  it("prunes per worker name without touching other workers' logs", () => {
    seedLogs("worker-1", 6);
    const other = seedLogs("worker-2", 2);

    const log = new WorkerSessionLog({
      workerName: "worker-1",
      workerId: "0123456789abcdef",
      issueNumber: 1,
      taskNumber: 1,
    });

    const remaining = readdirSync(workerLogsDir());
    // worker-2's two logs are untouched.
    expect(remaining).toContain(path.basename(other[0]!));
    expect(remaining).toContain(path.basename(other[1]!));
    void log.close();
  });
});

describe("listWorkerLogs / latestLogPath", () => {
  it("returns [] when the directory does not exist", () => {
    expect(listWorkerLogs()).toEqual([]);
    expect(latestLogPath()).toBeNull();
  });

  it("lists logs newest first across workers", () => {
    seedLogs("worker-1", 2); // mtimes index 0,1
    const w2 = seedLogs("worker-2", 1); // mtime index 0 (older than worker-1 index 1)

    const all = listWorkerLogs();
    expect(all.length).toBe(3);
    // Newest first: worker-1 index 1 (mtime 0:0:1) is the most recent.
    expect(all[0]!.mtime.getTime()).toBeGreaterThanOrEqual(all[1]!.mtime.getTime());
    expect(all[1]!.mtime.getTime()).toBeGreaterThanOrEqual(all[2]!.mtime.getTime());
    expect(all.map((l) => l.path)).toContain(w2[0]!);
  });

  it("filters by worker name and parses workerName from the filename", () => {
    seedLogs("worker-1", 3);
    seedLogs("worker-2", 2);

    const onlyW1 = listWorkerLogs("worker-1");
    expect(onlyW1.length).toBe(3);
    expect(onlyW1.every((l) => l.workerName === "worker-1")).toBe(true);

    expect(latestLogPath("worker-2")).toContain("worker-2__");
  });
});

describe("tailLogFile", () => {
  it("returns a graceful empty tail when the file does not exist", () => {
    const tail = tailLogFile(path.join(home, "does-not-exist.log"), 50);
    expect(tail.lines).toEqual([]);
    expect(tail.totalLines).toBe(0);
  });

  it("returns the last N lines without counting the trailing newline", () => {
    const file = path.join(home, "sample.log");
    // Append-only logs always end with a newline (see write()).
    writeFileSync(file, "a\nb\nc\nd\n");

    const tail = tailLogFile(file, 2);
    expect(tail.lines).toEqual(["c", "d"]);
    expect(tail.totalLines).toBe(4);
  });

  it("returns all lines when N exceeds the file length", () => {
    const file = path.join(home, "short.log");
    writeFileSync(file, "only\n");

    const tail = tailLogFile(file, 50);
    expect(tail.lines).toEqual(["only"]);
    expect(tail.totalLines).toBe(1);
  });
});
