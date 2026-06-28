/**
 * WorkerSupervisor — exit-code protocol + replaceable-child relaunch loop.
 *
 * Three concerns, each isolated:
 *   1. interpretExit: pure mapping of (code, signal) → disposition.
 *   2. buildWorkerRunArgs: the child argv, incl. the LOAD-BEARING `--` fence.
 *   3. run(): the relaunch loop, driven by an INJECTED fake spawner + fake sleep
 *      so no real process is forked and no real time elapses.
 */

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  WorkerSupervisor,
  interpretExit,
  buildWorkerRunArgs,
  WorkerExitCode,
  type ExitDisposition,
  type WorkerRunEnvelope,
} from "../worker-supervisor.js";

// ============================================================================
// interpretExit
// ============================================================================

describe("interpretExit", () => {
  const cases: Array<{
    name: string;
    code: number | null;
    signal: NodeJS.Signals | null;
    expected: ExitDisposition;
  }> = [
    { name: "code 0 → exit-clean", code: 0, signal: null, expected: "exit-clean" },
    { name: "code 1 → relaunch-backoff", code: 1, signal: null, expected: "relaunch-backoff" },
    {
      name: "code 10 (RESTART_FOR_UPGRADE) → relaunch",
      code: 10,
      signal: null,
      expected: "relaunch",
    },
    { name: "code 11 (STOP) → stop", code: 11, signal: null, expected: "stop" },
    { name: "SIGINT → exit-clean", code: null, signal: "SIGINT", expected: "exit-clean" },
    { name: "SIGTERM → exit-clean", code: null, signal: "SIGTERM", expected: "exit-clean" },
    { name: "code 137 → relaunch-backoff", code: 137, signal: null, expected: "relaunch-backoff" },
  ];

  for (const { name, code, signal, expected } of cases) {
    it(name, () => {
      expect(interpretExit(code, signal)).toBe(expected);
    });
  }
});

// ============================================================================
// buildWorkerRunArgs
// ============================================================================

describe("buildWorkerRunArgs", () => {
  const SCRIPT = "/path/to/cli.js";

  it("leads with the CLI script path, then the verb, worker-id, name, and running-version", () => {
    const envelope: WorkerRunEnvelope = {
      workerId: "id-3",
      name: "worker-3",
      claudeArgs: [],
      runningVersion: "1.2.3",
    };
    expect(buildWorkerRunArgs(SCRIPT, envelope)).toEqual([
      SCRIPT,
      "__worker-run",
      "--worker-id",
      "id-3",
      "--name",
      "worker-3",
      "--running-version",
      "1.2.3",
    ]);
  });

  it("never leads with the bare verb (regression: node <verb> → MODULE_NOT_FOUND)", () => {
    const args = buildWorkerRunArgs(SCRIPT, {
      workerId: "id-1",
      name: "w",
      claudeArgs: [],
      runningVersion: "1.0.0",
    });
    expect(args[0]).toBe(SCRIPT);
    expect(args[0]).not.toBe("__worker-run");
    expect(args[1]).toBe("__worker-run");
  });

  it("emits --worker-id immediately before --name", () => {
    const args = buildWorkerRunArgs(SCRIPT, {
      workerId: "id-9",
      name: "worker-9",
      claudeArgs: [],
      runningVersion: "9.9.9",
    });
    expect(args.indexOf("--worker-id")).toBe(args.indexOf("--name") - 2);
    expect(args[args.indexOf("--worker-id") + 1]).toBe("id-9");
  });

  it("fences non-empty claudeArgs behind a trailing -- in order", () => {
    const args = buildWorkerRunArgs(SCRIPT, {
      workerId: "id-1",
      name: "w",
      claudeArgs: ["--model", "opus", "--dangerously-skip-permissions"],
      runningVersion: "1.0.0",
    });
    expect(args).toEqual([
      SCRIPT,
      "__worker-run",
      "--worker-id",
      "id-1",
      "--name",
      "w",
      "--running-version",
      "1.0.0",
      "--",
      "--model",
      "opus",
      "--dangerously-skip-permissions",
    ]);
  });

  it("emits NO trailing -- when claudeArgs is empty", () => {
    const args = buildWorkerRunArgs(SCRIPT, {
      workerId: "id-1",
      name: "w",
      claudeArgs: [],
      runningVersion: "1.0.0",
    });
    expect(args).not.toContain("--");
  });

  it("always includes --running-version", () => {
    expect(
      buildWorkerRunArgs(SCRIPT, {
        workerId: "id-1",
        name: "w",
        claudeArgs: [],
        runningVersion: "0.0.0-dev",
      })
    ).toContain("--running-version");
  });
});

// ============================================================================
// run() — fake spawner + fake sleep
// ============================================================================

/**
 * A fake child: an EventEmitter with a `.kill` spy. The harness emits `close`
 * with a scripted (code, signal) on the next microtask so `run()`'s awaited
 * promise resolves deterministically without real I/O.
 */
type ScriptedExit = { code: number | null; signal: NodeJS.Signals | null };

