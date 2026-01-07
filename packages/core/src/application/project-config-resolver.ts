import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { resolveGlobalTrackDir } from "./track-directory-resolver.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Machine-specific project configuration stored in ~/.track/<slug>/config.json
 *
 * This config file is the bridge between a git repo and its database.
 * It contains machine-specific paths that shouldn't be in the database.
 *
 * Connection string formats:
 * - "file:./track/workflow.db" → local SQLite (relative to gitRoot)
 * - "file:///home/user/.track/workflow.db" → global/absolute SQLite
 * - "postgresql://..." → Neon/PostgreSQL
 */
export interface ProjectConfig {
  /**
   * Database connection string
   *
   * Formats:
   * - "file:./track/workflow.db" → resolved relative to gitRoot
   * - "file:///absolute/path/workflow.db" → absolute path
   * - "postgresql://user:pass@host/db" → Neon PostgreSQL
   */
  readonly database: string;

  /**
   * Absolute path to the git repository root on this machine
   *
   * Used to resolve relative file:// paths and locate .track/ directory.
   */
  readonly gitRoot: string;

  /**
   * Project UUID from the database
   *
   * Stored here to avoid needing to query the database just to get the project ID.
   */
  readonly projectId: string;
}

/**
 * Resolved database connection ready for use
 *
 * After resolving file:./relative paths, this contains the final
 * values needed to connect to the database.
 */
export interface ResolvedConfig extends ProjectConfig {
  /**
   * The resolved database path (for SQLite) or connection string (for PostgreSQL)
   *
   * For file:./path, this is the absolute path after resolving relative to gitRoot.
   * For file:///path or postgresql://, this is the original value.
   */
  readonly resolvedDatabase: string;

  /**
   * The project slug (derived from config directory name)
   */
  readonly slug: string;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when project configuration is invalid or cannot be resolved
 */
export class ProjectConfigError extends Error {
  constructor(
    message: string,
    public readonly code: ProjectConfigErrorCode,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ProjectConfigError";
  }
}

export type ProjectConfigErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID"
  | "SLUG_NOT_FOUND"
  | "NOT_GIT_REPO"
  | "WORKTREE_DETECTED"
  | "CONNECTION_STRING_INVALID";

// =============================================================================
// Config File Resolution
// =============================================================================

/**
 * Get the config file path for a project slug
 *
 * @param slug - Project slug (e.g., "dev-workflow-b9bccf")
 * @returns Path to ~/.track/<slug>/config.json
 */
export function getConfigPath(slug: string): string {
  return path.join(resolveGlobalTrackDir(), slug, "config.json");
}

/**
 * Read and parse a project's config.json
 *
 * @param slug - Project slug (e.g., "dev-workflow-b9bccf")
 * @returns Resolved project configuration
 * @throws ProjectConfigError if config doesn't exist or is invalid
 */
export async function resolveConfig(slug: string): Promise<ResolvedConfig> {
  const configPath = getConfigPath(slug);

  // Read config file
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ProjectConfigError(`Config not found for project: ${slug}`, "CONFIG_NOT_FOUND", {
        configPath,
        slug,
      });
    }
    throw error;
  }

  // Parse JSON
  let config: unknown;
  try {
    config = JSON.parse(content);
  } catch {
    throw new ProjectConfigError(`Invalid JSON in config file: ${configPath}`, "CONFIG_INVALID", {
      configPath,
    });
  }

  // Validate required fields
  if (!isValidProjectConfig(config)) {
    throw new ProjectConfigError(
      `Invalid config structure: missing required fields (database, gitRoot, projectId)`,
      "CONFIG_INVALID",
      { configPath, config }
    );
  }

  // Resolve the database connection string
  const resolvedDatabase = resolveConnectionString(config.database, config.gitRoot);

  return {
    ...config,
    resolvedDatabase,
    slug,
  };
}

/**
 * Type guard to validate ProjectConfig structure
 */
function isValidProjectConfig(config: unknown): config is ProjectConfig {
  if (typeof config !== "object" || config === null) {
    return false;
  }
  const obj = config as Record<string, unknown>;
  return (
    typeof obj["database"] === "string" &&
    typeof obj["gitRoot"] === "string" &&
    typeof obj["projectId"] === "string"
  );
}

// =============================================================================
// Git Config Resolution
// =============================================================================

/**
 * Read the project slug from .git/config
 *
 * Looks for [dev-workflow] section with slug key.
 *
 * @param gitRoot - Path to git repository root
 * @returns Project slug if found, null otherwise
 */
