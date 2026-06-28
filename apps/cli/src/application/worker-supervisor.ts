/**
 * Worker Supervisor
 *
 * A thin, long-lived parent process that owns the terminal foreground and
 * spawns the existing worker poll/claim/work loop as a REPLACEABLE child
 * subprocess (via the hidden `dfl __worker-run` verb). The child inherits the
 * TTY (stdio: "inherit") so interactive `claude` sessions work; it signals
 * intent back to the supervisor through its exit code, which the supervisor
 * interprets to decide whether to return, relaunch, or back off.
 *
 * Stage 1 scope: replaceable child + exit-code protocol + crash backoff. The
 * seam (injected spawn/sleep, the exit-code enum with reserved 10/11 values,
 * the run envelope) is designed so persisted identity (#47), self-restart
 * (#48), control channel, and version-watch layer on later without reshaping
 * this loop.
 */

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

// ============================================================================
// Exit-code protocol
// ============================================================================

/**
 * Exit codes the child worker uses to signal intent to the supervisor.
 *
 * 0/1 are emitted today (clean exit / crash). 10 and 11 are RESERVED for later
 * stages (self-restart-for-upgrade, operator stop) — defined now so the
 * protocol and the supervisor's interpretation are stable, but the child does
 * not emit them in stage 1.
 */
export enum WorkerExitCode {
  CLEAN_EXIT = 0,
  CRASH = 1,
  RESTART_FOR_UPGRADE = 10,
  STOP = 11,
}

/**
 * Everything the supervisor needs to (re)launch a child worker. Constructed
 * once from the CLI options and reused for every relaunch in the loop.
 */
export interface WorkerRunEnvelope {
  name?: string;
  claudeArgs: string[];
  runningVersion: string;
}

/**
 * How the supervisor should react to a child's exit.
 */
export type ExitDisposition = "exit-clean" | "stop" | "relaunch" | "relaunch-backoff";

// ============================================================================
// Tuning
// ============================================================================

/** Max relaunches allowed inside RESTART_WINDOW_MS before the supervisor gives up. */
const MAX_RESTARTS = 5;
/** Sliding window (ms) over which crash relaunches are counted for give-up. */
const RESTART_WINDOW_MS = 60_000;
/** Backoff cap (ms) — exponential backoff never sleeps longer than this. */
const MAX_BACKOFF_MS = 30_000;

// ============================================================================
// Pure helpers
// ============================================================================

/**
 * Build the argv (after `process.execPath`) for spawning the child worker via
 * the hidden `__worker-run` verb.
 *
 * `scriptPath` MUST come first — it's the dfl CLI bundle (the running
 * `process.argv[1]`), so the child launches as `node <scriptPath> __worker-run …`
 * (mirrors buildReExecArgs prepending the bundle path). Without it the child
 * would be `node __worker-run …`, which Node reads as a script filename →
 * MODULE_NOT_FOUND, and the worker never runs.
 *
 * The trailing `--` fence is LOAD-BEARING (mirrors buildReExecArgs in
 * claude-worker.service.ts): the passthrough `claudeArgs` — everything the user
 * put after `--` on the original `dfl claude` invocation (e.g. `--model`,
 * `--dangerously-skip-permissions`) — must be fenced behind their own `--` so
 * the child's commander forwards them to the inner `claude` process instead of
 * parsing them as its own options (which fails with `unknown option`). Empty
 * `claudeArgs` → no trailing separator.
 */
export function buildWorkerRunArgs(scriptPath: string, envelope: WorkerRunEnvelope): string[] {
  return [
    scriptPath,
    "__worker-run",
    ...(envelope.name ? ["--name", envelope.name] : []),
    "--running-version",
    envelope.runningVersion,
    ...(envelope.claudeArgs.length > 0 ? ["--", ...envelope.claudeArgs] : []),
  ];
}

/**
 * Interpret a child's exit (code + signal) into a supervisor disposition.
 *
 * Pure — no side effects — so it is exhaustively table-testable.
 *
 * - Killed by signal (SIGINT/SIGTERM, user Ctrl-C) → clean exit (the child
 *   drained and observed the signal we forwarded; nothing to relaunch).
 * - Code 0 → clean exit (matches today's Ctrl-C UX; the child never idle-exits yet).
 * - Code STOP(11) → operator stop (reserved; return success, don't relaunch).
 * - Code RESTART_FOR_UPGRADE(10) → relaunch immediately, no backoff.
 * - Any other / nonzero code → crash; relaunch with backoff.
 */
