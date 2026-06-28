/**
 * ClaudeWorkerService — authoritative project resolution + worktree-cwd spawn.
 *
 * The bug this guards: a worker claimed a task and spawned the Claude session
 * in whatever project the dispatch-queue `project_slug` named — which can be
 * the claiming worker's HOME project, not the task's owner. The fix resolves
 * the owning project from the TASK (via the global tasks→…→projects join) and
 * spawns the session inside the TASK'S WORKTREE.
 *
 * These tests prove that when the queue slug is WRONG, the worker still:
 *   (a) resolves the task's TRUE project, and
 *   (b) spawns `claude` with cwd = the TRUE project's worktree path,
 *       pre-created via the shared worktree service and persisted on the task.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { EventEmitter } from "node:events";

// --- Hoisted spies so the module mocks can reference them -------------------
const { spawnSpy, createWorktreeSpy, updateWorktreeInfoSpy, isTaskAvailableSpy } = vi.hoisted(
  () => ({
    spawnSpy: vi.fn(),
    createWorktreeSpy: vi.fn(),
    updateWorktreeInfoSpy: vi.fn(),
    isTaskAvailableSpy: vi.fn(),
  })
);

vi.mock("node:child_process", () => ({ spawn: spawnSpy }));

// The worktree directory should look absent so ensureWorktree creates it.
// WorkerSessionLog also touches the fs (it captures the session lifecycle to a
// per-task log); stub those calls so no real files are written during the test.
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }),
  unlinkSync: vi.fn(),
  createWriteStream: vi.fn().mockReturnValue({
    write: vi.fn(),
    on: vi.fn(),
    end: vi.fn().mockImplementation((cb?: () => void) => cb?.()),
  }),
}));

vi.mock("@dev-workflow/git/worktrees/git-worktree-service.js", () => ({
  // Mirror the real signature: returns { branchName, worktreePath } (relative).
  generateWorktreeNames: (issueNumber: number, taskNumber: number) => ({
    branchName: `issue-${issueNumber}/task-${taskNumber}-x`,
    worktreePath: `.worktrees/issue-${issueNumber}-task-${taskNumber}`,
  }),
  NodeGitWorktreeService: vi.fn().mockImplementation((projectRoot: string) => ({
    projectRoot,
    createWorktree: createWorktreeSpy,
  })),
}));

vi.mock("@dev-workflow/git/track-directory-resolver.js", () => ({
  getGlobalDatabasePath: () => "/fake/global/workflow.db",
  // The prompt resolver consults this for the shared-override location; point it
  // at a path with no prompt files so buildClaudePrompt uses the embedded default.
  resolveGlobalDflHome: () => "/fake/dfl-home",
  // WorkerSessionLog resolves its worker-logs dir from here.
  resolveGlobalTrackDir: () => "/fake/dfl-home/track",
}));

// TaskDomainService is constructed inside the worker only to persist worktree
// info; stub it to capture the persist call. resolveProjectInfoByTaskId is the
// REAL composition (not mocked) so we exercise the true resolution path.
vi.mock("@dev-workflow/tracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dev-workflow/tracking")>();
  return {
    ...actual,
    TaskDomainService: vi.fn().mockImplementation(() => ({
      updateWorktreeInfo: updateWorktreeInfoSpy,
      isTaskAvailable: isTaskAvailableSpy,
    })),
  };
});

import { Effect } from "@dev-workflow/effect";
import { ClaudeWorkerService, buildReExecArgs } from "../claude-worker.service.js";

// --- Constants --------------------------------------------------------------

const TASK_ID = "task-1";
const TRUE_SLUG = "real-project-aaaaaa";
const WRONG_SLUG = "wrong-project-bbbbbb"; // what the dispatch queue claims
const TRUE_GIT_ROOT = "/repos/real-project";
const TRUE_WORKTREE = `${TRUE_GIT_ROOT}/.worktrees/issue-7-task-3`;

const trueProjectInfo = {
  projectId: "proj-uuid-real",
  slug: TRUE_SLUG,
  name: "Real Project",
  sourceInfo: { connectionString: "sqlite:///repos/real/workflow.db" },
  gitRoot: TRUE_GIT_ROOT,
};

// A Task-shaped object good enough for the worker's reads.
const taskRow = {
  id: TASK_ID,
  number: 3,
  title: "Do the thing",
  status: "READY",
  worktreePath: undefined as string | undefined,
  branchName: undefined as string | undefined,
  isTerminal: false,
};

// --- Fakes ------------------------------------------------------------------

/** A DbSource that serves BOTH the global join and the project client. */
function makeFakeSource() {
  return {
    // global resolution: returns the TRUE slug regardless of the queue slug
    findProjectSlugByTaskId: vi.fn().mockReturnValue(TRUE_SLUG),
    // project client used by findTaskById / getTotalTaskCount
    createClient: vi.fn().mockReturnValue({
      tasks: {
        findById: vi.fn().mockImplementation(() => Effect.succeed(taskRow)),
        findByPlanId: vi.fn().mockImplementation(() => Effect.succeed([taskRow])),
      },
      plans: {},
      issues: {},
    }),
    // getIssueNumber's drizzle chain
    getDb: vi.fn().mockReturnValue({
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            innerJoin: () => ({
              where: () => ({ get: () => ({ number: 7 }) }),
            }),
          }),
        }),
      }),
    }),
  };
}