function makeFakeSpawner(exits: ScriptedExit[]) {
  const spawned: EventEmitter[] = [];
  let i = 0;
  const spawnFn = vi.fn((_command: string, _args: string[]): ChildProcess => {
    const child = new EventEmitter() as EventEmitter & Pick<ChildProcess, "kill">;
    (child as unknown as { kill: ReturnType<typeof vi.fn> }).kill = vi.fn();
    spawned.push(child);
    const exit = exits[i] ?? { code: 0, signal: null };
    i += 1;
    // Resolve on a microtask so the supervisor has registered its `close`
    // listener before we emit.
    queueMicrotask(() => child.emit("close", exit.code, exit.signal));
    return child as unknown as ChildProcess;
  });
  return { spawnFn, spawned };
}

const envelope: WorkerRunEnvelope = {
  workerId: "stable-worker-id",
  name: "worker-1",
  claudeArgs: [],
  runningVersion: "1.0.0",
};

/** Pull the --worker-id value out of a recorded spawn call's args. */
function workerIdArg(args: string[] | undefined): string | undefined {
  if (!args) return undefined;
  const idx = args.indexOf("--worker-id");
  return idx >= 0 ? args[idx + 1] : undefined;
}

describe("WorkerSupervisor.run", () => {
  it("returns 0 and does not relaunch on a clean (code 0) exit", async () => {
    const { spawnFn } = makeFakeSpawner([{ code: 0, signal: null }]);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const code = await new WorkerSupervisor(spawnFn, sleepFn).run(envelope);

    expect(code).toBe(0);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("spawns `node <scriptPath> __worker-run …` — script path leads, not the bare verb", async () => {
    const { spawnFn } = makeFakeSpawner([{ code: 0, signal: null }]);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const SCRIPT = "/fake/install/cli.js";

    await new WorkerSupervisor(spawnFn, sleepFn, SCRIPT).run(envelope);

    const call = spawnFn.mock.calls[0];
    expect(call?.[0]).toBe(process.execPath);
    expect(call?.[1]?.[0]).toBe(SCRIPT);
    expect(call?.[1]?.[1]).toBe("__worker-run");
  });

  it("returns 0 and does not relaunch when the child is killed by a signal", async () => {
    const { spawnFn } = makeFakeSpawner([{ code: null, signal: "SIGINT" }]);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const code = await new WorkerSupervisor(spawnFn, sleepFn).run(envelope);

    expect(code).toBe(0);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("relaunches after RESTART_FOR_UPGRADE without backoff", async () => {
    const { spawnFn } = makeFakeSpawner([
      { code: WorkerExitCode.RESTART_FOR_UPGRADE, signal: null },
      { code: 0, signal: null },
    ]);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const code = await new WorkerSupervisor(spawnFn, sleepFn).run(envelope);

    expect(code).toBe(0);
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("relaunches N times on crashes within the window, then gives up (returns 1)", async () => {
    // 5 crashes hit MAX_RESTARTS; the 6th spawn would exceed the budget and
    // give up. So we need 6 spawns: the loop spawns, crashes, backs off x5,
    // then on the 6th crash give-up triggers (5 timestamps already in window).
    const crashes: ScriptedExit[] = Array.from({ length: 6 }, () => ({
      code: 1,
      signal: null,
    }));
    const { spawnFn } = makeFakeSpawner(crashes);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const code = await new WorkerSupervisor(spawnFn, sleepFn).run(envelope);

    expect(code).toBe(1);
    // 6 spawns total: 5 that recorded a relaunch + 1 whose crash hit give-up.
    expect(spawnFn).toHaveBeenCalledTimes(6);
    expect(sleepFn).toHaveBeenCalledTimes(5);
  });

  it("grows backoff exponentially and caps at 30s", async () => {
    const crashes: ScriptedExit[] = Array.from({ length: 6 }, () => ({
      code: 1,
      signal: null,
    }));
    const { spawnFn } = makeFakeSpawner(crashes);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await new WorkerSupervisor(spawnFn, sleepFn).run(envelope);

    // attempt 0..4 → 1000 * 2^attempt, capped at 30000.
    expect(sleepFn.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  // #47: the envelope is built ONCE and reused for every relaunch, so the SAME
  // --worker-id rides every spawn. This is the guarantee that lets a relaunched
  // child resume its own in-flight claim instead of minting a fresh UUID.
  it("threads the SAME --worker-id through every relaunch after RESTART_FOR_UPGRADE", async () => {
    const { spawnFn } = makeFakeSpawner([
      { code: WorkerExitCode.RESTART_FOR_UPGRADE, signal: null },
      { code: 0, signal: null },
    ]);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await new WorkerSupervisor(spawnFn, sleepFn).run(envelope);

    expect(spawnFn).toHaveBeenCalledTimes(2);
    const ids = spawnFn.mock.calls.map((c) => workerIdArg(c[1]));
    expect(ids).toEqual([envelope.workerId, envelope.workerId]);
  });

  it("threads the SAME --worker-id through every crash-backoff relaunch", async () => {
    const { spawnFn } = makeFakeSpawner([
      { code: 1, signal: null },
      { code: 1, signal: null },
      { code: 0, signal: null },
    ]);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await new WorkerSupervisor(spawnFn, sleepFn).run(envelope);

    expect(spawnFn).toHaveBeenCalledTimes(3);
    const ids = spawnFn.mock.calls.map((c) => workerIdArg(c[1]));
    expect(ids).toEqual([envelope.workerId, envelope.workerId, envelope.workerId]);
    expect(new Set(ids).size).toBe(1);
  });
});