export function interpretExit(code: number | null, signal: NodeJS.Signals | null): ExitDisposition {
  if (signal !== null) {
    return "exit-clean";
  }
  switch (code) {
    case WorkerExitCode.CLEAN_EXIT:
      return "exit-clean";
    case WorkerExitCode.STOP:
      return "stop";
    case WorkerExitCode.RESTART_FOR_UPGRADE:
      return "relaunch";
    default:
      return "relaunch-backoff";
  }
}

// ============================================================================
// Injected collaborators
// ============================================================================

/** Spawns the child worker. Injectable so tests don't fork real processes. */
export type SpawnFn = (command: string, args: string[]) => ChildProcess;

/** Sleeps for `ms`. Injectable so tests don't wait on real timers. */
export type SleepFn = (ms: number) => Promise<void>;

const defaultSpawn: SpawnFn = (command, args) =>
  nodeSpawn(command, args, { stdio: "inherit", env: process.env });

const defaultSleep: SleepFn = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ============================================================================
// Supervisor
// ============================================================================

/**
 * Long-lived parent that keeps a single child worker alive, replacing it
 * according to the exit-code protocol.
 */
export class WorkerSupervisor {
  /** Relaunch timestamps (ms epoch) within the sliding window, for give-up detection. */
  private restartTimestamps: number[] = [];

  constructor(
    private readonly spawnFn: SpawnFn = defaultSpawn,
    private readonly sleepFn: SleepFn = defaultSleep,
    /**
     * The dfl CLI bundle to launch the child with (`node <scriptPath> __worker-run …`).
     * Defaults to the running process's entry script (the same bundle the supervisor
     * itself runs from). Injectable for tests.
     */
    private readonly scriptPath: string = process.argv[1] ?? ""
  ) {}

  /**
   * Run the supervise loop until the child signals a terminal disposition.
   *
   * @returns the process exit code the supervisor itself should exit with
   *   (0 on clean exit / stop, 1 on give-up after too many crashes).
   */
  async run(envelope: WorkerRunEnvelope): Promise<number> {
    const args = buildWorkerRunArgs(this.scriptPath, envelope);

    for (;;) {
      const child = this.spawnFn(process.execPath, args);
      const disposition = await this.superviseChild(child);

      switch (disposition) {
        case "exit-clean":
        case "stop":
          return 0;
        case "relaunch":
          // Intentional upgrade restart (reserved for #48) — a healthy handoff,
          // not a crash. Reset the crash budget and relaunch immediately.
          this.restartTimestamps = [];
          continue;
        case "relaunch-backoff": {
          const result = await this.backoffOrGiveUp();
          if (result === "give-up") {
            return 1;
          }
          continue;
        }
      }
    }
  }

  /**
   * Forward terminal signals to the child and resolve with the interpreted
   * disposition once the child closes.
   *
   * We forward SIGINT/SIGTERM to the child (so it can drain) and DO NOT
   * process.exit on the signal — the child owns the foreground; we wait to
   * observe its close and interpret it, so a clean drain stays clean.
   */
  private superviseChild(child: ChildProcess): Promise<ExitDisposition> {
    return new Promise<ExitDisposition>((resolve) => {
      const forward = (sig: NodeJS.Signals) => {
        child.kill(sig);
      };
      const onSigint = () => forward("SIGINT");
      const onSigterm = () => forward("SIGTERM");

      process.on("SIGINT", onSigint);
      process.on("SIGTERM", onSigterm);

      child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        process.removeListener("SIGINT", onSigint);
        process.removeListener("SIGTERM", onSigterm);
        resolve(interpretExit(code, signal));
      });
    });
  }

  /**
   * Apply crash backoff. Prune relaunch timestamps to the sliding window; give
   * up once MAX_RESTARTS relaunches have happened inside it, otherwise sleep an
   * exponential (capped) backoff and signal a relaunch.
   */
  private async backoffOrGiveUp(): Promise<"relaunch" | "give-up"> {
    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((ts) => now - ts < RESTART_WINDOW_MS);

    if (this.restartTimestamps.length >= MAX_RESTARTS) {
      return "give-up";
    }

    const attempt = this.restartTimestamps.length;
    this.restartTimestamps.push(now);

    const backoffMs = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
    await this.sleepFn(backoffMs);
    return "relaunch";
  }
}