function makeFakeQueue() {
  return {
    updateStatus: vi.fn(),
    findByTaskId: vi.fn().mockReturnValue(null),
    remove: vi.fn(),
    updateHeartbeat: vi.fn(),
    // Self-heal write invoked when the queue slug disagrees with the resolved owner.
    updateProjectSlug: vi.fn(),
    // Polling restarts after a session exits; keep it a harmless no-op.
    claimTask: vi.fn().mockReturnValue(null),
  };
}

/** Stop the polling interval that releaseTask() restarts after a session ends. */
function stopPolling(service: ClaudeWorkerService): void {
  const internals = service as unknown as { pollInterval: NodeJS.Timeout | null };
  if (internals.pollInterval) {
    clearInterval(internals.pollInterval);
    internals.pollInterval = null;
  }
}

describe("ClaudeWorkerService.workOnTask — authoritative resolution + worktree cwd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskRow.worktreePath = undefined;
    taskRow.branchName = undefined;

    // createWorktree returns the absolute resolved path (as the real impl does).
    createWorktreeSpy.mockImplementation(() => Effect.succeed(TRUE_WORKTREE));
    updateWorktreeInfoSpy.mockImplementation(() => Effect.succeed(undefined));
    isTaskAvailableSpy.mockImplementation(() => Effect.succeed(true));

    // spawn returns a fake ChildProcess that exits on the next tick so the
    // session-spawn promise resolves and the test completes.
    spawnSpy.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & { kill: () => void };
      proc.kill = vi.fn();
      setImmediate(() => proc.emit("exit", 0));
      return proc;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores a wrong queue slug, resolves the task's true project, and spawns claude in its worktree", async () => {
    const fakeSource = makeFakeSource();
    const queue = makeFakeQueue();

    const sourceProvider = {
      getOrCreate: vi.fn().mockReturnValue(fakeSource),
      closeAll: vi.fn(),
    };

    const projectsResolver = {
      // resolveProjectInfoByTaskId calls this with the slug from the global join
      getProjectBySlug: vi.fn().mockImplementation((slug: string) => {
        expect(slug).toBe(TRUE_SLUG); // proves resolution used the join, not the queue slug
        return Effect.succeed(trueProjectInfo);
      }),
    };

    const service = new ClaudeWorkerService(
      queue as never,
      sourceProvider as never,
      projectsResolver as never
    );

    // Drive the private orchestration directly with the WRONG queue slug.
    await (
      service as unknown as {
        workOnTask: (taskId: string, projectSlug: string) => Promise<void>;
      }
    ).workOnTask(TASK_ID, WRONG_SLUG);

    stopPolling(service);

    // (a) Resolution used the global join (true slug), not the queue slug.
    expect(fakeSource.findProjectSlugByTaskId).toHaveBeenCalledWith(TASK_ID);
    expect(projectsResolver.getProjectBySlug).toHaveBeenCalledWith(TRUE_SLUG);
    expect(projectsResolver.getProjectBySlug).not.toHaveBeenCalledWith(WRONG_SLUG);

    // (a.1) The poisoned queue row is self-healed to the resolved owner's slug.
    expect(queue.updateProjectSlug).toHaveBeenCalledWith(TASK_ID, TRUE_SLUG);

    // (b) Worktree pre-created against the TRUE project's gitRoot and persisted.
    expect(createWorktreeSpy).toHaveBeenCalledTimes(1);
    expect(updateWorktreeInfoSpy).toHaveBeenCalledWith(TASK_ID, TRUE_WORKTREE, expect.any(String));

    // (c) Claude spawned with cwd = the TRUE worktree path (not gitRoot, not wrong project).
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [, , opts] = spawnSpy.mock.calls[0] as [string, string[], { cwd: string }];
    expect(opts.cwd).toBe(TRUE_WORKTREE);
  });

  it("queue-claim path: a poisoned slug is judged available by the TRUE owner, not removed, and self-heals", async () => {
    const fakeSource = makeFakeSource();
    const queue = makeFakeQueue();
    // The dispatch queue hands back a POISONED slug for this task.
    queue.claimTask.mockReturnValueOnce({ taskId: TASK_ID, projectSlug: WRONG_SLUG });

    const sourceProvider = {
      getOrCreate: vi.fn().mockReturnValue(fakeSource),
      closeAll: vi.fn(),
    };

    const projectsResolver = {
      // resolveProjectInfoByTaskId (used by BOTH the availability gate and
      // workOnTask) resolves via the global join → the TRUE slug.
      getProjectBySlug: vi.fn().mockImplementation((slug: string) => {
        expect(slug).toBe(TRUE_SLUG);
        return Effect.succeed(trueProjectInfo);
      }),
    };

    const service = new ClaudeWorkerService(
      queue as never,
      sourceProvider as never,
      projectsResolver as never
    );

    // Drive the QUEUE-CLAIM orchestration (not workOnTask directly).
    await (service as unknown as { tryClaimTask: () => Promise<void> }).tryClaimTask();

    stopPolling(service);

    // Availability was checked against the TRUE owner (resolved by task), so the
    // poisoned row is NOT removed and the task proceeds.
    expect(isTaskAvailableSpy).toHaveBeenCalledWith(TASK_ID);
    expect(queue.remove).not.toHaveBeenCalled();

    // Claude spawned in the TRUE worktree, and the poisoned row self-healed.
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [, , opts] = spawnSpy.mock.calls[0] as [string, string[], { cwd: string }];
    expect(opts.cwd).toBe(TRUE_WORKTREE);
    expect(queue.updateProjectSlug).toHaveBeenCalledWith(TASK_ID, TRUE_SLUG);
  });

  it("releases (does not spawn) when the task resolves to no project", async () => {
    const fakeSource = makeFakeSource();
    fakeSource.findProjectSlugByTaskId.mockReturnValue(null); // task/issue/project missing
    const queue = makeFakeQueue();

    const sourceProvider = {
      getOrCreate: vi.fn().mockReturnValue(fakeSource),
      closeAll: vi.fn(),
    };
    const projectsResolver = { getProjectBySlug: vi.fn() };

    const service = new ClaudeWorkerService(
      queue as never,
      sourceProvider as never,
      projectsResolver as never
    );

    await (
      service as unknown as {
        workOnTask: (taskId: string, projectSlug: string) => Promise<void>;
      }
    ).workOnTask(TASK_ID, WRONG_SLUG);

    stopPolling(service);

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(createWorktreeSpy).not.toHaveBeenCalled();
  });

  it("aggressively re-asserts its banner so the worker title wins the TTY (issue #23)", async () => {
    // The spawned `claude` process inherits the TTY and writes its OWN title
    // ("Execute Task…"). We can't suppress it, so the worker WINS by re-asserting
    // its banner on a tight cadence (titleAssertIntervalMs) — whatever Claude
    // paints is overwritten quickly. Across a window with an UNCHANGED status the
    // worker must keep re-emitting its banner (many writes), NOT back off.
    vi.useFakeTimers();

    const fakeSource = makeFakeSource();
    const queue = makeFakeQueue();
    const sourceProvider = {
      getOrCreate: vi.fn().mockReturnValue(fakeSource),
      closeAll: vi.fn(),
    };
    const projectsResolver = {
      getProjectBySlug: vi.fn().mockImplementation(() => Effect.succeed(trueProjectInfo)),
    };

    // Keep the spawned process ALIVE so the intervals keep ticking; emit exit later
    // (the beforeEach mock auto-exits — override it).
    spawnSpy.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & { kill: () => void };
      proc.kill = vi.fn();
      return proc;
    });

    // Tight re-assert cadence so a 2s window produces many deterministic emits.
    const service = new ClaudeWorkerService(
      queue as never,
      sourceProvider as never,
      projectsResolver as never,
      { titleAssertIntervalMs: 200 }
    );
    // Capture every OSC title write (both the 2s content refresh and the re-asserts).
    const titleWrites: string[] = [];
    vi.spyOn(
      service as unknown as { setTerminalTitle: (t: string) => void },
      "setTerminalTitle"
    ).mockImplementation((t: string) => {
      titleWrites.push(t);
    });

    // Kick off the orchestration but DON'T await — it resolves only on proc exit.
    const done = (
      service as unknown as {
        workOnTask: (taskId: string, projectSlug: string) => Promise<void>;
      }
    ).workOnTask(TASK_ID, WRONG_SLUG);

    // Flush the async setup (initial banner paint), then run one full watch tick
    // (2s) during which the 200ms re-assert interval fires ~10 times — status
    // UNCHANGED the whole time.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);

    // The worker keeps re-asserting (wins): many writes despite a constant status.
    // The rejected "back off" behavior would produce ≤ 2 here.
    expect(titleWrites.length).toBeGreaterThanOrEqual(5);
    // And what it re-asserts is the WORKER's banner, not Claude's "Execute Task…".
    expect(titleWrites.at(-1)).toContain("#7.3");
    expect(titleWrites.at(-1)).toContain("Do the thing");

    // End the session and let workOnTask resolve.
    const spawnedProc = spawnSpy.mock.results.at(-1)?.value as EventEmitter & {
      kill: () => void;
    };
    spawnedProc.emit("exit", 0);
    await done;
    stopPolling(service);
  });

  it("adopts an existing worktree on re-claim without recreating it", async () => {
    taskRow.worktreePath = TRUE_WORKTREE;
    taskRow.branchName = "issue-7/task-3-x";

    const fs = await import("node:fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const fakeSource = makeFakeSource();
    const queue = makeFakeQueue();
    const sourceProvider = {
      getOrCreate: vi.fn().mockReturnValue(fakeSource),
      closeAll: vi.fn(),
    };
    const projectsResolver = {
      getProjectBySlug: vi.fn().mockImplementation(() => Effect.succeed(trueProjectInfo)),
    };

    const service = new ClaudeWorkerService(
      queue as never,
      sourceProvider as never,
      projectsResolver as never
    );

    await (
      service as unknown as {
        workOnTask: (taskId: string, projectSlug: string) => Promise<void>;
      }
    ).workOnTask(TASK_ID, WRONG_SLUG);

    stopPolling(service);

    // Existing worktree on disk → adopt, no creation, spawn there.
    expect(createWorktreeSpy).not.toHaveBeenCalled();
    const [, , opts] = spawnSpy.mock.calls[0] as [string, string[], { cwd: string }];
    expect(opts.cwd).toBe(TRUE_WORKTREE);
  });
});

