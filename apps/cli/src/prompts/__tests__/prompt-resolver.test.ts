/**
 * PromptResolver — override precedence + interpolation.
 *
 * Precedence (first match wins): per-repo → shared → embedded default.
 * Shared overrides live under <DFL_HOME>/prompts; tests point DFL_HOME at a
 * temp dir so they never touch real ~/.dfl.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { PromptResolver } from "../prompt-resolver.js";
import { WORKER_TASK_PROMPT_DEFAULT, WORKER_TASK_PROMPT_NAME } from "../worker-task-prompt.js";

const DEFAULT = "default body {{name}}";

/**
 * The exact worker prompt text (with the sample vars substituted). Resolving the
 * embedded default with those vars must equal this — a full-text regression guard
 * for the shipped worker prompt, including the refocused "load + reconcile the
 * existing plan" task-start step (issue #8) and the lifecycle that delegates to the
 * dfl-worker-task skill and ends at end_worker_session() (issue #36).
 */
const EXPECTED_WORKER_PROMPT = `You are running as a worker process for dev-workflow. A task has been dispatched to you.

**WORKER ID: worker-7**

Start working on task #12.3 (ID: task-abc).

## Agent-First Workflow

**USE AGENTS AGGRESSIVELY.** Spawn Task agents to parallelize work and catch issues early:

### At Task Start (REQUIRED)
A plan ALREADY EXISTS for this task — \`load_task_session\` returns its approach and
per-task implementation plan. Do NOT re-plan from scratch. Before writing ANY code,
spawn a **Plan agent** to:
- Pull down the existing plan (the plan-time approach + implementation plan) and the task's acceptance criteria
- Read the CURRENT code in the files the plan targets
- Reconcile the plan against what changed since it was written (new files, merged dependencies, drift) and update the strategy accordingly
- Surface any step that no longer fits BEFORE implementing
The output is a refined, validated execution strategy that builds on the existing plan — not a fresh re-derivation.

### During Implementation
When discoveries diverge from the plan (new complexity, unexpected patterns):
- Spawn a **Research agent** to investigate the new finding
- Update your approach based on findings before continuing
- Don't barrel forward with a broken mental model

### Before PR Submission (REQUIRED)
Spawn an **Adversarial Review agent** to:
- Review all changes as a skeptical code reviewer
- Check for edge cases, error handling, security issues
- Verify acceptance criteria are actually met
- Identify anything that might fail in review

### Sync With Main Before PR (REQUIRED)
Before creating the PR, sync your task branch with the latest main so the PR is based on current main and merges cleanly:
- Commit your work first — rebase fails on a dirty tree
- \`git fetch origin main\`
- Rebase your task branch onto \`origin/main\` (rebase, NOT merge — main uses squash merges, so a rebased branch squash-merges cleanly)
- Resolve any conflicts now, in-context — you have the change loaded; do not defer them to merge time
- Re-run \`make prep\` after rebasing and confirm it still passes
- Only then create_pr

## Task Lifecycle — Delegate to the Skill

**Your REQUIRED first action: invoke the \`dfl-worker-task\` skill (via the Skill tool).**
It is the single source of truth for the task lifecycle — load, implement, PR, submit
for review, complete, and terminate. Follow it exactly. Do NOT drive the lifecycle from
these instructions, from memory, or from CLAUDE.md; this prompt deliberately does not
restate the steps so it cannot drift from the skill.

**Critical reminder (the skill relies on this):** when you call \`load_task_session\`, you
MUST pass \`workerId="worker-7"\` for task-queue validation.

**Terminal action: \`end_worker_session()\`.** This is your FINAL action — think of it as
\`process.exit()\`. Call it once your one dispatched task reaches a terminal state
(COMPLETED after the PR is merged, or ABANDONED). \`complete_task\` is NOT the end: the
worker process only terminates cleanly after \`end_worker_session()\`. NEVER output text or
call any tool after it.

**Scope = exactly this one task.** Do NOT solicit more work, close issues, or pick up the
next queued task in this session. When your dispatched task is terminal, call
\`end_worker_session()\` and stop.

The user is monitoring this worker session and can respond to your prompts.`;

