/**
 * Tests for completeTask — worktree cleanup honesty (issue #31).
 *
 * Regression guard: force-complete must remove the task's worktree like a normal
 * completion AND report the outcome truthfully. The fix routes both paths through
 * GitWorktreeService.removeWorktree and reports `worktreeRemoved` based on what
 * actually happened — never an unconditional "Worktree cleaned up." claim.
 *
 * These tests exercise the operation's branch that the real-git e2e cannot reach
 * cheaply: a removal that FAILS must (a) not abort completion, (b) report
 * worktreeRemoved=false with a "FAILED" message, and (c) keep the DB worktree
 * pointer so the orphan stays discoverable. removeWorktree fails through the
 * typed Effect error channel, which a plain try/catch could not intercept — the
 * fix uses Effect.catchAll, and that behavior is what these tests pin down.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { issues, plans, tasks } from "@dev-workflow/database/schema.js";
import {
  GitWorktreeError,
  type GitWorktreeService,
} from "@dev-workflow/git/worktrees/git-worktree-service.js";
import { MockGitWorktreeService } from "@dev-workflow/git/worktrees/mock-git-worktree-service.js";
import type { GitHubCLI } from "@dev-workflow/git/github/github-cli.js";
import { GitHubCLIError } from "@dev-workflow/git/github/github-cli.js";
import { DbSourceProvider } from "../../../data-access/db-source-provider.js";
import type { DbSource } from "../../../data-access/db-source.js";
import type { DbClient } from "../../../data-access/db-client.js";
import { TaskDomainService } from "../../../domain/tasks/task-domain-service.js";
import { IssueDomainService } from "../../../domain/issues/issue-domain-service.js";
import { PlanDomainService } from "../../../domain/plans/plan-domain-service.js";
import { TypeDomainService } from "../../../domain/types/type-service.js";
import { completeTask } from "../complete-task.js";

const PROJECT_ID = "proj-complete-task-test";
const WORKTREE_PATH = "/test/project/.worktrees/issue-1-task-1";
const BRANCH_NAME = "issue-1/task-1-test";
const TS = "2026-01-01T00:00:00.000Z";

let source: DbSource;
let client: DbClient;

/**
 * Seed an OPEN issue + plan + a single IN_PROGRESS task that owns a worktree.
 * The issue type defaults to BUG; pass "SPIKE" to exercise the auto-close skip.
 */
function seed(taskId: string, issueType: "BUG" | "SPIKE" = "BUG"): void {
  source
    .getDb()
    .insert(issues)
    .values({
      id: "issue-1",
      projectId: PROJECT_ID,
      number: 1,
      title: "Issue 1",
      description: "desc",
      type: issueType,
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
      issueId: "issue-1",
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
      id: taskId,
      planId: "plan-1",
      number: 1,
      order: 1,
      title: "Task 1",
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

/** Minimal GitHubCLI stub — getPR is never reached for a PR-less force-complete. */
const githubCLI: GitHubCLI = {
  checkAvailable: () => Effect.succeed(true),
  createPR: () => Effect.fail(new GitHubCLIError("not used in test")),
  getPR: () => Effect.fail(new GitHubCLIError("not used in test")),
  findPRByBranch: () => Effect.succeed(null),
  closeIssue: () => Effect.fail(new GitHubCLIError("not used in test")),
  run: () => Effect.succeed({ success: true, stdout: "", stderr: "", exitCode: 0 }),
};

function buildDeps(gitWorktreeService: GitWorktreeService) {
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
    gitWorktreeService,
    dbClient: client,
  };
}

beforeEach(async () => {
  const provider = new DbSourceProvider();
  source = provider.getOrCreate({ connectionString: "sqlite::memory:" });
  await source.provision();
  client = source.createClient(PROJECT_ID);
});

describe("completeTask — worktree cleanup honesty (issue #31)", () => {
  it("force-complete removes the worktree and reports it truthfully", async () => {
    const taskId = "task-success";
    seed(taskId);

    // Mock starts with the task's worktree registered so removeWorktree can drop it.
    const git = new MockGitWorktreeService({
      projectRoot: "/test/project",
      initialWorktrees: [
        {
          path: WORKTREE_PATH,
          branch: BRANCH_NAME,
          head: "abc123",
          isMain: false,
          diskUsageBytes: 1024,
        },
      ],
    });

    const result = await Effect.runPromise(
      completeTask({
        taskId,
        sessionId: "session-1",
        finalLogEntry: "done",
        force: true,
        autoCloseIssue: false,
      }),
      buildDeps(git)
    );

    expect(result.success).toBe(true);
    expect(result.worktreeRemoved).toBe(true);
    expect(result.message).toContain("Worktree cleaned up");

    // removeWorktree was called with branch deletion, and the worktree is gone.
    const removeCalls = git.getCallsTo("removeWorktree");
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0]!.args).toEqual([WORKTREE_PATH, true]);
    expect(git.getWorktreesInMemory().has(WORKTREE_PATH)).toBe(false);

    // The DB worktree pointer is cleared once the worktree is actually gone.
    const task = await Effect.runPromise(client.tasks.findById(taskId));
    expect(task?.status).toBe("COMPLETED");
    expect(task?.worktreePath).toBeFalsy();
  });

  it("force-complete still succeeds but reports failure when removal errors", async () => {
    const taskId = "task-failure";
    seed(taskId);

    // Inject a removeWorktree failure through the typed Effect error channel.
    const git = new MockGitWorktreeService({
      projectRoot: "/test/project",
      errors: { removeWorktree: new GitWorktreeError("worktree is locked") },
    });

    const result = await Effect.runPromise(
      completeTask({
        taskId,
        sessionId: "session-1",
        finalLogEntry: "done",
        force: true,
        autoCloseIssue: false,
      }),
      buildDeps(git)
    );

    // Completion is not aborted by a cleanup failure...
    expect(result.success).toBe(true);
    // ...but the outcome is reported honestly.
    expect(result.worktreeRemoved).toBe(false);
    expect(result.message).toContain("Worktree cleanup FAILED");
    expect(result.message).not.toContain("Worktree cleaned up");

    // The DB worktree pointer is RETAINED so the orphan stays discoverable
    // (e.g. via prune_stale_worktrees) instead of being lost.
    const task = await Effect.runPromise(client.tasks.findById(taskId));
    expect(task?.status).toBe("COMPLETED");
    expect(task?.worktreePath).toBe(WORKTREE_PATH);
  });
});

