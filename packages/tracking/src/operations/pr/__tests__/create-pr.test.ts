/**
 * Tests for createPR — conventional-commit PR title format (issues #26 + #54).
 *
 * A worker-created PR title is the single source of truth at `<type>: [#<issue>.<task>]
 * <desc>`, built in create-pr.ts. Two guarantees compose there:
 *  - the `<type>:` prefix (issue #54) lets semantic-release bump a release on a
 *    behavior-changing merge — derived from `task.type` (FEATURE/ENHANCEMENT→feat,
 *    BUG→fix, TASK/SPIKE→chore) unless the title already carries an explicit prefix;
 *  - the `[#N.task]` ref (issue #26) maps the PR to a specific task, injected once.
 *
 * These tests pin: the default (no title) case, an explicit bare title, an explicit
 * title already carrying the ref, the type mapping (feat/fix), and an explicit
 * conventional prefix being honored (and getting the ref injected if missing).
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

/**
 * Seed issue #15 + plan + an IN_PROGRESS task #1 ("Add OAuth callback handler").
 * `taskType` drives the derived conventional-commit prefix (defaults to TASK → chore).
 */
function seed(taskType: "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK" | "SPIKE" = "TASK"): void {
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
      type: taskType,
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
});

describe("createPR — conventional-commit title format (issues #26 + #54)", () => {
  it("defaults to the task title as `<type>: [#<issue>.<task>] <desc>` (TASK → chore)", async () => {
    seed("TASK");
    const { cli, titles } = capturingGitHubCLI();

    const result = await Effect.runPromise(
      createPR({ taskId: TASK_ID, draft: false, force: false }),
      buildDeps(cli)
    );

    expect(titles).toEqual(["chore: [#15.1] Add OAuth callback handler"]);
    expect(result.pr.title).toBe("chore: [#15.1] Add OAuth callback handler");
  });

  it("derives `feat:` for FEATURE/ENHANCEMENT tasks", async () => {
    seed("FEATURE");
    const { cli, titles } = capturingGitHubCLI();

    await Effect.runPromise(
      createPR({ taskId: TASK_ID, title: "Add SSO login", draft: false, force: false }),
      buildDeps(cli)
    );

    expect(titles).toEqual(["feat: [#15.1] Add SSO login"]);
  });

  it("derives `fix:` for BUG tasks", async () => {
    seed("BUG");
    const { cli, titles } = capturingGitHubCLI();

    await Effect.runPromise(
      createPR({ taskId: TASK_ID, title: "Fix the login redirect", draft: false, force: false }),
      buildDeps(cli)
    );

    expect(titles).toEqual(["fix: [#15.1] Fix the login redirect"]);
  });

  it("injects the ref after a derived type when the title already carries a bare ref", async () => {
    seed("BUG");
    const { cli, titles } = capturingGitHubCLI();

    await Effect.runPromise(
      createPR({ taskId: TASK_ID, title: "[#15.1] Already scoped", draft: false, force: false }),
      buildDeps(cli)
    );

    expect(titles).toEqual(["fix: [#15.1] Already scoped"]);
  });

  it("passes a complete `<type>: [#N.task] <desc>` title through unchanged", async () => {
    seed("BUG");
    const { cli, titles } = capturingGitHubCLI();

    await Effect.runPromise(
      createPR({
        taskId: TASK_ID,
        title: "feat: [#15.1] Worker chose feat deliberately",
        draft: false,
        force: false,
      }),
      buildDeps(cli)
    );

    expect(titles).toEqual(["feat: [#15.1] Worker chose feat deliberately"]);
  });

  it("honors an explicit conventional prefix and injects the missing ref", async () => {
    seed("FEATURE");
    const { cli, titles } = capturingGitHubCLI();

    await Effect.runPromise(
      createPR({ taskId: TASK_ID, title: "docs: update the README", draft: false, force: false }),
      buildDeps(cli)
    );

    // The worker's chosen `docs:` type is kept; the [#N.task] ref (issue #26) is injected.
    expect(titles).toEqual(["docs: [#15.1] update the README"]);
  });

  it("does NOT treat an arbitrary `word:` as a type — derives from task.type instead", async () => {
    // Regression: `wip:`/`note:` are not conventional types; honoring them would bypass the
    // derived type and could silently suppress the release issue #54 wants.
    seed("BUG");
    const { cli, titles } = capturingGitHubCLI();

    await Effect.runPromise(
      createPR({ taskId: TASK_ID, title: "wip: still hacking", draft: false, force: false }),
      buildDeps(cli)
    );

    expect(titles).toEqual(["fix: [#15.1] wip: still hacking"]);
  });

  it("never duplicates the ref — strips a stray wrong-task ref before injecting the correct one", async () => {
    seed("BUG");
    const { cli, titles } = capturingGitHubCLI();

    await Effect.runPromise(
      createPR({
        taskId: TASK_ID,
        title: "feat: [#99.9] pasted wrong ref",
        draft: false,
        force: false,
      }),
      buildDeps(cli)
    );

    // Exactly one ref, and it's THIS task's; the worker's explicit `feat:` type is kept.
    expect(titles).toEqual(["feat: [#15.1] pasted wrong ref"]);
  });
});