describe("ClaudeWorkerService.tryAutoClaimReadyTask — order by priority then age", () => {
  const autoProjectInfo = {
    projectId: "proj-auto",
    slug: "auto-project-cccccc",
    name: "Auto Project",
    sourceInfo: { connectionString: "sqlite:///repos/auto/workflow.db" },
    gitRoot: "/repos/auto",
  };

  // A READY task with the fields tryAutoClaimReadyTask reads. Priority is NOT
  // on the task — it's resolved from the parent issue via plan→issue below.
  function readyTask(id: string, planId: string, createdAt: string) {
    return { id, planId, createdAt, title: id, status: "READY", dependsOn: [] };
  }

  /**
   * Build a fake source whose client serves the READY tasks plus the
   * plan→issue resolution used to inherit each task's priority.
   *
   * @param tasks       READY tasks in the (arbitrary) order findMany returns them
   * @param planToIssue planId → issueId
   * @param issueToPrio issueId → priority
   */
  function makeAutoClaimSource(
    tasks: ReturnType<typeof readyTask>[],
    planToIssue: Record<string, string>,
    issueToPrio: Record<string, string>
  ) {
    return {
      types: {},
      createClient: vi.fn().mockReturnValue({
        tasks: {
          findMany: vi.fn().mockImplementation(() => Effect.succeed(tasks)),
        },
        plans: {
          findById: vi
            .fn()
            .mockImplementation((id: string) =>
              Effect.succeed(planToIssue[id] ? { id, issueId: planToIssue[id] } : null)
            ),
        },
        issues: {
          findById: vi
            .fn()
            .mockImplementation((id: string) =>
              Effect.succeed(issueToPrio[id] ? { id, priority: issueToPrio[id] } : null)
            ),
        },
      }),
    };
  }

  /**
   * Run the auto-claim loop with claimTask losing every race, so the loop
   * enqueues every eligible candidate in claim order without spawning Claude.
   * The order of `queue.enqueue` calls IS the order auto-claim considered.
   */
  async function enqueueOrderFor(
    source: ReturnType<typeof makeAutoClaimSource>
  ): Promise<string[]> {
    const queue = {
      findByTaskId: vi.fn().mockReturnValue(null),
      enqueue: vi.fn(),
      claimTask: vi.fn().mockReturnValue(null), // always lose the race → keep looping
    };
    const sourceProvider = { getOrCreate: vi.fn().mockReturnValue(source) };
    const projectsResolver = {
      getAllProjects: vi.fn().mockReturnValue(Effect.succeed([autoProjectInfo])),
    };

    const service = new ClaudeWorkerService(
      queue as never,
      sourceProvider as never,
      projectsResolver as never
    );

    await (
      service as unknown as { tryAutoClaimReadyTask: () => Promise<unknown> }
    ).tryAutoClaimReadyTask();

    return queue.enqueue.mock.calls.map((call) => call[0] as string);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims a HIGH-priority READY task before a LOW one, even when LOW is older", async () => {
    // findMany returns LOW first (and LOW is older) — priority must still win.
    const low = readyTask("low-task", "plan-low", "2024-01-01T00:00:00.000Z");
    const high = readyTask("high-task", "plan-high", "2024-02-01T00:00:00.000Z");
    const source = makeAutoClaimSource(
      [low, high],
      { "plan-low": "issue-low", "plan-high": "issue-high" },
      { "issue-low": "LOW", "issue-high": "HIGH" }
    );

    const order = await enqueueOrderFor(source);

    expect(order[0]).toBe("high-task");
    expect(order).toEqual(["high-task", "low-task"]);
  });

  it("breaks ties between equal-priority tasks by oldest-first (createdAt asc)", async () => {
    // Both MEDIUM; findMany returns the newer one first to prove the sort reorders.
    const newer = readyTask("newer-task", "plan-newer", "2024-03-01T00:00:00.000Z");
    const older = readyTask("older-task", "plan-older", "2024-01-01T00:00:00.000Z");
    const source = makeAutoClaimSource(
      [newer, older],
      { "plan-newer": "issue-newer", "plan-older": "issue-older" },
      { "issue-newer": "MEDIUM", "issue-older": "MEDIUM" }
    );

    const order = await enqueueOrderFor(source);

    expect(order).toEqual(["older-task", "newer-task"]);
  });
});