describe("PromptResolver", () => {
  let dflHome: string;
  let gitRoot: string;
  let prevDflHome: string | undefined;
  let resolver: PromptResolver;

  beforeEach(() => {
    dflHome = mkdtempSync(path.join(tmpdir(), "dfl-home-"));
    gitRoot = mkdtempSync(path.join(tmpdir(), "dfl-repo-"));
    prevDflHome = process.env["DFL_HOME"];
    process.env["DFL_HOME"] = dflHome;
    resolver = new PromptResolver();
  });

  afterEach(() => {
    if (prevDflHome === undefined) {
      delete process.env["DFL_HOME"];
    } else {
      process.env["DFL_HOME"] = prevDflHome;
    }
    rmSync(dflHome, { recursive: true, force: true });
    rmSync(gitRoot, { recursive: true, force: true });
  });

  const writePrompt = (root: string, name: string, body: string): void => {
    const dir = path.join(root, "prompts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${name}.md`), body, "utf-8");
  };

  it("falls back to the embedded default when no override files exist", () => {
    const out = resolver.resolve("worker-task", DEFAULT, { name: "Ada" }, gitRoot);
    expect(out).toBe("default body Ada");
  });

  it("shared override (DFL_HOME/prompts) replaces the default", () => {
    writePrompt(dflHome, "worker-task", "shared {{name}}");
    const out = resolver.resolve("worker-task", DEFAULT, { name: "Ada" }, gitRoot);
    expect(out).toBe("shared Ada");
  });

  it("per-repo override (<gitRoot>/.dfl/prompts) wins over shared", () => {
    writePrompt(dflHome, "worker-task", "shared {{name}}");
    writePrompt(path.join(gitRoot, ".dfl"), "worker-task", "repo {{name}}");
    const out = resolver.resolve("worker-task", DEFAULT, { name: "Ada" }, gitRoot);
    expect(out).toBe("repo Ada");
  });

  it("honors DFL_HOME for the shared location", () => {
    const [shared] = resolver.candidatePaths("worker-task", gitRoot).slice(-1);
    expect(shared).toBe(path.join(dflHome, "prompts", "worker-task.md"));
  });

  it("lists per-repo before shared in candidatePaths", () => {
    const paths = resolver.candidatePaths("worker-task", gitRoot);
    expect(paths).toEqual([
      path.join(gitRoot, ".dfl", "prompts", "worker-task.md"),
      path.join(dflHome, "prompts", "worker-task.md"),
    ]);
  });

  it("omits the per-repo layer when no gitRoot is given", () => {
    const paths = resolver.candidatePaths("worker-task");
    expect(paths).toEqual([path.join(dflHome, "prompts", "worker-task.md")]);
  });

  it("replaces all known placeholders, including repeats", () => {
    const out = resolver.resolve("worker-task", "{{id}} and again {{id}} for {{who}}", {
      id: 7,
      who: "x",
    });
    expect(out).toBe("7 and again 7 for x");
  });

  it("leaves unknown placeholders and surrounding text intact", () => {
    const out = resolver.resolve("worker-task", "keep {{unknown}} and {{name}}", { name: "Ada" });
    expect(out).toBe("keep {{unknown}} and Ada");
  });

  it("coerces numeric vars to strings", () => {
    const out = resolver.resolve("worker-task", "#{{issue}}.{{task}}", { issue: 12, task: 3 });
    expect(out).toBe("#12.3");
  });

  it("worker-task default resolves+interpolates to the expected worker prompt", () => {
    const out = resolver.resolve(
      WORKER_TASK_PROMPT_NAME,
      WORKER_TASK_PROMPT_DEFAULT,
      { workerId: "worker-7", issueNumber: 12, taskNumber: 3, taskId: "task-abc" },
      gitRoot
    );
    expect(out).toBe(EXPECTED_WORKER_PROMPT);
    // Issue #8: the task-start step loads + reconciles the existing plan rather
    // than re-deriving an approach from scratch.
    expect(out).toContain("A plan ALREADY EXISTS");
    expect(out).toContain("Do NOT re-plan from scratch");
    // Issue #34: sync/rebase onto origin/main and re-run make prep before the PR.
    expect(out).toContain("Sync With Main Before PR (REQUIRED)");
    expect(out).toContain("git fetch origin main");
    // Issue #36: the lifecycle delegates to the dfl-worker-task skill as the single
    // source of truth, ends at end_worker_session(), and forbids scope creep — there
    // is no competing inline numbered lifecycle that stops at complete_task.
    expect(out).toContain("invoke the `dfl-worker-task` skill");
    expect(out).toContain("single source of truth");
    expect(out).toContain("end_worker_session()");
    expect(out).toContain("`complete_task` is NOT the end");
    expect(out).toContain("Do NOT solicit more work, close issues, or pick up the");
    expect(out).not.toContain("Once merged, call complete_task with a finalLogEntry summary");
    expect(out).not.toContain("{{");
  });
});