export function readSlugFromGitConfig(gitRoot: string): string | null {
  try {
    const result = execSync("git config --local dev-workflow.slug", {
      cwd: gitRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return result || null;
  } catch {
    // Key doesn't exist
    return null;
  }
}

/**
 * Write the project slug to .git/config
 *
 * Creates [dev-workflow] section with slug key.
 *
 * @param gitRoot - Path to git repository root
 * @param slug - Project slug to write
 */
export function writeSlugToGitConfig(gitRoot: string, slug: string): void {
  execSync(`git config --local dev-workflow.slug "${slug}"`, {
    cwd: gitRoot,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Find the git repository root from a working directory
 *
 * @param cwd - Current working directory
 * @returns Git root path
 * @throws ProjectConfigError if not in a git repository
 */
export function findGitRoot(cwd: string): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new ProjectConfigError(`Not a git repository: ${cwd}`, "NOT_GIT_REPO", { cwd });
  }
}

/**
 * Check if the current directory is a git worktree (not the main repo)
 *
 * @param cwd - Current working directory
 * @returns True if in a worktree, false if in main repo
 */
export function isWorktree(cwd: string): boolean {
  try {
    const gitDir = execSync("git rev-parse --git-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // If they differ, we're in a worktree
    // Normalize paths for comparison
    const normalizedGitDir = path.resolve(cwd, gitDir);
    const normalizedCommonDir = path.resolve(cwd, gitCommonDir);

    return normalizedGitDir !== normalizedCommonDir;
  } catch {
    // Not a git repo
    return false;
  }
}

/**
 * Resolve project config from a working directory
 *
 * This is the primary entry point for CLI tools:
 * 1. Find git root from cwd
 * 2. Check for worktree (error if detected)
 * 3. Read slug from .git/config
 * 4. Resolve config from ~/.track/<slug>/config.json
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Resolved project configuration
 * @throws ProjectConfigError if not in a git repo, is a worktree, or slug not configured
 */
export async function resolveConfigFromGit(cwd: string = process.cwd()): Promise<ResolvedConfig> {
  // Find git root
  const gitRoot = findGitRoot(cwd);

  // Check if we're in a worktree
  if (isWorktree(cwd)) {
    throw new ProjectConfigError(
      "Cannot run dev-workflow commands from a worktree. Run from the main repository.",
      "WORKTREE_DETECTED",
      { cwd, gitRoot }
    );
  }

  // Read slug from .git/config
  const slug = readSlugFromGitConfig(gitRoot);
  if (!slug) {
    throw new ProjectConfigError(
      `Project not initialized. Run 'dev-workflow init' first.`,
      "SLUG_NOT_FOUND",
      { gitRoot }
    );
  }

  // Resolve config from ~/.track/<slug>/config.json
  return resolveConfig(slug);
}

// =============================================================================
// Connection String Resolution
// =============================================================================

/**
 * Resolve a database connection string
 *
 * Handles three formats:
 * - "file:./path" → resolved relative to gitRoot
 * - "file:///absolute/path" → absolute path (file:// stripped)
 * - "postgresql://..." → passed through unchanged
 *
 * @param connectionString - Database connection string
 * @param gitRoot - Git repository root (for relative path resolution)
 * @returns Resolved path or connection string
 */
export function resolveConnectionString(connectionString: string, gitRoot: string): string {
  // PostgreSQL - pass through unchanged
  if (connectionString.startsWith("postgresql://") || connectionString.startsWith("postgres://")) {
    return connectionString;
  }

  // file:///absolute/path (note: three slashes)
  if (connectionString.startsWith("file:///")) {
    // Remove file:// prefix, keep the leading slash
    let absolutePath = connectionString.slice(7); // "file://" is 7 chars

    // Handle ~ for home directory (path is /~/.track/... after stripping file://)
    if (absolutePath.startsWith("/~")) {
      absolutePath = path.join(os.homedir(), absolutePath.slice(2));
    }

    return absolutePath;
  }

  // file:./relative/path or file:relative/path
  if (connectionString.startsWith("file:")) {
    const relativePath = connectionString.slice(5); // Remove "file:"
    return path.resolve(gitRoot, relativePath);
  }

  // Unknown format - treat as file path for backwards compatibility
  throw new ProjectConfigError(
    `Invalid connection string format: ${connectionString}. Expected file:./path, file:///path, or postgresql://...`,
    "CONNECTION_STRING_INVALID",
    { connectionString }
  );
}

// =============================================================================
// Config File Management
// =============================================================================

/**
 * Write a project config file
 *
 * @param slug - Project slug
 * @param config - Project configuration to write
 */
export async function writeConfig(
  slug: string,
  config: Omit<ProjectConfig, "resolvedDatabase">
): Promise<void> {
  const configDir = path.join(resolveGlobalTrackDir(), slug);
  const configPath = path.join(configDir, "config.json");

  // Ensure directory exists
  await fs.mkdir(configDir, { recursive: true });

  // Write config with pretty formatting
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        database: config.database,
        gitRoot: config.gitRoot,
        projectId: config.projectId,
      },
      null,
      2
    )
  );
}

/**
 * List all configured project slugs
 *
 * Scans ~/.track/ for directories containing config.json
 *
 * @returns Array of project slugs
 */
export async function listConfiguredProjects(): Promise<string[]> {
  const trackDir = resolveGlobalTrackDir();

  try {
    const entries = await fs.readdir(trackDir, { withFileTypes: true });
    const slugs: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;

      // Check if config.json exists
      const configPath = path.join(trackDir, entry.name, "config.json");
      try {
        await fs.access(configPath);
        slugs.push(entry.name);
      } catch {
        // No config.json, skip
      }
    }

    return slugs;
  } catch {
    // Track directory doesn't exist
    return [];
  }
}

/**
 * Load all project configs
 *
 * @returns Array of resolved configs for all configured projects
 */
export async function loadAllConfigs(): Promise<ResolvedConfig[]> {
  const slugs = await listConfiguredProjects();
  const configs: ResolvedConfig[] = [];

  for (const slug of slugs) {
    try {
      const config = await resolveConfig(slug);
      configs.push(config);
    } catch {
      // Skip invalid configs
    }
  }

  return configs;
}