// ---------------------------------------------------------------------------
// buildReExecArgs — the self-restart re-exec arg reconstruction.
//
// Guards issue #38: the worker re-execs into a freshly-installed dfl bundle on
// a dfl update. The passthrough args (everything after `--` on the original
// `dfl claude` invocation) MUST be re-fenced behind their own `--` so the
// re-exec'd `dfl claude` forwards them to the inner claude instead of parsing
// them as its own options (which dies with `unknown option`).
// ---------------------------------------------------------------------------

describe("buildReExecArgs", () => {
  const BUNDLE = "/install/cli.js";
  const NAME = "worker-1";

  it("re-inserts the `--` separator before passthrough args so dfl claude doesn't parse them", () => {
    const args = buildReExecArgs(BUNDLE, NAME, [
      "--model",
      "opus",
      "--dangerously-skip-permissions",
    ]);

    expect(args).toEqual([
      BUNDLE,
      "claude",
      "--name",
      NAME,
      "--",
      "--model",
      "opus",
      "--dangerously-skip-permissions",
    ]);
    // The separator appears exactly once, immediately before the passthrough args.
    expect(args.filter((a) => a === "--")).toHaveLength(1);
    expect(args.indexOf("--")).toBe(args.indexOf("--model") - 1);
  });

  it("omits the trailing `--` when there are no passthrough args", () => {
    const args = buildReExecArgs(BUNDLE, NAME, []);

    expect(args).toEqual([BUNDLE, "claude", "--name", NAME]);
    expect(args).not.toContain("--");
  });

  it("preserves passthrough args verbatim, including a `--` they contain", () => {
    const args = buildReExecArgs(BUNDLE, NAME, ["--flag", "--", "trailing"]);

    // Our fence `--` is prepended; the user's own args (incl. their `--`) follow untouched.
    expect(args).toEqual([BUNDLE, "claude", "--name", NAME, "--", "--flag", "--", "trailing"]);
  });
});

