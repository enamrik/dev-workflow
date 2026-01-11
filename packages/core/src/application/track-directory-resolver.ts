import * as crypto from "node:crypto";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

/**
 * Get the global track directory, respecting TRACK_DIR environment variable.
 *
 * @returns TRACK_DIR if set, otherwise ~/.track/
 */
export function resolveGlobalTrackDir(): string {
  const trackDir = process.env["TRACK_DIR"];
  if (trackDir) {
    return path.resolve(trackDir);
  }
  return path.join(os.homedir(), ".track");
}

/**
 * TrackDirectoryResolver resolves paths to dev-workflow data storage.
 *
 * Storage architecture:
 * - Single global database: ~/.track/workflow.db (all projects share one DB)
 * - Per-project data: ~/.track/projects/<project-id>/
 * - Per-project worktrees: ~/.track/projects/<project-id>/worktrees/
 * - Local templates: ./.track/templates/issues/ and ./.track/templates/tasks/
 * - Global fallback templates: ~/.track/templates/issues/ and ~/.track/templates/tasks/
 *
 * The base directory can be overridden by setting the TRACK_DIR environment
 * variable. This is useful for testing in worktrees without affecting
 * production data.
 *
 * Project ID is derived from the git repository's first commit hash.
 * Format: <repo-folder-name>-<6-char-first-commit-hash>
 * Example: "dev-workflow-b9bccf"
 *
 * This provides a stable, readable identifier that:
 * - Never changes (first commit is immutable)
 * - Works without remotes
 * - Is human-readable (includes repo name)
 */
export class TrackDirectoryResolver {
  private readonly projectId: string;
  private readonly gitRoot: string;

  /**
   * Create a resolver from a git root path.
   * The project ID will be computed from the git first commit hash.
   */
  constructor(gitRoot: string);
  /**
   * Create a resolver from a known project ID.
   * Use this when you already have the project ID and don't need to compute it.
   */
  constructor(gitRoot: string, projectId: string);
  constructor(gitRoot: string, projectId?: string) {
    this.gitRoot = gitRoot;
    this.projectId = projectId ?? this.computeProjectId();
  }

  /**
   * Create a resolver from a known project ID.
   * Use this when you already have the project ID and don't need to compute it.
   *
   * Note: gitRoot will be set to the track directory, which is fine since
   * this resolver is only used for path resolution, not for git operations.
   */
  static fromProjectId(projectId: string): TrackDirectoryResolver {
    const trackDir = path.join(resolveGlobalTrackDir(), "projects", projectId);
    return new TrackDirectoryResolver(trackDir, projectId);
  }

  /**
   * Compute project ID from git first commit hash.
   * Format: <repo-folder-name>-<6-char-first-commit-hash>
   */
  private computeProjectId(): string {
    const folderName = path.basename(this.gitRoot);
    const gitRootHash = this.getGitRootHash();
    return `${folderName}-${gitRootHash.slice(0, 6)}`;
  }

  /**
   * Get the first (initial) commit hash of the repository.
   * This is stable and never changes once the repo is created.
   *
   * This is the same value stored as `git_root_hash` in the database.
   */
  getGitRootHash(): string {
    try {
      return (
        execSync("git rev-list --max-parents=0 HEAD", {
          cwd: this.gitRoot,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        })
          .trim()
          .split("\n")[0] ?? ""
      );
    } catch {
      // Fallback to path-based hash if git command fails
      return crypto.createHash("sha256").update(this.gitRoot).digest("hex");
    }
  }

  /**
   * Get the project identifier.
   */
  getProjectId(): string {
    return this.projectId;
  }

  /**
   * Get the git repository root path.
   */
  getGitRoot(): string {
    return this.gitRoot;
  }

  /**
   * Get the base track directory for this project.
   * Returns: $TRACK_DIR/projects/<project-id>/ or ~/.track/projects/<project-id>/
   */
  getTrackDirectory(): string {
    return path.join(resolveGlobalTrackDir(), "projects", this.projectId);
  }

  /**
   * Get the projects directory (parent of all project directories).
   * Returns: $TRACK_DIR/projects/ or ~/.track/projects/
   */
  getProjectsDirectory(): string {
    return path.join(resolveGlobalTrackDir(), "projects");
  }

