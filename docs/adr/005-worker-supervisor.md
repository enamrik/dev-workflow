# ADR-005: Worker Supervisor / Runner

Proposed (spike deliverable for issue #37 — design + roadmap, no implementation).

## Context

The goal is autonomy: once a worker is started, the orchestrator (and the user)
should be able to **watch it, know what dfl version it's on, push it directives,
update it, and restart it** — without the worker dying or needing a manual
relaunch.

Today a worker is a **single process** (`dfl claude -- <args>`), and that shape
has produced a string of bugs this is meant to end:

- **Identity is ephemeral.** The worker id is a fresh `randomUUID()` per process,
  never persisted (`claude-worker.service.ts`). A restarted worker is a _new_
  worker, so it can't resume its own claim — recovery only happens via generic
  stale-reclaim.
- **No control channel.** The only orchestrator→worker signal is indirect (the
  worker polling the tracker). There's no way to tell a live worker "stop, this
  was superseded" — which forced destructive workarounds (completing a task +
  removing its worktree out from under a live session).
- **In-process self-restart is fundamentally unsafe (the #42 lesson).** Node has
  no `execve`, so the self-restart (#27/#38) re-exec'd by spawning a replacement
  child and exiting the parent. That **orphaned** the new worker — it was no
  longer the terminal's foreground process — so its interactive `claude` sessions
  hit EOF on the TTY and instant-exited, spinning an infinite claim→exit→reclaim
  loop. #42 **disabled** self-restart (gated behind `DFL_WORKER_SELF_RESTART=1`)
  precisely because a single interactive process **cannot** safely re-exec itself.

These are not independent bugs — they're symptoms of a missing abstraction. The
fix is a **supervisor**: a thin, long-lived parent that owns the terminal and the
identity, and runs the actual work loop as a **replaceable child subprocess**.

## Prior art: as.platform.t3's workload process runner

`~/code/as.platform.t3` solves the same parent/replaceable-child problem in
`src/cli/commands/runner/workload-process-runner.ts` +
`src/cli/workload/workload-process-runner-proxy.ts`:

- A **proxy (parent)** spawns the work as a **child subprocess** via a hidden verb
  (`ascli __workload-process-runner --opts-file <path>`).
- Config crosses the boundary as a serialized **envelope** (opts file); the parent
  waits on the child's `close` (`spawnInherit`).
- The child does the real work, writes a **result**, and **exits with a code the
  parent interprets** (e.g. `stuck` → retry, `deploy-failed` → terminal).

The takeaways we adopt: **(1)** a thin parent that owns the lifecycle, **(2)** a
replaceable child run via a hidden verb, **(3)** a typed boundary — config in via
an envelope, status/intent out via exit codes — so the parent can decide to
re-run, replace, or stop the child.

## Decision: a `WorkerSupervisor` that owns the TTY + identity and runs the worker loop as a child

`dfl claude -- <args>` becomes a **supervisor** rather than the worker itself.

```
dfl claude -- --model opus …            ← the SUPERVISOR (long-lived, owns the TTY + stable id)
  └─ spawns: dfl __worker-run            ← the WORKER CHILD (poll/claim/work loop), replaceable
        └─ spawns: claude (interactive)  ← the task session (unchanged)
```

### Frozen spots (live on the supervisor)

- **Stable, persisted identity.** The supervisor owns the worker id/name and
  persists it (worker-queue DB, keyed to this supervisor), so a child restart
  keeps the _same_ identity and can resume its own claim. Fixes the
  fresh-UUID-per-process gap.
- **TTY ownership.** The supervisor is the terminal's foreground process for its
  whole life. It spawns the child with inherited stdio; when it replaces the
  child, the new child inherits the _same_ foreground TTY — so the interactive
  `claude` session works. **This is the TTY-safe restart #42 was missing.**
- **Control channel** (folds in #29): the supervisor reads pending directives
  (info / stop-abandon / restart) and either forwards them to the child or acts
  (kill + relaunch / kill + exit).
- **Version watch + update** (folds in #33): the supervisor compares the running
  child's version against the installed bundle; on change it optionally triggers
  `dfl update` and then **replaces the child** (the new child runs new code). The
  child never re-execs itself — the supervisor does, in the foreground.
- **Status + version reporting** (extends #28): the supervisor reports its
  identity, the child's version, and liveness up, so the orchestrator can see
  "who's on what, on which build."

### Hot spot (the replaceable child)

The child is the existing poll/claim/work loop, launched via a hidden
`dfl __worker-run` verb with an **envelope** (supervisor id, worker name,
claudeArgs). It exits with a **code the supervisor interprets**:

| Child exit                   | Supervisor action                              |
| ---------------------------- | ---------------------------------------------- |
| `0` (drained / told to stop) | exit (or relaunch if just idle-cycling)        |
| `RESTART_FOR_UPGRADE`        | relaunch the child on the new build (TTY-safe) |
| `STOP` (directive)           | clean up + exit                                |
| nonzero / crash              | bounded restart with backoff (don't hot-loop)  |

This is the t3 contract: envelope in, exit-code intent out — but with the child
inheriting the supervisor's foreground TTY so the interactive session is sound.

## How this resolves the open issues

| Issue                                   | Becomes                                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **#42** (self-restart disabled)         | Re-enabled, but as a **supervisor-driven** child replacement (TTY-safe). The in-process `maybeRestartForUpgrade` path is retired. |
| **#29** (orchestrator→worker messaging) | The supervisor's **control channel** — the natural place to consume directives.                                                   |
| **#33** (`dfl update`)                  | The supervisor's **version-watch trigger** — update the install, replace the child.                                               |
| **#28** (compact dispatch status)       | Extended with **supervisor identity + child version** reporting.                                                                  |
| persisted identity (no issue yet)       | A supervisor responsibility — **new follow-up**.                                                                                  |

## Roadmap (follow-up issues)

1. **Supervisor core + `__worker-run` child seam** — the supervisor process, the
   hidden child verb, the envelope, and the exit-code contract. _(new — the
   foundation; everything else depends on it.)_
2. **Persisted supervisor/worker identity** — stable id/name across child
   restarts; resume own claim. _(new.)_
3. **Re-enable self-restart via the supervisor** — child exits
   `RESTART_FOR_UPGRADE`; supervisor relaunches in the foreground. Retires the
   `DFL_WORKER_SELF_RESTART` gate from **#42**. _(depends on 1.)_
4. **Control channel** — implement **#29** as the supervisor's directive consumer
   (info / stop-abandon / restart). _(depends on 1.)_
5. **Version-watch + update trigger** — wire **#33** (`dfl update`) into the
   supervisor's watch loop. _(depends on 1 + 3.)_
6. **Status/version reporting** — extend **#28** with supervisor identity + child
   version. _(depends on 1.)_

## Consequences

### Positive

- One abstraction (the supervisor) owns lifecycle, identity, control, and
  restart — instead of five overlapping patches in the worker process.
- **TTY-safe restart** — the root cause of the #42 loop is structurally gone.
- The orchestrator can watch, message, update, and restart workers — the autonomy
  goal.

### Negative / cost

- A new process layer (supervisor ↔ child) and a hidden verb + envelope contract
  to build and test.
- Slightly more to reason about when debugging (two processes, not one).

### Neutral

- The interactive `claude` task session is unchanged — it's still spawned by the
  child with inherited stdio.

## References

- The #42 TTY-orphan lesson: `apps/cli/src/application/claude-worker.service.ts`
  (`maybeRestartForUpgrade`, `reExec`, `buildReExecArgs`).
- Prior art: `~/code/as.platform.t3/src/cli/commands/runner/workload-process-runner.ts`,
  `~/code/as.platform.t3/src/cli/workload/workload-process-runner-proxy.ts`.
- Folds in: #29 (messaging), #33 (`dfl update`), #28 (dispatch status), #42 (disabled self-restart).
