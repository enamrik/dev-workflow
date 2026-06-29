/**
 * createPR - Create a GitHub PR for a task
 *
 * Validates task state, pushes branch to remote, creates PR on GitHub,
 * and updates task with PR metadata.
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { GitHubCLI } from "@dev-workflow/git/github/github-cli.js";
import { GitWorktreeService } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import type { PRStatus } from "../../domain/tasks/task.js";
import type { IssueType } from "../../domain/issues/issue.js";
import { validateInput } from "../validation.js";
import { EntityNotFoundError, BusinessRuleError } from "../../domain/errors.js";

// =============================================================================
// Schema & Types
// =============================================================================

export const CreatePRSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().optional(),
  body: z.string().optional(),
  draft: z.boolean().optional().default(false),
  baseBranch: z.string().optional(),
  force: z.boolean().optional().default(false),
});

export type CreatePRInput = z.infer<typeof CreatePRSchema>;

export interface CreatePRResult {
  success: boolean;
  adopted?: boolean;
  forced: boolean;
  task: {
    id: string;
    status: string;
  };
  pr: {
    number: number;
    url: string;
    title: string;
    state: "OPEN" | "CLOSED" | "MERGED";
    isDraft: boolean;
    headBranch: string;
    baseBranch: string;
  };
  message: string;
}

// =============================================================================
// Helpers
// =============================================================================

function mapGitHubStateToPRStatus(state: "OPEN" | "CLOSED" | "MERGED", isDraft: boolean): PRStatus {
  if (state === "MERGED") return "MERGED";
  if (state === "CLOSED") return "CLOSED";
  if (isDraft) return "DRAFT";
  return "OPEN";
}

/**
 * Conventional-commit type for a task's {@link IssueType}. semantic-release reads the
 * leading type on the squash-merge subject to decide a version bump: `feat` → minor,
 * `fix` → patch, `chore` → no release (issue #54). Features/enhancements ship behavior
 * (`feat`), bugs ship fixes (`fix`); plain tasks and spikes default to `chore` so they
 * don't force a release on their own.
 */
function commitTypeForTaskType(type: IssueType): "feat" | "fix" | "chore" {
  switch (type) {
    case "FEATURE":
    case "ENHANCEMENT":
      return "feat";
    case "BUG":
      return "fix";
    case "TASK":
    case "SPIKE":
      return "chore";
  }
}

/**
 * Conventional-commit types semantic-release's commit-analyzer recognizes (release-driving
 * `feat`/`fix` plus the non-shipping types of the default angular preset). We honor an
 * explicit prefix only if its type is in this set — an arbitrary `word:` (e.g. `wip:`,
 * `note:`) must NOT be mistaken for a deliberate type, since that would bypass the derived
 * type and could silently suppress the release issue #54 wants.
 */
const KNOWN_COMMIT_TYPES = new Set([
  "feat",
  "fix",
  "docs",
  "chore",
  "refactor",
  "test",
  "perf",
  "build",
  "ci",
  "style",
  "revert",
]);

/** Leading conventional-commit prefix, capturing the bare type, e.g. `feat`, `chore` in `chore(scope)!: `. */
const CONVENTIONAL_PREFIX = /^([a-z]+)(\([^)]*\))?!?:\s/;

