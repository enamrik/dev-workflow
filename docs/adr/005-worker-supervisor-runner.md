# ADR-005: Worker Supervisor/Runner Architecture

## Status

Proposed (spike deliverable for issue #37 — decision + roadmap, no migration performed)

## Context

`dfl claude` runs a long-lived worker that polls for tasks and spawns `claude` to
execute them. The vision behind #37 is that once a worker is started, the
orchestrator (and operator) should have rich control over it — watch it, know
which `dfl` version it runs, trigger force-updates and restarts, message it, and
have it recover and continue autonomously: _"the orchestrator + its workers
become autonomous."_

Today that is structurally impossible because **one class,
`ClaudeWorkerService`** (1235 lines,
[claude-worker.service.ts](../../apps/cli/src/application/claude-worker.service.ts)),
owns **everything**: identity, registration, heartbeat, the poll loop, upgrade
detection, re-exec restart, worktree resolution, prompt building, spawning
`claude`, watching the task, and TTY title arbitration. This ADR records a
prior-art review, the architectural decision that unblocks the vision, and a
roadmap of follow-up issues. No code is migrated here.

### The problem #37 exists to solve

The self-restart path (#27/#38) re-execs the worker into a freshly-installed
bundle at an idle boundary
([maybeRestartForUpgrade, claude-worker.service.ts:1125](../../apps/cli/src/application/claude-worker.service.ts);
[reExec, :1165](../../apps/cli/src/application/claude-worker.service.ts)). Because
**Node has no `execve`**, `reExec()` spawns a _child_ and the parent
`process.exit(0)`s after a 500 ms grace window
([REEXEC_HANDOFF_GRACE_MS, :77](../../apps/cli/src/application/claude-worker.service.ts)).
On a real TTY the re-exec'd child is **orphaned** — it loses the terminal
foreground group, so the next `claude` it spawns with `stdio: "inherit"` reads
EOF and instantly exits, producing a claim → exit → reclaim spin loop. Issue
**#42 disabled self-restart by default** behind the `DFL_WORKER_SELF_RESTART=1`
opt-in guard ([maybeRestartForUpgrade, :1131](../../apps/cli/src/application/claude-worker.service.ts))
and explicitly deferred a "TTY-safe relauncher" to this spike (#37).

The root cause is structural: **the process that owns the terminal is the same
process that must be replaced to adopt new code.** You cannot replace it without
abandoning the terminal. The fix is to _split_ those two responsibilities.

### Identity is ephemeral

`workerId` is minted with `randomUUID()` at field-init
([claude-worker.service.ts:181](../../apps/cli/src/application/claude-worker.service.ts))
and **never persisted**. It is the only identity thread from worker → spawned
session → DB validation: it is interpolated into the prompt as `{{workerId}}`
([worker-task-prompt.ts](../../apps/cli/src/prompts/worker-task-prompt.ts)) and
validated server-side in
[load-task-session.ts:136](../../packages/tracking/src/operations/tasks/load-task-session.ts)
(`queueEntry.workerId !== workerId`) and `end_worker_session`. Because resume
keys on `findClaimByWorker(workerId)`, a restarted process is a **stranger** —
same-worker resume is impossible; only stale-heartbeat reclaim by _any_ worker
recovers an in-flight task. The worker **name** is already stable (`--name` or
`getNextWorkerName()` → "worker-1",
[local-worker-queue-db.ts](../../packages/local-workers/src/local-worker-queue-db.ts)),
but the **id** — the value everything keys on — is not.

### Prior art — `~/code/as.platform.t3`

`as.platform.t3` (the `ascli` deployment CLI) has **no** always-on supervisor
loop, **no** live IPC control channel, **no** automatic new-version detection
loop, and **no** mid-task child swap — so those pieces are greenfield for us. But
it has four battle-tested mechanisms that map directly onto what this ADR needs,
and each carries a concrete lesson:

1. **Fork a fresh child to run a _different_ code version; never run it
   in-process** (`workload-process-runner-proxy.ts`, `workload-ascli.ts`). Two
   copies of a versioned dependency collide in-process; version isolation is the
   legitimate reason for a replaceable child.
2. **Fresh process per replacement, never a reset** — an in-process retry loop
   cached the empty ESM module from the first attempt and computed a _destructive_
   diff. The fresh-process invariant is what made recovery correct. This is the
   single most load-bearing lesson.
3. **Identity = a UUID minted once by the root and inherited via env var**
   (`AS_RUN_ID`, `run-id.ts`). A respawned child reuses it and is recognized as
   "us." Stable across restarts, DI-seamed for tests, exported only at the spawn
   site.
4. **Re-exec at process _start_, before any work, preserving context through env**
   (`self-delegate.ts`). The upgrade/heal command itself must run on the **new**
   code (it is exempt from delegation — otherwise the _older_ pinned binary does
   the healing, defeating the point). Guard against re-exec loops by comparing
   real paths.
5. **Graceful-then-forced replacement with a grace timer**, and force-exit rather
   than rely on clean shutdown when a child may hold the event loop open
   (`pulumi.ts` watchdog, `workload-process-runner.ts`).
6. **A polled DB heartbeat row stands in for a control channel**
   (`env-activity.ts`, `env-activity-handle.ts`): liveness via `last_seen` + a
   stale threshold, "stop/displace" directives via row replacement detected at the
   next heartbeat (conditional on a `runner_id` token), and clean SIGINT/SIGTERM
   release. Long pauses _should_ look like death by design.
7. **Wire intent in / typed result out over files, with inherited stdio for live
   logs** — decouples the parent from the child's stdout so machine output and
   human logs don't collide.

### What exists to build on

- **`DflUpgradeDetector`**
  ([dfl-upgrade-detector.ts](../../apps/cli/src/infrastructure/dfl-upgrade-detector.ts))
  — pure, mtime-gated detection of an installed-version change; `installedBundlePath`
  is the re-exec target; `isUpgrade()` is static/pure (returns false on null/equal
  to guard thrash). Reusable as-is.
- **`buildReExecArgs`**
  ([claude-worker.service.ts:88](../../apps/cli/src/application/claude-worker.service.ts))
  — reconstructs argv, re-fencing `claudeArgs` behind `--` (#38/#36). Reusable.
- **`WorkerQueueDb`**
  ([worker-queue-db.ts](../../packages/dispatch/src/worker-queue-db.ts)) —
  `registerWorker/updateHeartbeat/updateStatus/claimTask/findClaimByWorker/setClaudeDone`;
  schema at [schema.ts](../../packages/local-workers/src/schema.ts). Heartbeat (#28)
  is `updateHeartbeat(workerId, pid)` every 5 s; liveness via
  [isWorkerAlive, worker.ts:114](../../packages/dispatch/src/worker.ts).
- **`claudeDone` flag** — the only "child is done" signal: `claude` calls
  `end_worker_session` (MCP) which sets `claudeDone`; the worker polls it
  ([taskWatchInterval, :995](../../apps/cli/src/application/claude-worker.service.ts)).
  There is **no IPC to the child** today.

## Inventory

Legend — **Side after split:** 🟦 Supervisor (frozen) · 🟧 Runner (hot) ·
⬜ unchanged/shared.

| Responsibility (today, in `ClaudeWorkerService`) | Code                                                                                      | Side after split        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------- |
| Mint / own identity                              | `workerId = randomUUID()` [:181](../../apps/cli/src/application/claude-worker.service.ts) | 🟦 (now persisted)      |
| Register / unregister worker                     | `registerWorker`                                                                          | 🟦                      |
| Heartbeat loop (#28)                             | `startHeartbeat` 5 s                                                                      | 🟦                      |
| Status transitions (#28)                         | `updateStatus`                                                                            | 🟦 (extended)           |
| Own TTY / title arbitration (#23)                | `titleAssertInterval` [:991](../../apps/cli/src/application/claude-worker.service.ts)     | 🟦                      |
| Upgrade detection (#27/#38)                      | `maybeRestartForUpgrade` [:1125](../../apps/cli/src/application/claude-worker.service.ts) | 🟦                      |
| Re-exec / replacement                            | `reExec` [:1165](../../apps/cli/src/application/claude-worker.service.ts)                 | 🟦 (becomes child-swap) |
| Poll loop / claim task                           | `startPolling` [:508](../../apps/cli/src/application/claude-worker.service.ts)            | 🟧                      |
| Availability / dependency gate                   | `tryClaimTask` [:544](../../apps/cli/src/application/claude-worker.service.ts)            | 🟧                      |
| Worktree resolve, prompt build                   | `workOnTask`                                                                              | 🟧                      |
| Spawn & watch `claude`                           | `spawnClaudeSession` [:958](../../apps/cli/src/application/claude-worker.service.ts)      | 🟧                      |
| Watch `claudeDone`, complete                     | `taskWatchInterval` [:995](../../apps/cli/src/application/claude-worker.service.ts)       | 🟧                      |
| Control-directive intake (#29)                   | ❌ none                                                                                   | 🟦 (greenfield)         |

> **⚠️ `worker-queue.db` is SQLite-only.** `packages/local-workers/src/` contains
> only `schema.ts` — there is **no `schema-pg.ts`** anywhere in `packages/`
> (confirmed). The CLAUDE.md "update BOTH schemas" rule governs the
> _tracking/workflow_ DBs (`DataSourceProvider`, SQLite + Postgres). The worker
> queue is a single-host coordination store and never runs on Postgres, so schema
> additions here touch **one file**.

## Decision

### Scope of this spike

Define the supervisor/runner cut, the durable-identity model, the
replaceable-child lifecycle that replaces the #42-disabled orphan loop, the
control-channel recommendation (#29), the version-watch wiring (incorporating
#27/#38), the status/version reporting fields (#28 extension), and the roadmap.
No code is migrated here.

### The cut: Hot Spot / Frozen Spot along a DDD boundary

Two natural domain concepts are tangled in one class. We separate them along the
axis the 60-80% rule cares about — **what changes, and what stays put:**

- **`WorkerSupervisor` (Frozen Spot — 🟦):** the long-lived host. It is the
  _stable_ identity and the _stable_ terminal owner. It rarely changes shape: it
  mints identity once, heartbeats, owns the TTY, watches for new code, and
  spawns/kills/replaces exactly one child at a time. It is the **host** in a
  classic host/strategy split.
- **`TaskRunner` (Hot Spot — 🟧):** the replaceable, per-task strategy. It claims
  one task, builds the prompt, spawns and watches one `claude`, reports the
  result, and exits at the task boundary. This is where ~all future
  task-execution behavior lands. It runs in a **forked child process** so it can
  be a _different code version_ than the supervisor (prior art 1) and is always a
  **fresh process per task/replacement** (prior art 2 — never reset, never
  reused).

This is the abstraction-first payoff: a change to _how a task is executed_ lands
in `TaskRunner` only; a change to _worker lifecycle/identity/upgrade_ lands in
`WorkerSupervisor` only. The current monolith forces both kinds of change into one
1235-line file. After the cut, the next task-execution feature touches **one**
file — the 60-80% rule satisfied.

#### Domain objects / classes

| Name                   | Location                                                                                      | Role                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `WorkerSupervisor`     | `apps/cli/src/application/` (supervisory half of `ClaudeWorkerService`)                       | 🟦 Frozen host. Owns identity, TTY, heartbeat, version-watch, child lifecycle, directive intake. |
| `TaskRunner`           | `apps/cli/src/application/` (execution half)                                                  | 🟧 Hot strategy. One task → one `claude` → result → exit. Runs as a forked child.                |
| `WorkerIdentity`       | `packages/dispatch/src/` (domain)                                                             | Value object `{ workerId, name }`. Minted once, persisted, inherited by the runner.              |
| `WorkerIdentityStore`  | `apps/cli/src/infrastructure/`                                                                | Reads/writes the persisted identity file under `DFL_HOME`. DI-seamed for tests.                  |
| `RunnerHandle`         | `apps/cli/src/application/`                                                                   | Supervisor-side wrapper over the forked child: lifecycle state, spawn/graceful-kill/force-kill.  |
| `WorkerControlChannel` | `packages/dispatch/src/` (interface) + impl in `local-workers`                                | Orchestrator → supervisor directive intake (DB-polled).                                          |
| `DflUpgradeDetector`   | existing [dfl-upgrade-detector.ts](../../apps/cli/src/infrastructure/dfl-upgrade-detector.ts) | **Reused unchanged** as the supervisor's version-watch component.                                |

#### The narrow interface between supervisor and runner

The supervisor↔runner contract is intentionally tiny (prior art 7 — _intent in /
typed result out, inherited stdio for live logs_):

- **Intent in:** the supervisor forks the runner via `child_process.fork()` with
  the task identity passed through **env** (`DFL_WORKER_ID`, `DFL_WORKER_NAME`,
  optionally `DFL_TASK_ID` for a targeted dispatch). `stdio` for fds 0–2 is
  **inherited** (the supervisor holds the foreground; the runner draws to it).
  `fork()` adds a 4th **IPC channel** for free.
- **Typed result out:** the runner reports a `RunnerResult`
  (`{ outcome: "completed" | "abandoned" | "failed" | "drained", taskId, detail }`)
  over the IPC channel before exiting. The supervisor never parses logs to learn
  the outcome.
- **Directive down (supervisor→runner):** a `RunnerDirective` (`drain`, `stop`)
  over the same IPC channel; falls back to `SIGTERM` → `SIGKILL` if the child is
  unresponsive (prior art 5).

This is the **one** seam. Everything the runner needs arrives as env + one IPC
message; everything the supervisor needs back is one typed result.

### Persisted, restart-stable identity

**Decision: identity is minted once by the supervisor, persisted to a file under
`DFL_HOME`, and inherited by the runner via env** (the `AS_RUN_ID` pattern, prior
art 3).

Reconciling name vs id:

- The **name** is the human handle and the _slot key_ (`worker-1`). It is the
  file's lookup key.
- The **workerId** (UUID) stays the machine identity and the
  **prompt/validation thread** — we do **not** change the `{{workerId}}` contract
  or the `queueEntry.workerId !== workerId` check at
  [load-task-session.ts:136](../../packages/tracking/src/operations/tasks/load-task-session.ts).
  We only make the _value_ durable.

**Where persisted:** `<DFL_HOME>/workers/<name>.json` →
`{ workerId, name, createdAt }`, owned by `WorkerIdentityStore`. Chosen over (a) a
DB row, because the DB row is _liveness_ state that gets cleaned up when stale
(identity must outlive death), and over (b) env-only, because the _first_
supervisor start has nothing to inherit. The file is the source of truth; the DB
row is a projection of it.

**Mint-once / reuse:** on supervisor start, `WorkerIdentityStore.resolve(name)`:

1. `--name` given and `<name>.json` exists → reuse its `workerId`.
2. `--name` given and no file → mint `randomUUID()`, write the file.
3. No `--name` → `getNextWorkerName()`, then mint + write.

A restarted supervisor with the same name is now **recognized as "us"**:
`findClaimByWorker(workerId)` finds its own in-flight claim and the runner can
**resume** the task instead of being a stranger. This directly fixes the
"restart = stranger" defect.

**Threading to the runner + `claude`:** supervisor → runner via env
`DFL_WORKER_ID`; the runner injects it into the prompt as `{{workerId}}` exactly
as today and passes it to `claimTask(workerId)`. Because the claim and the prompt
now carry the _same persisted_ id, the server-side
`load_task_session`/`end_worker_session` validation **keeps working unchanged** —
the value is simply stable across restarts.

### Replaceable child lifecycle (replaces the #42 orphan loop)

The supervisor **stays in the foreground forever** and owns the TTY (it keeps the
#23 title arbitration). It never re-execs itself to adopt a _runner_ upgrade;
instead it **swaps the child under it**:

1. Supervisor holds the terminal foreground group.
2. Supervisor `fork()`s a `TaskRunner` child with inherited stdio. The child draws
   to the supervisor's terminal, but the supervisor remains the session leader.
3. To replace the runner (upgrade, drain, stop): supervisor sends `drain`
   (graceful) and starts a **grace timer**; at expiry it escalates `SIGTERM` →
   `SIGKILL` (prior art 5 — _force-exit rather than rely on clean shutdown_). The
   runner replaces **at a task boundary**, never mid-`claude`.
4. Supervisor forks a **brand-new** runner (never resets the old one — prior art 2,
   the most load-bearing lesson).

This eliminates the orphan: the **child** is the disposable one, and it never
owned the terminal in the first place, so killing/replacing it cannot strand a
foreground group. The supervisor — which _does_ own the TTY — is exactly the
process we never have to replace for a runner upgrade. **This is the structural
fix that lets #42's `DFL_WORKER_SELF_RESTART` guard be removed.**

#### Lifecycle states

- **Supervisor (`SupervisorState`):** `STARTING → IDLE → SPAWNING_RUNNER → RUNNING
→ DRAINING → REPLACING → (IDLE | STOPPING | UPGRADING_SELF) → STOPPED`.
- **Runner (`RunnerState`):** `CLAIMING → WORKING → REPORTING → EXITED`, plus
  `DRAINING` (finish current task, then exit) and `ABORTING` (forced stop).

`REPLACING`, `DRAINING`, and `UPGRADING_SELF` are the richer states #28 must
report (see below).

### Control channel (#29) — recommendation

There are **two distinct hops**; conflating them is the trap:

- **Hop A — orchestrator → supervisor** (cross-process, cross-host-capable). A
  `dfl` command (or the MCP server) tells a running, possibly remote-terminal
  worker to drain/stop/upgrade. The two processes share no parent-child link.
- **Hop B — supervisor → runner** (parent-child, same host). The supervisor
  controls its own forked child.

**Recommendation for Hop A: DB-polled directive rows in `worker-queue.db`.**
Rationale rooted in the existing architecture and prior art:

- Reuses `WorkerQueueDb` / the existing single-host store — **no new transport**,
  no socket/FIFO lifecycle to manage, no new failure mode.
- **Consistent with the current poll architecture** — the supervisor already runs
  a timed loop and already polls `claudeDone` and heartbeat; a directive poll is
  the same shape.
- **Matches prior art 6** exactly: a polled DB row standing in for a control
  channel, conditional on a token, detected at the next tick — validated in
  production in `as.platform.t3`.
- A local socket/FIFO buys lower latency we don't need (directives are
  operational, not hot-path) at the cost of a brand-new infra surface that doesn't
  fit the DB-centric design. **Rejected.**

**Recommendation for Hop B: the `fork()` IPC channel + signal escalation.** The
supervisor already has a typed channel to its child for free; use it for
`RunnerDirective`, with `SIGTERM` → `SIGKILL` as the guaranteed backstop.

#### Directive enum (`WorkerDirectiveType`, Hop A)

| Directive             | Effect                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `DRAIN`               | Finish current task at the boundary, then go `IDLE` (or exit if also `STOP`).                 |
| `STOP`                | Drain, then terminate the supervisor cleanly.                                                 |
| `RESTART_FOR_UPGRADE` | Adopt the installed build now (runner-swap and/or self-re-exec) at the boundary.              |
| `MESSAGE_TO_SESSION`  | Deliver a human/orchestrator note into the active `claude` session (best-effort; roadmapped). |
| `DISPATCH_TASK`       | Hint a specific `taskId` to claim next (targeted dispatch; roadmapped).                       |

Persisted as a `worker_directives` row keyed by `workerId` with a monotonic
`directiveSeq`, so the supervisor only acts on directives newer than the last one
it consumed (the "conditional on a token, detected at the next tick" pattern from
prior art 6).

### Version-watch + re-exec/restart

The supervisor owns version-watch using **`DflUpgradeDetector` as an injected
component** (incorporating #27/#38 wholesale, not redoing it). Two distinct
upgrade kinds:

- **Runner-version upgrade (the common case).** The supervisor calls
  `detectUpgrade()` at each idle/boundary tick (mtime-gated, cheap). On a hit it
  does **not** touch itself — it kills the current runner at the task boundary and
  forks a fresh runner whose bundle is the newly-installed `installedBundlePath`.
  New code runs in the child; the terminal-owning supervisor is untouched. This is
  the swap that replaces the broken `reExec`.
- **Supervisor-version upgrade (rare).** If the _supervisor's own_ binary must
  change (e.g. the supervision protocol itself changed), the supervisor re-execs
  **itself** at a fully-idle boundary using the existing `buildReExecArgs` + the
  same grace-window handoff. Because identity is now persisted, the re-exec'd
  supervisor reuses its `workerId` and is recognized as "us" — no stranger
  problem. Prior art 4 applies: the upgrade is decided at a boundary before work;
  the upgrade command runs on the **new** code and is exempt from delegation;
  guard against re-exec loops by comparing real paths (already the spirit of
  `isUpgrade` returning false on equal versions).

Default policy: prefer runner-swap (cheap, no terminal handoff). Self-re-exec only
when the supervisor contract changed — gated behind an explicit signal so the
dangerous path is rare and deliberate.

### Status + version reporting (extends #28)

New fields on the `workers` row
([schema.ts](../../packages/local-workers/src/schema.ts)) and the `Worker` domain
type ([worker.ts](../../packages/dispatch/src/worker.ts)):

| Field             | Type           | Meaning                                                                                   |
| ----------------- | -------------- | ----------------------------------------------------------------------------------------- |
| `running_version` | text           | Supervisor's `runningVersion` (`__DFL_VERSION__`); lets the orchestrator see who's stale. |
| `runner_version`  | text, nullable | The forked runner's version (may differ from the supervisor during a swap).               |
| `lifecycle_state` | text           | `SupervisorState` incl. `REPLACING` / `DRAINING` / `UPGRADING_SELF`.                      |
| `current_task_id` | text, nullable | The task the runner is on (today inferred via join; make it explicit).                    |
| `progress_note`   | text, nullable | Latest progress tick (extends the file-only `progressTick`).                              |

`WorkerStatus` ([worker.ts](../../packages/dispatch/src/worker.ts)) gains
`RESTARTING`/`REPLACING` or is superseded by `lifecycle_state`. **Schema impact:
`packages/local-workers/src/schema.ts` only** (SQLite — see the ⚠️ in Inventory).
The `WorkerQueueDb` interface gains `updateVersion`, `updateLifecycleState`,
`updateProgress`, and directive ops (`postDirective`, `pollDirectives`,
`ackDirective`).

### Mapping shipped + open issues

- **#27/#38 (shipped):** incorporated as the `DflUpgradeDetector` component the
  supervisor calls; `buildReExecArgs` reused for the rare self-re-exec. **Not
  redone.**
- **#42 (disabled flag):** the supervisor's child-swap _is_ the "TTY-safe
  relauncher" #42 deferred. Once the supervisor lands, `DFL_WORKER_SELF_RESTART`
  is removed and self-restart-by-default returns — safely, because the swap no
  longer orphans a terminal owner.
- **#29 (messaging):** becomes the `WorkerControlChannel` (Hop A, DB-polled
  directives) + the runner IPC (Hop B). Greenfield, sequenced below.
- **#33 (`dfl upgrade`/`update`):** becomes an orchestrator that posts a
  `RESTART_FOR_UPGRADE` directive (Hop A) to live supervisors after installing the
  new bundle, so updates propagate without a manual restart — the operator-facing
  front-end to version-watch.

### Conventions (frozen spots)

- Identity = persisted-once UUID + stable name; inherited via env to the child;
  the `{{workerId}}` prompt/validation contract is unchanged.
- The supervisor owns the TTY for life; only the child is ever replaced for a
  runner upgrade.
- Control = DB-polled directive rows (Hop A) + fork IPC/signals (Hop B).
- Fresh process per replacement — never reset, never reuse a runner.

### Extensions (the new logic — the ~20–40%)

`WorkerSupervisor`, `TaskRunner`, `RunnerHandle`, `WorkerIdentityStore`,
`WorkerControlChannel`, the directive enum, and the new `workers`-row fields.
Everything else (`DflUpgradeDetector`, `buildReExecArgs`, `WorkerQueueDb`
claim/heartbeat, the prompt resolver, MCP validation) is reused.

## Gaps

| Gap                                                       | Needs                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foreground-group guarantee for `fork()` + inherited stdio | Verify on macOS/Linux that a forked child with inherited stdio keeps the supervisor as session leader and the child reaches `claude` without EOF (the exact failure #42 hit). Spike a smoke test; fall back to an explicit pty/`stdio` array if not. |
| Runner-resume semantics on supervisor restart             | Decide whether a fresh supervisor that finds its own live claim resumes the _same_ `claude` session or starts a new one (claudeDone-aware). Confirm `load_task_session`'s resume path covers it.                                                     |
| `MESSAGE_TO_SESSION` delivery                             | No mechanism exists to inject text into a running `claude` stdin under `stdio:"inherit"`. May require a stdio redesign — defer.                                                                                                                      |
| Directive cleanup / TTL                                   | `worker_directives` rows need a retention/ack policy so consumed directives don't re-fire.                                                                                                                                                           |
| Self-re-exec trigger signal                               | Define exactly what marks an upgrade as "supervisor-contract-changed" vs "runner-only."                                                                                                                                                              |
| `getNextWorkerName()` collision under concurrent starts   | Identity-file mint should guard against two supervisors grabbing the same name simultaneously.                                                                                                                                                       |

## Roadmap (follow-up issues)

1. **Persisted worker identity** — `WorkerIdentity` + `WorkerIdentityStore`
   (`<DFL_HOME>/workers/<name>.json`), mint-once/reuse, env-inherited. Keeps
   `{{workerId}}` + `load_task_session` validation intact.
2. **Extract `TaskRunner`** — move claim/availability/worktree/prompt/spawn/watch
   off the monolith into a child-process-runnable runner; typed `RunnerResult`
   out, env `DFL_WORKER_ID` in. _Depends on 1._
3. **`WorkerSupervisor` + `RunnerHandle`** — long-lived host owning identity,
   heartbeat, TTY, and the fork/kill/replace lifecycle; fresh-process-per-replacement.
   _Depends on 2._
4. **Version-watch child-swap** — supervisor drives `DflUpgradeDetector` to swap
   the runner onto new code at a boundary; rare self-re-exec via `buildReExecArgs`.
   _Depends on 3._
5. **Re-enable self-restart / remove #42 guard** — delete
   `DFL_WORKER_SELF_RESTART`, default-on, now TTY-safe. _Depends on 4._
6. **Status + version reporting (#28 ext)** — add `running_version`,
   `runner_version`, `lifecycle_state`, `current_task_id`, `progress_note` to
   `schema.ts` + `WorkerQueueDb` ops. _Depends on 3._
7. **Control channel Hop A (#29)** — `worker_directives` table +
   `WorkerControlChannel`; supervisor polls/acks `DRAIN`/`STOP`/`RESTART_FOR_UPGRADE`.
   _Depends on 3 and 6._
8. **`dfl upgrade`/`update` orchestrator (#33)** — install new bundle, then post
   `RESTART_FOR_UPGRADE` to live supervisors. _Depends on 7 and 4._
9. **`MESSAGE_TO_SESSION` / `DISPATCH_TASK`** — stretch directives. _Depends on 7._

## Consequences

### Positive

- The next task-execution change touches **one file** (`TaskRunner`); the next
  lifecycle change touches one (`WorkerSupervisor`) — the abstraction-first win the
  monolith blocks.
- TTY-safe by construction: the terminal owner is never the process being
  replaced, killing the #42 spin loop at the root.
- Restart-stable identity enables true same-worker resume and accurate fleet
  status.
- Reuses every shipped component (`DflUpgradeDetector`, `buildReExecArgs`,
  `WorkerQueueDb`); no new transport.

### Negative / cost

- A worker is now **two processes**; debugging and log correlation span supervisor
  - runner.
- `fork()` + inherited-stdio foreground behavior must be proven on real TTYs before
  relying on it (Gap) — it is the exact mechanism #42 broke on.
- `worker-queue.db` schema and the `WorkerQueueDb` interface grow; directive rows
  need lifecycle management.

### Neutral

- `worker-queue.db` stays SQLite-only — no Postgres mirror needed, unlike
  tracking-DB changes.
- The `{{workerId}}` prompt contract and server-side validation are unchanged; only
  the value's durability changes.

## References

- [claude-worker.service.ts](../../apps/cli/src/application/claude-worker.service.ts)
  — monolith: identity :181, buildReExecArgs :88, poll :508, claim :544, spawn
  :958, taskWatch :995, upgrade-detect :1125, reExec :1165
- [dfl-upgrade-detector.ts](../../apps/cli/src/infrastructure/dfl-upgrade-detector.ts)
  — reused version-watch component
- [worker-queue-db.ts](../../packages/dispatch/src/worker-queue-db.ts) /
  [worker.ts](../../packages/dispatch/src/worker.ts) — queue interface + domain,
  `isWorkerAlive` :114
- [schema.ts](../../packages/local-workers/src/schema.ts) — SQLite-only
  worker/queue schema (no `schema-pg.ts`)
- [local-worker-queue-db.ts](../../packages/local-workers/src/local-worker-queue-db.ts)
  — `getNextWorkerName`, queue impl
- [load-task-session.ts:136](../../packages/tracking/src/operations/tasks/load-task-session.ts)
  — `queueEntry.workerId !== workerId` validation
- [worker-task-prompt.ts](../../apps/cli/src/prompts/worker-task-prompt.ts) —
  `{{workerId}}` injection
- [worker-command.ts](../../apps/cli/src/commands/worker-command.ts) /
  [main.ts:90](../../apps/cli/src/main.ts) — construction + `dfl claude` entry
- Prior art: `~/code/as.platform.t3` — `run-id.ts` (identity via env),
  `self-delegate.ts` (re-exec on new version), `workload-process-runner-proxy.ts`
  / `workload-ascli.ts` (replaceable child), `env-activity.ts` /
  `env-activity-handle.ts` (DB-row heartbeat + directive)
