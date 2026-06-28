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
 * IMPORTANT: keep this text byte-identical to the previously inlined prompt
 * (modulo `${...}` → `{{...}}`). Content changes belong in a separate issue.
 */

export const WORKER_TASK_PROMPT_NAME = "worker-task";

export const WORKER_TASK_PROMPT_DEFAULT = `You are running as a worker process for dev-workflow. A task has been dispatched to you.

**WORKER ID: {{workerId}}**

Start working on task #{{issueNumber}}.{{taskNumber}} (ID: {{taskId}}).

## Agent-First Workflow

**USE AGENTS AGGRESSIVELY.** Spawn Task agents to parallelize work and catch issues early:

### At Task Start (REQUIRED)
Before writing ANY code, spawn a **Plan agent** to:
- Analyze the task requirements and acceptance criteria
- Research the codebase for relevant patterns, existing implementations
- Identify files to modify, dependencies, potential risks
- Propose an implementation approach

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

## Task Lifecycle

Use the dfl-worker-task skill to work through the lifecycle:

1. Load the task with load_task_session
   - **CRITICAL: You MUST pass workerId="{{workerId}}" to load_task_session**
2. Spawn Plan agent to research and plan approach
3. Implement the task according to plan
4. Spawn Adversarial Review agent before PR
5. Create PR and submit for review
6. WAIT for the PR to be merged (check with get_task_pr_status)
7. Once merged, call complete_task with a finalLogEntry summary

**REMINDER: When calling load_task_session, include workerId="{{workerId}}"**

The user is monitoring this worker session and can respond to your prompts.

A task is only complete when it reaches COMPLETED status (PR merged and complete_task called), not when it enters PR_REVIEW.`;
