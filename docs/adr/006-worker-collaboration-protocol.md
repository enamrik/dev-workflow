# ADR-006: Worker Collaboration Protocol

Proposed (design for orchestrator↔worker insight + control; builds on the supervisor, ADR-005).

## Context

dev-workflow runs work as **workers** — long-lived, _interactive_ Claude Code sessions in a
terminal. Two things make them unlike an internal subagent (the `Agent` tool):

1. **They are long-lived and decision-rich.** A worker plans, implements, hits blockers, and
   reacts to review over a long arc — it is not a fire-and-forget call that returns one result.
2. **They are co-piloted.** The user is in the terminal with the worker; the orchestrator
   wants to collaborate with the same session. A worker is a **shared, standing collaborator**,
   not a tool one side owns.

Today the orchestrator is **near-blind and mute**: it can read heartbeats (`tick
status=IN_PROGRESS`) and a worker's git worktree, but not what the worker's claude is doing or
deciding (the conversation is `stdio: "inherit"` to the terminal, captured nowhere). And it
can't steer — the only lever is `pkill` (destructive; it cost lost work and broken TTYs this
session). The supervisor (ADR-005, #46-48) gave us the **chassis** — a long-lived parent that
can own a control channel and report status. This ADR designs the **controls**.

**The reframe:** treat each worker as a crew member with a **mailbox and a status beacon** that
both the user and the orchestrator interact with — not an agent the orchestrator kicks off
internally.

## Decision: three planes on the shared MCP, anchored by the supervisor

The MCP server is already the shared substrate (the orchestrator uses its tools; the
worker-claude uses its tools). Build the protocol there, with the supervisor (#46) as the
process-level control point.

### 1. Status plane — INSIGHT (cooperative self-report)

The worker's reasoning lives in its terminal and **cannot be screen-scraped** — so insight is
_cooperative_: the worker emits a structured **status beacon** at each natural boundary:
`phase` (planning / implementing / prep / pr / addressing-review), `currentActivity`,
`filesTouched`, `blocker?`, `lastDecision`, `nextStep`. The supervisor adds process facts
(version, uptime, child health). The orchestrator reads a **live dashboard** (`get_dispatch_status`
enriched + a per-task activity feed) instead of inferring from heartbeats. (Today the execution
log is literally empty — nothing reports.)

### 2. Control plane — DRIVE (bidirectional, async, request/response)

A per-worker **inbox** on the MCP. The orchestrator posts a directive/question; the
worker-claude **polls it at boundaries, surfaces it in its terminal (so the user sees it too),
acts, and replies back** to the channel the orchestrator reads. Supports **request/response**:
ask → worker answers → orchestrator reads the answer. Message kinds:

- **info** — "FYI, #22 already landed."
- **question** — "what's your plan for #X?", "are you blocked?", "did you notice #Y conflicts?"
- **command** — stop / pause / abandon-superseded / re-plan / address-this-review-comment.

Process-level commands (stop / pause / drain / restart) are executed by the **supervisor** even
when the claude session is mid-tool — it owns the child lifecycle.

### 3. Collaboration plane — the worker is a PEER both sides converse with

A per-worker **crew thread** (in the DB) that the user, the orchestrator, and the worker-claude
all read/write. The worker surfaces orchestrator messages in its terminal; the orchestrator sees
the user's interactions. The sleeper capability is the inverse: **the worker escalates to the
orchestrator, not only the user** — because the orchestrator holds cross-cutting context the
worker and user may lack in the moment (what other workers are touching, the full issue graph,
the conflict map).

## Constraints (honest)

- **Insight is cooperative, not surveillance.** The worker reports meaningful state via MCP; we
  do not capture its raw transcript. This is cleaner (signal, not tokens) but means the protocol
  only works because the worker is _taught_ to participate (its skill/prompt).
- **Latency is bounded by the worker's poll cadence.** Messaging is async; a request/response
  answer arrives at the worker's next boundary, not instantly. Acceptable.
- **The worker must participate.** The skill/prompt must teach it to beacon, poll its inbox,
  answer, and escalate. This is part of the protocol, not optional.

## Value for the orchestrator (why build it)

- **Catch wrong paths mid-task, not post-merge.** #14 shipped an incomplete fix because the
  orchestrator only saw it after merge; a beacon + "did you handle case Z?" intervenes cheaply.
- **Live collision avoidance** replaces the manual pause/serialize dance (#44): the worker
  reports the file it's about to edit; the orchestrator sees the overlap and redirects in real
  time instead of hand-gating the queue.
- **Steer instead of destroy.** Every redirect this session required `pkill`; a directive channel
  ends that.
- **Conduct, not guess.** The orchestrator runs a crew instead of inferring from heartbeats.
- **Cross-cutting escalation.** Workers resolve decisions with the side that has the broader map.

## Roadmap (follow-up issues)

| #   | Plane   | Item                                                                                                                                            | Builds on                      |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | drive   | **Bidirectional control channel** — per-worker inbox + reply + request/response (MCP tools); the highest-leverage first piece                   | expands #29                    |
| 2   | both    | **Worker protocol participation** — skill/prompt teaches the worker to poll its inbox, act, reply, and escalate                                 | extends #36/#40                |
| 3   | insight | **Worker status beacon + orchestrator dashboard** — structured phase/activity/blocker self-report; enriched get_dispatch_status + activity feed | extends #28, log_task_progress |
| 4   | drive   | **Supervisor command execution** — stop/pause/drain/restart executed by the supervisor from the channel                                         | builds on #46                  |
| 5   | collab  | **Crew thread + escalate-to-orchestrator** — shared per-worker conversation; worker escalates decisions to the orchestrator                     | 1 + 2                          |

Build order: **1 → 2** first (the channel + worker participation = "ask a worker / tell it to
stop" working end-to-end), then 3 (insight), then 4/5.

## Consequences

### Positive

- The orchestrator can see, steer, and collaborate with a crew of workers instead of watching pulses.
- Built on the MCP + supervisor we already have — no new transport.

### Negative / cost

- Workers must be taught the protocol (skill/prompt surface grows); a non-participating worker
  is just blind/mute as today (graceful degradation).
- A new messaging/status surface on the MCP + DB to build, document, and test.

### Neutral

- Insight stays cooperative (self-report), so a worker reveals exactly what it chooses to — by
  design, not a limitation to fight.

## References

- Supervisor chassis: docs/adr/005-worker-supervisor.md (#46-48).
- Control channel seed: #29 (to be expanded per plane 1).
- Status surfaces: #28 (compact dispatch status), `log_task_progress` / `get_task_execution_log`.
- Worker prompt/skill: #36 (skill is source of truth), #40 (PR-review loop).
