/**
 * Cross-project (global) milestone integration tests.
 *
 * Milestones are global: their number is unique across all projects, the
 * repository never filters by project, and a single milestone groups issues
 * from any project. These tests exercise the real DbSourceProvider-backed
 * milestone repository, cross-project issue gateway, and domain service.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { issues, projects } from "@dev-workflow/database/schema.js";
import { DbSourceProvider } from "../../../data-access/db-source-provider.js";
import type { DbSource } from "../../../data-access/db-source.js";
import { MilestoneDomainService } from "../milestone-domain-service.js";

const PROJECT_A = "proj-a";
const PROJECT_B = "proj-b";
const NOW = "2026-01-01T00:00:00.000Z";

function seedProject(source: DbSource, id: string, slug: string, name: string): void {
  source
    .getDb()
    .insert(projects)
    .values({
      id,
      gitRootHash: `${id}-hash`,
      name,
      slug,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function seedIssue(
  source: DbSource,
  opts: {
    id: string;
    projectId: string;
    number: number;
    status?: string;
    milestoneId?: string | null;
  }
): void {
  source
    .getDb()
    .insert(issues)
    .values({
      id: opts.id,
      projectId: opts.projectId,
      number: opts.number,
      title: `Issue ${opts.number}`,
      description: "desc",
      type: "FEATURE",
      priority: "MEDIUM",
      status: opts.status ?? "OPEN",
      milestoneId: opts.milestoneId ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

let provider: DbSourceProvider;
let source: DbSource;
let service: MilestoneDomainService;

beforeEach(async () => {
  provider = new DbSourceProvider();
  source = provider.getOrCreate({ connectionString: "sqlite::memory:" });
  await source.provision();

  seedProject(source, PROJECT_A, "project-a", "Project A");
  seedProject(source, PROJECT_B, "project-b", "Project B");

  service = new MilestoneDomainService(source.milestones, source.milestoneIssues);
});

afterEach(() => {
  provider.closeAll();
});

describe("global milestone numbering", () => {
  it("assigns globally-sequential numbers regardless of project", async () => {
    const m1 = await Effect.runPromise(
      source.milestones.create({
        title: "M1",
        description: "",
        startDate: "2026-01-01",
        endDate: "2026-02-01",
        status: "PLANNED",
      })
    );
    const m2 = await Effect.runPromise(
      source.milestones.create({
        title: "M2",
        description: "",
        startDate: "2026-02-01",
        endDate: "2026-03-01",
        status: "PLANNED",
      })
    );

    expect(m1.number).toBe(1);
    expect(m2.number).toBe(2);
  });

  it("findMany returns all milestones with no project filter", async () => {
    await Effect.runPromise(
      source.milestones.create({
        title: "Alpha",
        description: "",
        startDate: "2026-01-01",
        endDate: "2026-02-01",
        status: "PLANNED",
      })
    );
    await Effect.runPromise(
      source.milestones.create({
        title: "Beta",
        description: "",
        startDate: "2026-02-01",
        endDate: "2026-03-01",
        status: "PLANNED",
      })
    );

    const all = await Effect.runPromise(source.milestones.findMany());
    expect(all.map((m) => m.title)).toEqual(["Alpha", "Beta"]);
  });
});

describe("cross-project milestone membership", () => {
  it("findIssuesByMilestoneId returns issues from every project, tagged with project context", async () => {
    const milestone = await Effect.runPromise(
      source.milestones.create({
        title: "Release",
        description: "",
        startDate: "2026-01-01",
        endDate: "2026-03-01",
        status: "PLANNED",
      })
    );

    seedIssue(source, {
      id: "a1",
      projectId: PROJECT_A,
      number: 1,
      milestoneId: milestone.id,
    });
    seedIssue(source, {
      id: "b1",
      projectId: PROJECT_B,
      number: 1,
      milestoneId: milestone.id,
    });
    // An unassigned issue must not appear.
    seedIssue(source, { id: "b2", projectId: PROJECT_B, number: 2, milestoneId: null });

    const members = await Effect.runPromise(service.findMilestoneIssues(milestone.id));
    const bySlug = members.map((m) => m.projectSlug).sort();

    expect(members).toHaveLength(2);
    expect(bySlug).toEqual(["project-a", "project-b"]);
    const a = members.find((m) => m.projectSlug === "project-a");
    expect(a?.projectName).toBe("Project A");
    expect(a?.issue.number).toBe(1);
  });

  it("computeIssueStats aggregates closed/open across projects", async () => {
    const milestone = await Effect.runPromise(
      source.milestones.create({
        title: "Stats",
        description: "",
        startDate: "2026-01-01",
        endDate: "2026-03-01",
        status: "PLANNED",
      })
    );

    seedIssue(source, {
      id: "a1",
      projectId: PROJECT_A,
      number: 1,
      status: "CLOSED",
      milestoneId: milestone.id,
    });
    seedIssue(source, {
      id: "b1",
      projectId: PROJECT_B,
      number: 1,
      status: "IN_PROGRESS",
      milestoneId: milestone.id,
    });

    const stats = await Effect.runPromise(service.computeIssueStats(milestone.id));
    expect(stats.totalIssues).toBe(2);
    expect(stats.closedIssues).toBe(1);
    expect(stats.openOrInProgressIssues).toBe(1);
  });

  it("deleteMilestone unassigns member issues across every project", async () => {
    const milestone = await Effect.runPromise(
      source.milestones.create({
        title: "Doomed",
        description: "",
        startDate: "2026-01-01",
        endDate: "2026-03-01",
        status: "PLANNED",
      })
    );

    seedIssue(source, {
      id: "a1",
      projectId: PROJECT_A,
      number: 1,
      milestoneId: milestone.id,
    });
    seedIssue(source, {
      id: "b1",
      projectId: PROJECT_B,
      number: 1,
      milestoneId: milestone.id,
    });

    const unassigned = await Effect.runPromise(service.deleteMilestone(milestone.id));
    expect(unassigned).toBe(2);

    const remaining = await Effect.runPromise(source.milestones.findById(milestone.id));
    expect(remaining).toBeNull();

    // Both issues should now have a null milestone link.
    const stillAssigned = source
      .getDb()
      .select({ id: issues.id })
      .from(issues)
      .all()
      .filter((r) => r.id);
    const milestoneIds = source
      .getDb()
      .select({ milestoneId: issues.milestoneId })
      .from(issues)
      .all();
    expect(stillAssigned).toHaveLength(2);
    expect(milestoneIds.every((r) => r.milestoneId === null)).toBe(true);
  });

  it("assignIssue then findMilestoneIssues reflects the issue under its own project", async () => {
    const milestone = await Effect.runPromise(
      source.milestones.create({
        title: "Assign",
        description: "",
        startDate: "2026-01-01",
        endDate: "2026-03-01",
        status: "PLANNED",
      })
    );

    seedIssue(source, { id: "b1", projectId: PROJECT_B, number: 1, milestoneId: null });

    await Effect.runPromise(service.assignIssue("b1", milestone.id));

    const members = await Effect.runPromise(service.findMilestoneIssues(milestone.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.projectSlug).toBe("project-b");

    // Unassign clears it back out.
    await Effect.runPromise(service.unassignIssue("b1"));
    const after = await Effect.runPromise(service.findMilestoneIssues(milestone.id));
    expect(after).toHaveLength(0);
  });
});
