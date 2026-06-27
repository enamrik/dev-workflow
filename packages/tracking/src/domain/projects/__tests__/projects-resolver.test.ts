/**
 * Tests for ProjectsResolver
 *
 * Verifies that enumeration methods always reflect the current filesystem state
 * rather than a one-time cached snapshot — the key invariant for long-lived
 * processes (e.g. the UI daemon) to pick up newly-registered projects without
 * requiring a restart.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { Effect } from "@dev-workflow/effect";
import { GitOperations } from "@dev-workflow/git/operations/git-operations.js";
import {
  ProjectsResolver,
  resolveConfigFromGit,
  ProjectConfigError,
} from "../projects-resolver.js";

async function writeProjectConfig(
  projectsDir: string,
  slug: string,
  projectId = `proj-${slug}`
): Promise<void> {
  const dir = path.join(projectsDir, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "config.json"),
    JSON.stringify({
      slug,
      name: `Project ${slug}`,
      database: `sqlite:///fake/${slug}/workflow.db`,
      gitRoot: `/fake/repos/${slug}`,
      projectId,
    })
  );
}

async function removeProjectConfig(projectsDir: string, slug: string): Promise<void> {
  await fs.rm(path.join(projectsDir, slug), { recursive: true, force: true });
}

// =============================================================================
// Setup / Teardown
// =============================================================================

let tmpDir: string;
let projectsDir: string;
let originalDflHome: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dfl-resolver-test-"));
  projectsDir = path.join(tmpDir, "projects");
  await fs.mkdir(projectsDir, { recursive: true });

  // Point DFL_HOME at the temp dir so ProjectsResolver reads from there
  originalDflHome = process.env["DFL_HOME"];
  process.env["DFL_HOME"] = tmpDir;
});

afterEach(async () => {
  if (originalDflHome === undefined) {
    delete process.env["DFL_HOME"];
  } else {
    process.env["DFL_HOME"] = originalDflHome;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// =============================================================================
// Tests
// =============================================================================

describe("ProjectsResolver — dynamic project enumeration", () => {
  it("getAllProjects reflects a project registered after the resolver was created", async () => {
    await writeProjectConfig(projectsDir, "alpha");

    const resolver = new (ProjectsResolver as unknown as new () => ProjectsResolver)();

    const first = await Effect.runPromise(resolver.getAllProjects());
    expect(first.map((p) => p.slug)).toEqual(["alpha"]);

    // Simulate dfl init registering a new project while the daemon runs
    await writeProjectConfig(projectsDir, "gamma");

    const second = await Effect.runPromise(resolver.getAllProjects());
    expect(second.map((p) => p.slug)).toEqual(["alpha", "gamma"]);
  });

  it("getAllProjects does not return a project removed from the filesystem", async () => {
    await writeProjectConfig(projectsDir, "alpha");
    await writeProjectConfig(projectsDir, "beta");

    const resolver = new (ProjectsResolver as unknown as new () => ProjectsResolver)();

    const first = await Effect.runPromise(resolver.getAllProjects());
    expect(first.map((p) => p.slug)).toEqual(["alpha", "beta"]);

    await removeProjectConfig(projectsDir, "beta");

    const second = await Effect.runPromise(resolver.getAllProjects());
    expect(second.map((p) => p.slug)).toEqual(["alpha"]);
  });

  it("getAllSources reflects a project registered after the resolver was created", async () => {
    await writeProjectConfig(projectsDir, "alpha");

    const resolver = new (ProjectsResolver as unknown as new () => ProjectsResolver)();

    await Effect.runPromise(resolver.getAllSources());

    await writeProjectConfig(projectsDir, "gamma");

    const sources = await Effect.runPromise(resolver.getAllSources());
    const allSlugs = sources.flatMap((s) => s.projects.map((p) => p.slug)).sort();
    expect(allSlugs).toContain("gamma");
  });

  it("returns empty list when no projects are registered", async () => {
    const resolver = new (ProjectsResolver as unknown as new () => ProjectsResolver)();
    const projects = await Effect.runPromise(resolver.getAllProjects());
    expect(projects).toEqual([]);
  });
});

// =============================================================================
// resolveConfigFromGit — worktree-aware resolution (real git)
// =============================================================================

function git(cwd: string, args: string): void {
  execSync(`git ${args}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

describe("resolveConfigFromGit — worktree awareness", () => {
  let reposDir: string;
  let mainRepo: string;
  const slug = "main-project-abc123";
  const projectId = "proj-main-abc123";

  beforeEach(async () => {
    // realpath: git reports the resolved tmpdir path (macOS /var symlink).
    reposDir = await fs.realpath(tmpDir);
    mainRepo = path.join(reposDir, "main-repo");
    await fs.mkdir(mainRepo, { recursive: true });

    git(mainRepo, "init -b main");
    git(mainRepo, "config user.email test@example.com");
    git(mainRepo, "config user.name Test");
    await fs.writeFile(path.join(mainRepo, "README.md"), "hello");
    git(mainRepo, "add -A");
    git(mainRepo, 'commit -m "initial"');
  });

  it("resolves a worktree to its PARENT repository's project config", async () => {
    // The slug lives on the MAIN repo's git config + ~/.track project config.
    new GitOperations().writeSlugToGitConfig(mainRepo, slug);
    await writeProjectConfig(projectsDir, slug, projectId);

    const worktree = path.join(reposDir, "wt-task-1");
    git(mainRepo, `worktree add "${worktree}"`);

    const config = await resolveConfigFromGit(worktree);

    expect(config.slug).toBe(slug);
    expect(config.projectId).toBe(projectId);
  });

  it("still resolves a normal (non-worktree) checkout from its own root", async () => {
    new GitOperations().writeSlugToGitConfig(mainRepo, slug);
    await writeProjectConfig(projectsDir, slug, projectId);

    const config = await resolveConfigFromGit(mainRepo);

    expect(config.slug).toBe(slug);
    expect(config.projectId).toBe(projectId);
  });

  it("throws WORKTREE_DETECTED when the worktree's parent has no slug", async () => {
    // No slug written on the main repo => parent is not a dev-workflow project.
    const worktree = path.join(reposDir, "wt-uninit");
    git(mainRepo, `worktree add "${worktree}"`);

    await expect(resolveConfigFromGit(worktree)).rejects.toMatchObject({
      code: "WORKTREE_DETECTED",
    });
    await expect(resolveConfigFromGit(worktree)).rejects.toBeInstanceOf(ProjectConfigError);
  });
});
