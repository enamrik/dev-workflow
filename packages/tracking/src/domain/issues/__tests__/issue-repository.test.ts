/**
 * Tests for DrizzleIssueRepository.findMany filtering.
 *
 * Regression guard for issue #14: the kanban board's work queue was showing
 * terminal (CLOSED) issues because findMany() silently ignored the
 * `excludeStatuses` filter that BoardQueryService.getActiveIssuesWithTasks()
 * passes (`{ excludeStatuses: ["CLOSED"] }`). These tests prove that
 * excludeStatuses is honored at the query layer so terminal issues can never
 * reappear in the work queue.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { issues } from "@dev-workflow/database/schema.js";
import { DbSourceProvider } from "../../../data-access/db-source-provider.js";
import type { DbSource } from "../../../data-access/db-source.js";
import { DrizzleIssueRepository } from "../issue-repository.js";
import type { IssueStatus } from "../issue.js";

const NOW = "2026-01-01T00:00:00.000Z";
const PROJECT_ID = "proj-issue-repo-test";

function seedIssue(
  source: DbSource,
  opts: { id: string; number: number; status: IssueStatus; projectId?: string }
): void {
  source
    .getDb()
    .insert(issues)
    .values({
      id: opts.id,
      projectId: opts.projectId ?? PROJECT_ID,
      number: opts.number,
      title: `Issue ${opts.number}`,
      description: "desc",
      type: "FEATURE",
      priority: "MEDIUM",
      status: opts.status,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

let provider: DbSourceProvider;
let source: DbSource;
let repo: DrizzleIssueRepository;

beforeEach(async () => {
  provider = new DbSourceProvider();
  source = provider.getOrCreate({ connectionString: "sqlite::memory:" });
  await source.provision();
  repo = new DrizzleIssueRepository(source.getDb(), PROJECT_ID);

  seedIssue(source, { id: "issue-open", number: 1, status: "OPEN" });
  seedIssue(source, { id: "issue-in-progress", number: 2, status: "IN_PROGRESS" });
  seedIssue(source, { id: "issue-closed", number: 3, status: "CLOSED" });
});

afterEach(() => {
  provider.closeAll();
});

describe("DrizzleIssueRepository.findMany", () => {
  it("excludes issues whose status is in excludeStatuses (work queue regression)", async () => {
    const results = await Effect.runPromise(repo.findMany({ excludeStatuses: ["CLOSED"] }));

    const statuses = results.map((i) => i.status).sort();
    expect(statuses).toEqual(["IN_PROGRESS", "OPEN"]);
    expect(results.some((i) => i.status === "CLOSED")).toBe(false);
  });

  it("returns all issues when no filter is provided (no regression to unfiltered path)", async () => {
    const results = await Effect.runPromise(repo.findMany({}));

    expect(results).toHaveLength(3);
    expect(results.map((i) => i.status).sort()).toEqual(["CLOSED", "IN_PROGRESS", "OPEN"]);
  });

  it("ignores an empty excludeStatuses array (returns all issues)", async () => {
    const results = await Effect.runPromise(repo.findMany({ excludeStatuses: [] }));

    expect(results).toHaveLength(3);
  });

  it("can exclude multiple statuses at once", async () => {
    const results = await Effect.runPromise(
      repo.findMany({ excludeStatuses: ["CLOSED", "IN_PROGRESS"] })
    );

    expect(results.map((i) => i.status)).toEqual(["OPEN"]);
  });
});
