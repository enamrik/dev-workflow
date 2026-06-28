# ADR-004: Prompt Organization & Disk-Editability

## Status

Proposed (spike deliverable for issue #17 — decision + roadmap, no migration performed)

## Context

dev-workflow drives Claude sessions with prompts. The goal of #17 is that
**every LLM prompt should be editable from disk** — overridable by an operator
without rebuilding the bundle — the way the worker-task prompt became editable in
#9 via the `PromptResolver`.

Today only that one prompt goes through the resolver. This ADR records:

1. A full **inventory** of prompts (what's editable today, what isn't).
2. A **scope decision** (what counts as a "prompt" for this effort).
3. The recommended **official organization + format** (extend #9's resolver).
4. **Gaps** and a **roadmap** of follow-up issues.

### What #9 gave us (the baseline)

`PromptResolver` — [apps/cli/src/prompts/prompt-resolver.ts](../../apps/cli/src/prompts/prompt-resolver.ts):

- Named prompts resolved by **precedence, first match wins**:
  1. Per-repo override: `<gitRoot>/.dfl/prompts/<name>.md`
  2. Shared override: `<DFL_HOME or ~/.dfl>/prompts/<name>.md`
  3. Shipped default: the embedded string passed to `resolve()`.
- `{{key}}` placeholder interpolation — plain string substitution of **known keys
  only**, no eval; unknown text left intact.
- `candidatePaths(name, gitRoot)` exposes exact override paths for docs/tooling.

The only prompt wired through it is **worker-task**
([apps/cli/src/prompts/worker-task-prompt.ts](../../apps/cli/src/prompts/worker-task-prompt.ts)),
resolved at [claude-worker.service.ts:798](../../apps/cli/src/application/claude-worker.service.ts).

## Inventory

Legend — **Editable today?**: ✅ via resolver · ⚠️ on disk but clobbered on
update · ❌ hardcoded in the bundle.

### Real LLM prompts (full natural-language instructions sent to a model)

| Prompt             | Location (file:symbol)                                                                                                                                                                            | What it does                                                                                                                   | Editable today?             | Placeholders                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **worker-task**    | [apps/cli/src/prompts/worker-task-prompt.ts](../../apps/cli/src/prompts/worker-task-prompt.ts) → `WORKER_TASK_PROMPT_DEFAULT`                                                                     | The session prompt a worker hands to its spawned `claude` process; defines the agent-first workflow + lifecycle.               | ✅ resolver (`worker-task`) | `{{workerId}}`, `{{issueNumber}}`, `{{taskNumber}}`, `{{taskId}}`                                                                                                                                                                   |
| **task-execution** | [packages/tracking/src/operations/tasks/get-task-execution-prompt.ts:71](../../packages/tracking/src/operations/tasks/get-task-execution-prompt.ts) (inline template in `getTaskExecutionPrompt`) | Prompt returned by the `get_task_execution_prompt` MCP tool — issue/plan/task context + execution instructions for a subagent. | ❌ hardcoded                | `${task.order}`, `${issue.number}`, `${issue.title}`, `${issue.description}`, issue/task acceptance criteria, `${plan.approach}`, `${task.title}`, `${task.description}`, `${task.implementationPlan}`, `${taskId}`, `${sessionId}` |

### Sub-agent prompts (Plan / Research / Adversarial-Review)

These are **not** separate prompts today — they are prose sections **embedded
inside** `WORKER_TASK_PROMPT_DEFAULT` (the "Agent-First Workflow" block,
worker-task-prompt.ts lines ~30–51), and re-described in the
[dfl-worker-task skill](../../apps/cli/skills/dfl-worker-task/SKILL.md).

- **Editable today?** ✅ but **only coarsely** — an operator can edit them by
  overriding the entire `worker-task.md`. They are not individually addressable,
  not reusable from other contexts, and the skill copy can drift from the prompt
  copy.

### Tool-contract metadata (LLM-facing, but not "prompts")

| Item                                      | Location                                                                                                              | Editable today? | Notes                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| 54 MCP tool `description`s                | [apps/mcp-server/src/tools/tool-definitions.ts](../../apps/mcp-server/src/tools/tool-definitions.ts) (inline strings) | ❌ hardcoded    | The model reads these to pick tools, but they are API contract docs, not operator-tunable prompts. |
| 100+ Zod `.describe()` field help strings | `apps/mcp-server/src/tools/*-tools.ts`                                                                                | ❌ hardcoded    | Parameter help; same character as above.                                                           |

### Skills (Claude Code skill system — a separate mechanism)

- 7 `dfl-*/SKILL.md` files in [apps/cli/skills/](../../apps/cli/skills/)
  (`dfl-work-request`, `dfl-manage-issue`, `dfl-plan-issue`, `dfl-work-task`,
  `dfl-worker-task`, `dfl-configure-github`, `dfl-manage-milestone`).
- **Editable today?** ⚠️ They live on disk at `~/.claude/skills/` but
  [skills-installer.ts](../../apps/cli/src/infrastructure/skills-installer.ts)
  runs `copyDirectory(source, target)` on every `init`/`update`, so **in-place
  edits are overwritten** on the next update. They have an editability story, but
  not a durable one, and it's owned by Claude Code's skill loader — not the
  resolver.

### Out of scope (not operator prompts)

- **Plan generation** is **not** a programmatic LLM call. `generate_plan`
  ([packages/tracking/src/operations/plans/generate-plan.ts](../../packages/tracking/src/operations/plans/generate-plan.ts))
  only **persists** the plan the human Claude session produced (driven by the
  `dfl-plan-issue` skill). There is no embedded prompt to externalize. The repo
  contains **no** Anthropic-SDK call site; the only model invocation is
  `spawn("claude", …)` for the worker (claude-worker.service.ts:826).
- **E2E test prompts** (`packages/e2e/src/scenarios/*.ai.test.ts`) — test
  fixtures, intentionally hardcoded.
- **apps/web** — UI client only; contains no LLM prompts.
- **Issue/task templates** — a separate disk-editable text surface (markdown +
  `{{description}}`/`{{acceptanceCriteria}}` substitution) with its own
  override-precedence resolution and a `*_template` MCP tool set. It is _not_ an
  LLM prompt (it renders GitHub issue/task bodies), so it stays out of this
  inventory — noted here only to record that it was considered and deliberately
  excluded.

## Decision

### Scope of "prompt" for #17

**In scope** (must become disk-editable via the resolver): real LLM prompts and
the sub-agent prompts — i.e. **worker-task** (done), **task-execution**, and the
**Plan / Research / Adversarial-Review** sub-agent prompts.

**Out of scope** for the resolver:

- **MCP tool descriptions + Zod field help** — these are the tool _contract_, a
  150+-string surface read mostly by the model for dispatch, with different
  review/versioning needs than operator prompts. Externalizing them is a separate,
  larger decision; default is to leave them in code. (Revisit only if a concrete
  need to retune tool descriptions without a release appears.)
- **Skills** — already on disk and owned by a different mechanism (Claude Code's
  skill loader). Their real gap is **durability on update**, not
  externalization. Tracked as a separate follow-up, not folded into the resolver.

### Official organization + format: extend #9's `PromptResolver`

The resolver's design (per-repo → shared → embedded-default precedence,
always-works fallback, `{{key}}` interpolation, no eval) is the right foundation.
Adopt it as the **single official mechanism for all in-scope prompts** and extend
it as follows.

**Conventions (frozen spots):**

- **Naming:** kebab-case, one prompt per file, `<name>.md`. Sub-agent prompts use
  a `subagent-` prefix: `subagent-plan`, `subagent-research`,
  `subagent-review`.
- **Layout:** `<gitRoot>/.dfl/prompts/<name>.md` (per-repo) and
  `<DFL_HOME or ~/.dfl>/prompts/<name>.md` (shared) — unchanged from #9.
- **Placeholders:** `{{key}}`, known-keys-only substitution — unchanged.
- **Optional frontmatter** for metadata (version, declared placeholders) — see
  validation below.

**Extensions (the new logic — the ~20–40%):**

1. **Prompt catalog/registry (discoverability + single source of truth).**
   Today a prompt is an ad-hoc `(name, defaultText, vars)` triple wired at each
   call site. Introduce a `PromptCatalog` where each prompt is **declared once**
   (name + embedded default + declared placeholder keys). The resolver consults
   the catalog; the catalog is what makes the full prompt set enumerable. This is
   the abstraction the 60-80% rule points at: adding the next prompt becomes "one
   catalog entry," not "another bespoke call site."

2. **`dfl prompts` CLI** built on the catalog: `list` (all names + override
   paths via `candidatePaths`), `show <name>` (resolved text), `eject <name>
[--shared]` (write the current default to the override path as a starting
   point — operators shouldn't have to know the magic path or hand-create files),
   and `diff <name>` (override vs current shipped default).

3. **First-class sub-agent prompts.** Extract Plan/Research/Adversarial-Review
   into `subagent-*` catalog entries so they are individually editable and
   reusable, and have `worker-task` **compose** them (a simple `{{> subagent-plan}}`
   include resolved through the catalog, or explicit interpolation) so there is
   one source of truth instead of the prompt-copy / skill-copy drift today.

4. **Placeholder validation (`dfl prompts doctor`).** Because interpolation
   silently leaves unknown `{{keys}}` intact, an operator typo (`{{taskID}}`)
   ships a literal placeholder with no warning. Validate edited files against the
   catalog's declared keys and warn on unknown/missing placeholders.

5. **Version / drift detection.** An override pins the prompt to whatever the
   default was when it was ejected; later default improvements are silently
   shadowed. Embed a version/hash in the default and have `doctor`/`diff` flag
   stale overrides.

6. **Operator docs** (docs-site reference page) listing every prompt, its
   placeholders, and its override paths.

This keeps the resolver as the **host** owning the frozen spots (precedence, I/O,
interpolation) and adds the catalog as the narrow new abstraction; no call site
re-implements resolution.

## Gaps (what's not editable and what each needs)

| Gap                                         | Needs                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | ---- | ----- | ------ |
| `task-execution` prompt is hardcoded        | Move template to a `task-execution` catalog entry + resolver; declare its placeholders. |
| Sub-agent prompts not individually editable | Extract as `subagent-*` catalog entries; compose into `worker-task`.                    |
| No way to discover/scaffold prompts         | `PromptCatalog` + `dfl prompts list                                                     | show | eject | diff`. |
| Silent placeholder typos                    | `dfl prompts doctor` validating declared keys.                                          |
| Overrides silently shadow improved defaults | Version/hash + `diff`.                                                                  |
| No operator documentation                   | docs-site prompt reference page.                                                        |
| Skills clobbered on `update`                | (Separate) per-repo skill override layer or non-clobbering update.                      |

## Roadmap (follow-up issues)

1. **Prompt catalog + `dfl prompts` CLI** — foundation (`list`/`show`/`eject`/`diff`). _Enables the rest._
2. **Migrate `task-execution` onto the resolver** — name `task-execution`, declared placeholders. _Depends on 1._
3. **Extract sub-agent prompts** (`subagent-plan`, `subagent-research`, `subagent-review`) + add include/compose support to `worker-task`. _Depends on 1._
4. **Placeholder validation + version/drift detection** (`dfl prompts doctor`). _Depends on 1._
5. **Operator docs** — docs-site reference page for all prompts. _Depends on 2–3._
6. **(Separate) Skill durability** — per-repo override layer or non-clobbering `update` so skill edits survive.
7. **(Deferred) Tool-description externalization** — explicitly out of scope; revisit only on demonstrated need.

## Consequences

### Positive

- One official mechanism for all operator prompts; adding the next prompt is one
  catalog entry.
- Sub-agent prompts become first-class, editable, and drift-free.
- Discoverability (`dfl prompts list`) and safe scaffolding (`eject`) instead of
  magic paths.

### Negative / cost

- New CLI surface and a catalog abstraction to build and document.
- Compose/include adds a small amount of resolver complexity.

### Neutral

- Tool descriptions and skills remain on their current mechanisms; their gaps are
  tracked separately rather than forced into the resolver.

## References

- #9 resolver: [apps/cli/src/prompts/prompt-resolver.ts](../../apps/cli/src/prompts/prompt-resolver.ts)
- worker-task default: [apps/cli/src/prompts/worker-task-prompt.ts](../../apps/cli/src/prompts/worker-task-prompt.ts)
- task-execution prompt: [packages/tracking/src/operations/tasks/get-task-execution-prompt.ts](../../packages/tracking/src/operations/tasks/get-task-execution-prompt.ts)
- skills installer: [apps/cli/src/infrastructure/skills-installer.ts](../../apps/cli/src/infrastructure/skills-installer.ts)
