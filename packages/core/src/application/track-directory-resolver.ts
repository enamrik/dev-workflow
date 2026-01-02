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
 * - Per-project config: ~/.track/<project-id>/config.json
 * - Per-project labels: ~/.track/<project-id>/labels/
 *
 * The base directory can be overridden by setting the TRACK_DIR environment
 * variable. This is useful for testing in worktrees without affecting
 * production data.
 *
 * Project ID is derived from the git repository root path.
 * Format: <repo-folder-name>-<6-char-hash>
 * Example: "dev-workflow-a1b2c3"
 */
export class TrackDirectoryResolver {
  private readonly projectId: string;
  private readonly gitRoot: string;

  /**
   * Create a resolver from a git root path.
   * The project ID will be computed from the path.
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
    const trackDir = path.join(resolveGlobalTrackDir(), projectId);
    return new TrackDirectoryResolver(trackDir, projectId);
  }

  /**
   * Compute project ID from git root path.
   * Format: <repo-folder-name>-<6-char-hash>
   */
  private computeProjectId(): string {
    const folderName = path.basename(this.gitRoot);
    const hash = crypto.createHash("sha256").update(this.gitRoot).digest("hex").slice(0, 6);
    return `${folderName}-${hash}`;
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
   * Returns: $TRACK_DIR/<project-id>/ or ~/.track/<project-id>/
   */
  getTrackDirectory(): string {
    return path.join(resolveGlobalTrackDir(), this.projectId);
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

  /**
   * Get the config file path.
   * Returns: ~/.track/<project-id>/config.json
   */
  getConfigPath(): string {
    return path.join(this.getTrackDirectory(), "config.json");
  }

  /**
   * Get the labels directory path.
   * Returns: ~/.track/<project-id>/labels/
   */
  getLabelsPath(): string {
    return path.join(this.getTrackDirectory(), "labels");
  }

  /**
   * Get the templates directory path.
   * Returns: ~/.track/<project-id>/config/issues/templates/
   */
  getTemplatesPath(): string {
    return path.join(this.getTrackDirectory(), "config", "issues", "templates");
  }

  /**
   * Get the user templates directory path (for user-created templates).
   * Returns: ~/.track/<project-id>/issues/templates/
   */
  getUserTemplatesPath(): string {
    return path.join(this.getTrackDirectory(), "issues", "templates");
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
 * List all project IDs in the global track directory.
 * Scans $TRACK_DIR or ~/.track/ for project directories.
 *
 * @returns Array of project IDs
 */
export async function listAllProjects(): Promise<string[]> {
  const globalDir = resolveGlobalTrackDir();
  const fs = await import("node:fs/promises");

  try {
    const entries = await fs.readdir(globalDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith(".")) // Skip hidden directories
      .filter((entry) => entry.name !== "worktrees") // Skip worktrees directory
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
  return path.join(resolveGlobalTrackDir(), projectId);
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