describe("completeTask — auto-close on last-task completion (issue #41)", () => {
  /** Mock with the seeded worktree registered so completion cleans up cleanly. */
  function gitWithWorktree(): MockGitWorktreeService {
    return new MockGitWorktreeService({
      projectRoot: "/test/project",
      initialWorktrees: [
        {
          path: WORKTREE_PATH,
          branch: BRANCH_NAME,
          head: "abc123",
          isMain: false,
          diskUsageBytes: 1024,
        },
      ],
    });
  }

  it("auto-closes a non-SPIKE issue when its last task completes", async () => {
    const taskId = "task-last";
    seed(taskId);

    const result = await Effect.runPromise(
      completeTask({
        taskId,
        sessionId: "session-1",
        finalLogEntry: "done",
        force: true,
        autoCloseIssue: true,
      }),
      buildDeps(gitWithWorktree())
    );

    expect(result.allTasksComplete).toBe(true);
    expect(result.issueClosed).toBe(true);
    expect(result.message).toContain("Issue #1 has been closed");

    const issue = await Effect.runPromise(client.issues.findByNumber(1));
    expect(issue?.status).toBe("CLOSED");
  });

  it("does NOT auto-close a SPIKE issue even when its last task completes", async () => {
    const taskId = "task-spike";
    seed(taskId, "SPIKE");

    const result = await Effect.runPromise(
      completeTask({
        taskId,
        sessionId: "session-1",
        finalLogEntry: "done",
        force: true,
        autoCloseIssue: true,
      }),
      buildDeps(gitWithWorktree())
    );

    // All tasks are terminal, but the SPIKE issue intentionally stays OPEN.
    expect(result.allTasksComplete).toBe(true);
    expect(result.issueClosed).toBe(false);

    const issue = await Effect.runPromise(client.issues.findByNumber(1));
    expect(issue?.status).toBe("OPEN");
  });

  it("keeps the issue open when autoCloseIssue is false (explicit keep-open)", async () => {
    const taskId = "task-keep-open";
    seed(taskId);

    const result = await Effect.runPromise(
      completeTask({
        taskId,
        sessionId: "session-1",
        finalLogEntry: "done",
        force: true,
        autoCloseIssue: false,
      }),
      buildDeps(gitWithWorktree())
    );

    expect(result.allTasksComplete).toBe(true);
    expect(result.issueClosed).toBe(false);

    const issue = await Effect.runPromise(client.issues.findByNumber(1));
    expect(issue?.status).toBe("OPEN");
  });
});
