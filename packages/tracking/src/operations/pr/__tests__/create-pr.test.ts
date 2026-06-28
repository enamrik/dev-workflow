/**
 * Tests for createPR — task-scoped PR title ref prefix (issue #26).
 *
 * Regression guard: a worker-created PR must carry a `[#<issue>.<task>]` ref so the
 * PR maps to a specific task, not just the issue (an issue can have several tasks/PRs).
 * The default title used to be the bare `task.title` with no ref at all; the fix builds
 * the title around the ref in create-pr.ts (the single source of truth for the format),
 * so the prefix is present whether or not the caller passes an explicit title.
 *
 * These tests pin the three cases: no title (default), an explicit title missing the
 * ref (prefixed), and an explicit title that already carries the ref (passed through
 * unchanged — criterion 2: create_pr does not strip or override the worker's title).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { issues, plans, tasks } from "@dev-workflow/database/schema.js";
import { MockGitWorktreeService } from "@dev-workflow/git/worktrees/mock-git-worktree-service.js";
import type { GitHubCLI, PRInfo } from "@dev-workflow/git/github/github-cli.js";
import { GitHubCLIError } from "@dev-workflow/git/github/github-cli.js";
import { DbSourceProvider } from "../../../data-access/db-source-provider.js";
import type { DbSource } from "../../../data-access/db-source.js";
import type { DbClient } from "../../../data-access/db-client.js";
import { TaskDomainService } from "../../../domain/tasks/task-domain-service.js";
import { IssueDomainService } from "../../../domain/issues/issue-domain-service.js";
import { PlanDomainService } from "../../../domain/plans/plan-domain-service.js";
import { TypeDomainService } from "../../../domain/types/type-service.js";
import { createPR } from "../create-pr.js";

const PROJECT_ID = "proj-create-pr-test";
const WORKTREE_PATH = "/test/project/.worktrees/issue-15-task-1";
const BRANCH_NAME = "issue-15/task-1-test";
const TS = "2026-01-01T00:00:00.000Z";
const TASK_ID = "task-create-pr";

let source: DbSource;
let client: DbClient;

/** Seed issue #15 + plan + an IN_PROGRESS task #1 ("Add OAuth callback handler"). */
function seed(): void {
  source
    .getDb()
    .insert(issues)
    .values({
      id: "issue-15",
      projectId: PROJECT_ID,
      number: 15,
      title: "Issue 15",
      description: "desc",
      type: "BUG",
      priority: "MEDIUM",
      status: "OPEN",
      createdAt: TS,
      updatedAt: TS,
    })
    .run();

  source
    .getDb()
    .insert(plans)
    .values({
      id: "plan-1",
      issueId: "issue-15",
      summary: "summary",
      approach: "approach",
      estimatedComplexity: "LOW",
      generatedBy: "test",
      createdAt: TS,
      updatedAt: TS,
    })
    .run();

  source
    .getDb()
    .insert(tasks)
    .values({
      id: TASK_ID,
      planId: "plan-1",
      number: 1,
      order: 1,
      title: "Add OAuth callback handler",
      description: "desc",
      status: "IN_PROGRESS",
      type: "TASK",
      source: "generated",
      worktreePath: WORKTREE_PATH,
      branchName: BRANCH_NAME,
      sessionId: "session-1",
      createdAt: TS,
      updatedAt: TS,
    })
    .run();
}

/**
 * GitHubCLI stub that captures the title passed to createPR (so the test can assert
 * the ref prefix) and echoes it back through a synthetic PRInfo. findPRByBranch
 * returns null so create-pr takes the "create new PR" path.
 */
function capturingGitHubCLI(): { cli: GitHubCLI; titles: string[] } {
  const titles: string[] = [];
  const cli: GitHubCLI = {
    checkAvailable: () => Effect.succeed(true),
    createPR: (headBranch, baseBranch, title, _body, draft) => {
      titles.push(title);
      return Effect.succeed({
        number: 42,
        title,
        url: "https://github.com/o/r/pull/42",
        state: "OPEN",
        merged: false,
        isDraft: draft ?? false,
        headBranch,
        baseBranch,
      } satisfies PRInfo);
    },
    getPR: () => Effect.fail(new GitHubCLIError("not used in test")),
    findPRByBranch: () => Effect.succeed(null),
    closeIssue: () => Effect.fail(new GitHubCLIError("not used in test")),
    run: () => Effect.succeed({ success: true, stdout: "", stderr: "", exitCode: 0 }),
  };
  return { cli, titles };
}

function buildDeps(githubCLI: GitHubCLI) {
  return {
    taskDomainService: new TaskDomainService(client.tasks, client.plans, client.issues),
    issueDomainService: new IssueDomainService(client.issues),
    planDomainService: new PlanDomainService(
      client.plans,
      client.tasks,
      client.issues,
      new TypeDomainService(source.types)
    ),
    githubCLI,
    gitWorktreeService: new MockGitWorktreeService({ projectRoot: "/test/project" }),
  };
}

beforeEach(async () => {
  const provider = new DbSourceProvider();
  source = provider.getOrCreate({ connectionString: "sqlite::memory:" });
  await source.provision();
  client = source.createClient(PROJECT_ID);
  seed();
});

describe("createPR — task-scoped title ref prefix (issue #26)", () => {
  it("defaults to the task title prefixed with [#<issue>.<task>]", async () => {
    const { cli, titles } = capturingGitHubCLI();

    const result = await Effect.runPromise(
      createPR({ taskId: TASK_ID, draft: false, force: false }),
      buildDeps(cli)
    );

    expect(titles).toEqual(["[#15.1] Add OAuth callback handler"]);
    expect(result.pr.title).toBe("[#15.1] Add OAuth callback handler");
  });

  it("prefixes the ref onto an explicit title that omits it", async () => {
    const { cli, titles } = capturingGitHubCLI();

    await Effect.runPromise(
      createPR({ taskId: TASK_ID, title: "Fix the login redirect", draft: false, force: false }),
      buildDeps(cli)
    );

    expect(titles).toEqual(["[#15.1] Fix the login redirect"]);
  });

  it("passes an explicit title that already carries the ref through unchanged", async () => {
    const { cli, titles } = capturingGitHubCLI();

    await Effect.runPromise(
      createPR({ taskId: TASK_ID, title: "[#15.1] Already scoped", draft: false, force: false }),
      buildDeps(cli)
    );

    expect(titles).toEqual(["[#15.1] Already scoped"]);
  });
});