  /**
   * Get the global track directory (parent of all projects).
   * Returns: $TRACK_DIR or ~/.track/
   */
  getGlobalTrackDirectory(): string {
    return resolveGlobalTrackDir();
  }

  /**
   * Get the global database file path.
   * Returns: ~/.track/workflow.db (single DB for all projects)
   */
  getDatabasePath(): string {
    return path.join(this.getGlobalTrackDirectory(), "workflow.db");
  }

  // ============================================================
  // Local ./.track/ paths (primary, checked into repo)
  // ============================================================

  /**
   * Get the local track directory path (in the git repo).
   * Returns: <gitRoot>/.track/
   */
  getLocalTrackDirectory(): string {
    return path.join(this.gitRoot, ".track");
  }

  /**
   * Get the local issue templates directory path.
   * Returns: <gitRoot>/.track/templates/issues/
   */
  getLocalIssueTemplatesPath(): string {
    return path.join(this.getLocalTrackDirectory(), "templates", "issues");
  }

  /**
   * Get the local task templates directory path.
   * Returns: <gitRoot>/.track/templates/tasks/
   */
  getLocalTaskTemplatesPath(): string {
    return path.join(this.getLocalTrackDirectory(), "templates", "tasks");
  }

  // ============================================================
  // Global ~/.track/ paths (fallback)
  // ============================================================

  /**
   * Get the global issue templates directory path (fallback).
   * Returns: ~/.track/templates/issues/
   */
  getGlobalIssueTemplatesPath(): string {
    return path.join(this.getGlobalTrackDirectory(), "templates", "issues");
  }

  /**
   * Get the global task templates directory path (fallback).
   * Returns: ~/.track/templates/tasks/
   */
  getGlobalTaskTemplatesPath(): string {
    return path.join(this.getGlobalTrackDirectory(), "templates", "tasks");
  }

  /**
   * Get the old global config directory path (for migration).
   * Returns: ~/.track/config/
   * @deprecated Use getGlobalIssueTemplatesPath() and getGlobalTaskTemplatesPath() instead
   */
  getOldGlobalConfigDirectory(): string {
    return path.join(this.getGlobalTrackDirectory(), "config");
  }
}

/**
 * Create a TrackDirectoryResolver from a working directory.
 * Resolves the git root from the given path.
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns TrackDirectoryResolver instance
 * @throws Error if not in a git repository
 */
export function createTrackDirectoryResolver(cwd: string = process.cwd()): TrackDirectoryResolver {
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return new TrackDirectoryResolver(gitRoot);
  } catch {
    throw new Error(`Not a git repository: ${cwd}`);
  }
}

/**
 * Get the projects directory path.
 * Returns: $TRACK_DIR/projects/ or ~/.track/projects/
 *
 * @returns Full path to the projects directory
 */
export function getProjectsDirectory(): string {
  return path.join(resolveGlobalTrackDir(), "projects");
}

/**
 * List all project IDs in the projects directory.
 * Scans $TRACK_DIR/projects/ or ~/.track/projects/ for project directories.
 *
 * @returns Array of project IDs
 */
export async function listAllProjects(): Promise<string[]> {
  const projectsDir = getProjectsDirectory();
  const fs = await import("node:fs/promises");

  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith(".")) // Skip hidden directories
      .map((entry) => entry.name);
  } catch {
    // Directory doesn't exist yet
    return [];
  }
}

/**
 * Get the track directory for a specific project ID.
 *
 * @param projectId - Project ID (e.g., "dev-workflow-a1b2c3")
 * @returns Full path to project's track directory
 */
export function getTrackDirectoryForProject(projectId: string): string {
  return path.join(resolveGlobalTrackDir(), "projects", projectId);
}

/**
 * Get the global database path.
 * All projects share a single database at $TRACK_DIR/workflow.db or ~/.track/workflow.db.
 *
 * @returns Full path to the global database file
 */
export function getGlobalDatabasePath(): string {
  return path.join(resolveGlobalTrackDir(), "workflow.db");
}