// ---------------------------------------------------------------------------
// reExec() handoff — Node has no execve, so the replacement build is a child
// the parent must SEE come up before exiting. The old code exited on "spawn"
// alone, so a child that died on startup (e.g. the #38 `unknown option`) left
// the worker dead. These guard the grace-window handoff.
// ---------------------------------------------------------------------------

describe("reExec handoff", () => {
  let exitSpy: MockInstance<(code?: string | number | null | undefined) => never>;

  const driveReExec = (claudeArgs: string[] = []) => {
    const queue = { unregisterWorker: vi.fn() };
    const service = new ClaudeWorkerService(queue as never, {} as never, {} as never, {
      claudeArgs,
    });
    // Controllable child — we drive spawn/exit by hand (no auto-exit).
    const child = new EventEmitter() as EventEmitter & { kill: () => void };
    child.kill = vi.fn();
    spawnSpy.mockImplementationOnce(() => child);
    // The self-restart latch is set by maybeRestartForUpgrade before reExec runs.
    (service as unknown as { isRestarting: boolean }).isRestarting = true;
    (service as unknown as { reExec: () => void }).reExec();
    return { service, queue, child };
  };

  const isRestarting = (service: ClaudeWorkerService) =>
    (service as unknown as { isRestarting: boolean }).isRestarting;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.useRealTimers();
  });

  it("stays alive on the current build when the re-exec'd child exits during startup", () => {
    const { service, queue, child } = driveReExec(["--model", "opus"]);

    child.emit("spawn"); // spawn() succeeded...
    child.emit("exit", 1, null); // ...but the new build died immediately (bad arg).

    // The worker abandons the handoff rather than dying: latch released so the
    // poll loop resumes, no process.exit, and it stays registered.
    expect(isRestarting(service)).toBe(false);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(queue.unregisterWorker).not.toHaveBeenCalled();
  });

  it("stays alive when the child can't be spawned at all (error event)", () => {
    const { service, queue, child } = driveReExec();

    child.emit("error", new Error("ENOENT"));

    expect(isRestarting(service)).toBe(false);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(queue.unregisterWorker).not.toHaveBeenCalled();
  });

  it("hands off (unregisters + exits) once the child survives the grace window", () => {
    vi.useFakeTimers();
    const { queue, child } = driveReExec();

    child.emit("spawn");
    // Before the grace window elapses we have NOT committed to the handoff.
    expect(exitSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    // Survived startup → tear down so the new build takes over the terminal.
    expect(queue.unregisterWorker).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

// ---------------------------------------------------------------------------
// #42: in-process self-restart is DISABLED by default. The spawn+exit re-exec
// orphans the worker (loses TTY foreground) → post-restart claude sessions
// instant-exit → infinite claim/reclaim loop. Gated behind DFL_WORKER_SELF_RESTART=1
// until a TTY-safe relauncher (supervisor, #37) exists.
// ---------------------------------------------------------------------------

describe("maybeRestartForUpgrade — self-restart disabled by default (#42)", () => {
  const ENV = "DFL_WORKER_SELF_RESTART";
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env[ENV];
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env[ENV];
    else process.env[ENV] = prevEnv;
  });

  // A service that is idle AND has an upgrade available — so the ONLY thing that
  // can stop a restart is the #42 gate.
  const idleServiceWithUpgrade = () => {
    const queue = { unregisterWorker: vi.fn() };
    const service = new ClaudeWorkerService(queue as never, {} as never, {} as never, {});
    (service as unknown as { upgradeDetector: { detectUpgrade: () => unknown } }).upgradeDetector =
      {
        detectUpgrade: () => ({ from: "0.0.0-dev+gaaa", to: "0.0.0-dev+gbbb" }),
      };
    return service;
  };
  const callMaybeRestart = (service: ClaudeWorkerService) =>
    (service as unknown as { maybeRestartForUpgrade: () => boolean }).maybeRestartForUpgrade();

  it("does NOT restart when DFL_WORKER_SELF_RESTART is unset, even with an upgrade available", () => {
    delete process.env[ENV];
    expect(callMaybeRestart(idleServiceWithUpgrade())).toBe(false);
  });

  it("does NOT restart when DFL_WORKER_SELF_RESTART is set to something other than '1'", () => {
    process.env[ENV] = "true";
    expect(callMaybeRestart(idleServiceWithUpgrade())).toBe(false);
  });
});
