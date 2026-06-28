/**
 * Tests for BoardQueryService.
 *
 * Regression guard for issue #14:
 * - getActiveIssuesWithTasks() must EXCLUDE terminal (CLOSED) issues so the
 *   board's work queue / active columns only show active work.
 * - getRecentlyCompletedTasks() must INCLUDE tasks from CLOSED issues (within
 *   the recency window) so the Done column still surfaces recently finished
 *   work after its issue is closed — the two queries deliberately differ.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { issues, plans, tasks } from "@dev-workflow/database/schema.js";
import type { IssueStatus } from "../../domain/issues/issue.js";
import type { TaskStatus } from "../../domain/tasks/task.js";
import { DbSourceProvider } from "../../data-access/db-source-provider.js";
import type { DbSource } from "../../data-access/db-source.js";
import { BoardQueryService } from "../board-query-service.js";

const PROJECT_ID = "proj-board-test";
const RECENT = "2026-01-08T00:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z";
const CUTOFF = "2026-01-05T00:00:00.000Z";

function seedIssue(source: DbSource, id: string, number: number, status: IssueStatus): void {
  source
    .getDb()
    .insert(issues)
    .values({
      id,
      projectId: PROJECT_ID,
      number,
      title: `Issue ${number}`,
      description: "desc",
      type: "FEATURE",
      priority: "MEDIUM",
      status,
      createdAt: OLD,
      updatedAt: OLD,
    })
    .run();

  source
    .getDb()
    .insert(plans)
    .values({
      id: `plan-${id}`,
      issueId: id,
      summary: "summary",
      approach: "approach",
      estimatedComplexity: "LOW",
      generatedBy: "test",
      createdAt: OLD,
      updatedAt: OLD,
    })
    .run();
}

function seedTask(
  source: DbSource,
  opts: { id: string; issueId: string; number: number; status: TaskStatus; completedAt?: string }
): void {
  source
    .getDb()
    .insert(tasks)
    .values({
      id: opts.id,
      planId: `plan-${opts.issueId}`,
      number: opts.number,
      order: opts.number,
      title: `Task ${opts.number}`,
      description: "desc",
      status: opts.status,
      type: "TASK",
      source: "generated",
      completedAt: opts.completedAt ?? null,
      createdAt: OLD,
      updatedAt: OLD,
    })
    .run();
}

let provider: DbSourceProvider;
let source: DbSource;
let service: BoardQueryService;

beforeEach(async () => {
  provider = new DbSourceProvider();
  source = provider.getOrCreate({ connectionString: "sqlite::memory:" });
  await source.provision();

  // Active issue: one in-progress task + one recently completed task.
  seedIssue(source, "issue-active", 1, "OPEN");
  seedTask(source, {
    id: "t-active-ip",
    issueId: "issue-active",
    number: 1,
    status: "IN_PROGRESS",
  });
  seedTask(source, {
    id: "t-active-done",
    issueId: "issue-active",
    number: 2,
    status: "COMPLETED",
    completedAt: RECENT,
  });

  // Closed issue with a recently completed task (should still appear in Done).
  seedIssue(source, "issue-closed-recent", 2, "CLOSED");
  seedTask(source, {
    id: "t-closed-recent",
    issueId: "issue-closed-recent",
    number: 1,
    status: "COMPLETED",
    completedAt: RECENT,
  });

  // Closed issue whose task completed before the cutoff (should be excluded).
  seedIssue(source, "issue-closed-old", 3, "CLOSED");
  seedTask(source, {
    id: "t-closed-old",
    issueId: "issue-closed-old",
    number: 1,
    status: "COMPLETED",
    completedAt: OLD,
  });

  service = new BoardQueryService(source.createClient(PROJECT_ID));
});

afterEach(() => {
  provider.closeAll();
});

describe("BoardQueryService.getActiveIssuesWithTasks", () => {
  it("excludes terminal (CLOSED) issues — work queue regression guard", async () => {
    const result = await Effect.runPromise(service.getActiveIssuesWithTasks());

    expect(result.map((r) => r.issue.number)).toEqual([1]);
    expect(result.some((r) => r.issue.status === "CLOSED")).toBe(false);
  });
});

describe("BoardQueryService.getRecentlyCompletedTasks", () => {
  it("includes recently completed tasks from CLOSED issues (Done column)", async () => {
    const result = await Effect.runPromise(service.getRecentlyCompletedTasks(CUTOFF));

    const ids = result.map((c) => c.task.id).sort();
    expect(ids).toEqual(["t-active-done", "t-closed-recent"]);

    // The closed-issue task carries its CLOSED issue context so the Done
    // column can render it as belonging to a closed issue.
    const closed = result.find((c) => c.task.id === "t-closed-recent");
    expect(closed?.issueStatus).toBe("CLOSED");
  });

  it("excludes tasks completed before the cutoff", async () => {
    const result = await Effect.runPromise(service.getRecentlyCompletedTasks(CUTOFF));

    expect(result.some((c) => c.task.id === "t-closed-old")).toBe(false);
  });

  it("excludes non-terminal tasks", async () => {
    const result = await Effect.runPromise(service.getRecentlyCompletedTasks(CUTOFF));

    expect(result.some((c) => c.task.id === "t-active-ip")).toBe(false);
  });
});
