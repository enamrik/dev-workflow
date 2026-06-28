/**
 * Shipped default template for the "worker-task" prompt — the Claude-session
 * prompt a worker hands to its spawned `claude` process.
 *
 * This is the ULTIMATE FALLBACK used when no override file exists at:
 *   1. <gitRoot>/.dfl/prompts/worker-task.md   (per-repo)
 *   2. <DFL_HOME-or-~/.dfl>/prompts/worker-task.md  (shared)
 *
 * Placeholders use `{{key}}` syntax; see {@link PromptResolver}. Supported keys:
 *   {{workerId}}, {{issueNumber}}, {{taskNumber}}, {{taskId}}
 *
 * The "At Task Start" step directs the worker to LOAD and reconcile the existing
 * plan (returned by load_task_session) against current code rather than re-deriving
 * an approach from scratch (issue #8). Operators can override the whole prompt via
 * a per-repo or shared `worker-task.md` file (see {@link PromptResolver}).
 */

export const WORKER_TASK_PROMPT_NAME = "worker-task";

export const WORKER_TASK_PROMPT_DEFAULT = `You are running as a worker process for dev-workflow. A task has been dispatched to you.

**WORKER ID: {{workerId}}**

Start working on task #{{issueNumber}}.{{taskNumber}} (ID: {{taskId}}).

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

## Task Lifecycle

Use the dfl-worker-task skill to work through the lifecycle:

1. Load the task with load_task_session
   - **CRITICAL: You MUST pass workerId="{{workerId}}" to load_task_session**
2. Review the existing plan (returned by load_task_session) against the current code and refine the strategy — do NOT re-plan from scratch
3. Implement the task according to the refined plan
4. Spawn Adversarial Review agent before PR
5. Sync with main (REQUIRED): \`git fetch origin main\`, rebase your task branch onto \`origin/main\`, resolve any conflicts, and re-run make prep — do this before create_pr so the PR is based on current main
6. Create PR and submit for review
7. WAIT for the PR to be merged (check with get_task_pr_status)
8. Once merged, call complete_task with a finalLogEntry summary

**REMINDER: When calling load_task_session, include workerId="{{workerId}}"**

The user is monitoring this worker session and can respond to your prompts.

A task is only complete when it reaches COMPLETED status (PR merged and complete_task called), not when it enters PR_REVIEW.`;