/** Any leading `[#<issue>.<task>]` task ref — this task's or a stray one pasted by mistake. */
const LEADING_TASK_REF = /^\[#\d+\.\d+\]\s*/;

/**
 * Build the worker PR/squash title: `<type>: [#<issue>.<task>] <description>`.
 *
 * This is the single source of truth for the format. Two guarantees compose here so a
 * worker (or the prompt/skill) that forgets either piece still produces a correct title:
 *
 *  - **`<type>:` prefix (issue #54)** — lets semantic-release bump a version on every
 *    behavior-changing merge. An explicit *recognized* conventional prefix the worker chose
 *    (any {@link KNOWN_COMMIT_TYPES} type or scope, e.g. `docs:`) is honored; otherwise
 *    (no prefix, or an unrecognized `word:`) the type is derived from `task.type`.
 *  - **`[#N.task]` ref (issue #26)** — maps the PR to a specific task, not just the issue.
 *    Injected right after the type and never duplicated: any leading ref is stripped first.
 *
 * (github-cli passes the result to `gh pr create` verbatim.)
 */
function buildPrTitle(args: {
  issueNumber: number;
  taskNumber: number;
  taskType: IssueType;
  title: string;
}): string {
  const { issueNumber, taskNumber, taskType, title } = args;
  const taskRef = `[#${issueNumber}.${taskNumber}]`;
  const raw = title.trim();

  // Honor an explicit prefix only if it's a recognized conventional type; else derive one
  // from task.type (so an arbitrary `word:` can't silently become a no-release type).
  const prefixMatch = raw.match(CONVENTIONAL_PREFIX);
  const honorExplicit = prefixMatch !== null && KNOWN_COMMIT_TYPES.has(prefixMatch[1]!);
  const typePrefix = honorExplicit ? prefixMatch![0] : `${commitTypeForTaskType(taskType)}: `;
  const afterType = honorExplicit ? raw.slice(prefixMatch![0].length) : raw;

  // Strip any leading ref so the correct one appears exactly once, right after the type.
  const description = afterType.replace(LEADING_TASK_REF, "");

  return `${typePrefix}${taskRef} ${description}`.trimEnd();
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Create a PR for a task.
 *
 * 1. Validate input and resolve services
 * 2. Validate task state (IN_PROGRESS, has branch, no existing PR)
 * 3. Check for existing PR on the branch (adopt if found)
 * 4. Get issue info for PR title
 * 5. Push branch to remote
 * 6. Build PR title and body
 * 7. Create PR on GitHub
 * 8. Update task with PR metadata
 */
export function createPR(input: CreatePRInput) {
  return Effect.gen(function* () {
    const { taskId, title, body, draft, baseBranch, force } = validateInput(CreatePRSchema, input);
    const taskDomainService = yield* TaskDomainService;
    const issueDomainService = yield* IssueDomainService;
    const planDomainService = yield* PlanDomainService;
    const githubCLI = yield* GitHubCLI;
    const gitWorktreeService = yield* GitWorktreeService;

    const task = yield* taskDomainService.findById(taskId);
    if (!task) {
      return yield* Effect.fail(new EntityNotFoundError("Task", taskId));
    }

    if (task.status !== "IN_PROGRESS" && !force) {
      return yield* Effect.fail(
        new BusinessRuleError(
          `Task must be IN_PROGRESS to create a PR. Current status: ${task.status}. ` +
            "Use force=true to bypass this check if the task state has drifted."
        )
      );
    }

    if (!task.branchName) {
      return yield* Effect.fail(
        new BusinessRuleError(
          "Task does not have a branch. Start the task with load_task_session first."
        )
      );
    }

    if (task.prNumber && !force) {
      return yield* Effect.fail(
        new BusinessRuleError(
          `Task already has a PR: #${task.prNumber} (${task.prUrl}). ` +
            "Use get_task_pr_status to check its state, or use force=true to create a new PR."
        )
      );
    }

    // Check if a PR already exists for this branch
    try {
      const existingPR = yield* githubCLI.findPRByBranch(task.branchName!);
      if (existingPR) {
        const prStatus = mapGitHubStateToPRStatus(existingPR.state, existingPR.isDraft);
        yield* taskDomainService.updatePRInfo(taskId, existingPR.url, existingPR.number, prStatus);

        return {
          success: true,
          adopted: true,
          forced: force,
          task: {
            id: taskId,
            status: task.status,
          },
          pr: {
            number: existingPR.number,
            url: existingPR.url,
            title: existingPR.title,
            state: existingPR.state,
            isDraft: existingPR.isDraft,
            headBranch: existingPR.headBranch,
            baseBranch: existingPR.baseBranch,
          },
          message:
            `Found existing PR #${existingPR.number} for branch "${task.branchName}". ` +
            `Adopted PR info. Task status unchanged (${task.status}). ` +
            `Use submit_for_review to transition to PR_REVIEW when ready.`,
        } satisfies CreatePRResult;
      }
    } catch {
      // Ignore errors when checking for existing PR
    }

    // Get issue info for PR title
    const plan = yield* planDomainService.findById(task.planId);
    if (!plan) {
      return yield* Effect.fail(new EntityNotFoundError("Plan", task.planId));
    }

    const issue = yield* issueDomainService.findById(plan.issueId);
    if (!issue) {
      return yield* Effect.fail(new EntityNotFoundError("Issue", plan.issueId));
    }

    // Push the branch to remote
    try {
      const pushResult = yield* gitWorktreeService.run(
        ["push", "-u", "origin", task.branchName!],
        task.worktreePath ?? undefined
      );
      if (!pushResult.success) {
        return yield* Effect.fail(
          new BusinessRuleError(`Failed to push branch: ${pushResult.stderr || pushResult.stdout}`)
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return yield* Effect.fail(new BusinessRuleError(`Failed to push branch: ${message}`));
    }

    // Build PR title: `<type>: [#<issue>.<task>] <desc>` (see {@link buildPrTitle}). The
    // `<type>:` prefix lets semantic-release bump a release on behavior-changing merges
    // (issue #54); the `[#N.task]` ref maps the PR to a specific task (issue #26). The
    // skill/prompt tell the worker to pass a matching title, but both pieces are
    // guaranteed here so a forgotten or partial title is still correct.
    const prTitle = buildPrTitle({
      issueNumber: issue.number,
      taskNumber: task.number,
      taskType: task.type,
      title: title ?? task.title,
    });

    // Build PR body
    let prBody = body ?? task.description;
    prBody += `\n\nTask ${issue.number}.${task.number}: ${task.title}`;

    const targetBranch = baseBranch ?? "main";

    try {
      const pr = yield* githubCLI.createPR(task.branchName!, targetBranch, prTitle, prBody, draft);

      const prStatus = mapGitHubStateToPRStatus(pr.state, pr.isDraft);
      yield* taskDomainService.updatePRInfo(taskId, pr.url, pr.number, prStatus);

      return {
        success: true,
        forced: force,
        task: {
          id: taskId,
          status: task.status,
        },
        pr: {
          number: pr.number,
          url: pr.url,
          title: pr.title,
          state: pr.state,
          isDraft: pr.isDraft,
          headBranch: pr.headBranch,
          baseBranch: pr.baseBranch,
        },
        message:
          `Created PR #${pr.number}: ${pr.url}. ` +
          `Task status unchanged (${task.status}). ` +
          `Use submit_for_review to transition to PR_REVIEW when ready.`,
      } satisfies CreatePRResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return yield* Effect.fail(new BusinessRuleError(`Failed to create PR: ${message}`));
    }
  });
}
