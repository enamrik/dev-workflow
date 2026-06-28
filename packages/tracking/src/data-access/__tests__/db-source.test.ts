/**
 * Tests for authoritative task → project resolution.
 *
 * The live bug being guarded against: a worker must run a task session in the
 * project that the task's *issue* belongs to, never in whatever project a
 * (possibly wrong/stale) dispatch-queue slug claims. These tests prove that
 * resolution is driven by the tasks → plans → issues → projects join on the
 * global tracking database, so a wrong slug supplied elsewhere can never win.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "@dev-workflow/effect";
import { issues, plans, projects, tasks } from "@dev-workflow/database/schema.js";
import { DbSourceProvider } from "../db-source-provider.js";
import type { DbSource } from "../db-source.js";
import {
  ProjectsResolver,
  resolveProjectInfoByTaskId,
} from "../../domain/projects/projects-resolver.js";

// =============================================================================
// Seed helpers
// =============================================================================

const NOW = "2026-01-01T00:00:00.000Z";

/** Insert a project row and return its (UUID) id. */
function seedProject(source: DbSource, id: string, slug: string): void {
  source
    .getDb()
    .insert(projects)
    .values({
      id,
      gitRootHash: `hash-${id}`,
      name: `Project ${slug}`,
      slug,
      isArchived: false,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

/**
 * Insert issue → plan → task chain owned by `projectId`, returning the task id.
 */
function seedTaskChain(
  source: DbSource,
  opts: { projectId: string; issueId: string; planId: string; taskId: string }
): void {
  const db = source.getDb();
  db.insert(issues)
    .values({
      id: opts.issueId,
      projectId: opts.projectId,
      number: 1,
      title: "Issue",
      description: "desc",
      type: "FEATURE",
      priority: "MEDIUM",
      status: "OPEN",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
  db.insert(plans)
    .values({
      id: opts.planId,
      issueId: opts.issueId,
      summary: "summary",
      approach: "approach",
      estimatedComplexity: "LOW",
      generatedBy: "test",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
  db.insert(tasks)
    .values({
      id: opts.taskId,
      planId: opts.planId,
      number: 1,
      order: 1,
      title: "Task",
      description: "desc",
      status: "READY",
      type: "TASK",
      source: "generated",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

async function writeProjectConfig(
  projectsDir: string,
  slug: string,
  projectId: string,
  database: string
): Promise<void> {
  const dir = path.join(projectsDir, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "config.json"),
    JSON.stringify({
      slug,
      name: `Project ${slug}`,
      database,
      gitRoot: `/fake/repos/${slug}`,
      projectId,
    })
  );
}

// =============================================================================
// Setup / Teardown
// =============================================================================

let tmpDir: string;
let projectsDir: string;
let originalDflHome: string | undefined;
let provider: DbSourceProvider;
let source: DbSource;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dfl-db-source-test-"));
  projectsDir = path.join(tmpDir, "projects");
  await fs.mkdir(projectsDir, { recursive: true });

  originalDflHome = process.env["DFL_HOME"];
  process.env["DFL_HOME"] = tmpDir;

  provider = new DbSourceProvider();
  source = provider.getOrCreate({ connectionString: "sqlite::memory:" });
  await source.provision();
});

afterEach(async () => {
  provider.closeAll();
  if (originalDflHome === undefined) {
    delete process.env["DFL_HOME"];
  } else {
    process.env["DFL_HOME"] = originalDflHome;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// =============================================================================
// findProjectSlugByTaskId
// =============================================================================

describe("DbSource.findProjectSlugByTaskId", () => {
  it("resolves a task to the slug of the project that owns its issue", () => {
    seedProject(source, "proj-uuid-real", "real-project-aaaaaa");
    seedTaskChain(source, {
      projectId: "proj-uuid-real",
      issueId: "issue-1",
      planId: "plan-1",
      taskId: "task-1",
    });

    expect(source.findProjectSlugByTaskId("task-1")).toBe("real-project-aaaaaa");
  });

  it("returns null for an unknown task id", () => {
    expect(source.findProjectSlugByTaskId("does-not-exist")).toBeNull();
  });

  it("ignores any other project's slug — a wrong dispatch slug cannot win", () => {
    // Two projects share the one global DB. The task's issue belongs to
    // `real`; a stale queue entry might claim `wrong`. The join must follow
    // the issue's projectId, not the externally-supplied slug.
    seedProject(source, "proj-uuid-real", "real-project-aaaaaa");
    seedProject(source, "proj-uuid-wrong", "wrong-project-bbbbbb");
    seedTaskChain(source, {
      projectId: "proj-uuid-real",
      issueId: "issue-1",
      planId: "plan-1",
      taskId: "task-1",
    });

    const resolved = source.findProjectSlugByTaskId("task-1");
    expect(resolved).toBe("real-project-aaaaaa");
    expect(resolved).not.toBe("wrong-project-bbbbbb");
  });
});

// =============================================================================
// findTaskAssociationById
// =============================================================================

describe("DbSource.findTaskAssociationById", () => {
  it("resolves a task to its compact issue/task association", () => {
    seedProject(source, "proj-uuid-real", "real-project-aaaaaa");
    seedTaskChain(source, {
      projectId: "proj-uuid-real",
      issueId: "issue-1",
      planId: "plan-1",
      taskId: "task-1",
    });

    expect(source.findTaskAssociationById("task-1")).toEqual({
      issueNumber: 1,
      taskNumber: 1,
      taskTitle: "Task",
    });
  });

  it("returns null for an unknown task id", () => {
    expect(source.findTaskAssociationById("does-not-exist")).toBeNull();
  });
});

// =============================================================================
// resolveProjectInfoByTaskId (composition entry point)
// =============================================================================

describe("resolveProjectInfoByTaskId", () => {
  it("resolves ProjectInfo via the DB join even when a stale slug points elsewhere", async () => {
    seedProject(source, "proj-uuid-real", "real-project-aaaaaa");
    seedProject(source, "proj-uuid-wrong", "wrong-project-bbbbbb");
    seedTaskChain(source, {
      projectId: "proj-uuid-real",
      issueId: "issue-1",
      planId: "plan-1",
      taskId: "task-1",
    });

    // On-disk configs for both projects (ProjectsResolver is config-only).
    await writeProjectConfig(
      projectsDir,
      "real-project-aaaaaa",
      "proj-uuid-real",
      "sqlite:///fake/real/workflow.db"
    );
    await writeProjectConfig(
      projectsDir,
      "wrong-project-bbbbbb",
      "proj-uuid-wrong",
      "sqlite:///fake/wrong/workflow.db"
    );

    const resolver = new ProjectsResolver();
    const info = await Effect.runPromise(resolveProjectInfoByTaskId(source, resolver, "task-1"));

    expect(info).not.toBeNull();
    expect(info?.slug).toBe("real-project-aaaaaa");
    expect(info?.projectId).toBe("proj-uuid-real");
  });

  it("returns null when the task does not exist", async () => {
    const resolver = new ProjectsResolver();
    const info = await Effect.runPromise(resolveProjectInfoByTaskId(source, resolver, "missing"));
    expect(info).toBeNull();
  });
});
