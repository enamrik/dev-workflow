/**
 * ProjectsResolver - Resolves project configs from ~/.track/projects
 *
 * This module handles all project configuration:
 * - Reading/writing config.json files
 * - Resolving project configs by slug or from git
 * - Listing and scanning projects
 *
 * It does NOT connect to databases - consumers use the returned
 * SourceInfo to connect via DbSourceProvider.
 */

import { Service, Effect } from "@dev-workflow/effect";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { resolveGlobalTrackDir } from "@dev-workflow/git/track-directory-resolver.js";
import { GitOperations } from "@dev-workflow/git/operations/git-operations.js";
import type { SourceInfo } from "../../data-access/db-source-provider.js";
import type { ProjectManagementConfig } from "@dev-workflow/database/schema.js";

// Re-export for convenience
export type { SourceInfo } from "../../data-access/db-source-provider.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Machine-specific project configuration stored in ~/.track/projects/<slug>/config.json
 *
 * This config file is the bridge between a git repo and its database.
 * It contains machine-specific paths that shouldn't be in the database.
 *
 * Connection string format: "sqlite:///home/user/.track/workflow.db"
 */
export interface ProjectConfig {
  /**
   * Project slug - unique identifier used for the config directory name.
   * Format: "<name>-<hash>" (e.g., "my-project-abc123")
   */
  readonly slug: string;

  /**
   * Project display name (typically the git folder name)
   */
  readonly name: string;

  /**
   * Database connection string (sqlite:///absolute/path/workflow.db)
   */
  readonly database: string;

  /**
   * Absolute path to the git repository root on this machine
   *
   * Used to resolve relative paths and locate .track/ directory.
   */
  readonly gitRoot: string;

  /**
   * Project UUID from the database
   *
   * Stored here to avoid needing to query the database just to get the project ID.
   */
  readonly projectId: string;
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
// Project Info (for database connections)
// =============================================================================

/**
 * Project info with source connection details
 *
 * Computed object combining:
 * - Config file data (slug, name, gitRoot, projectId)
 * - Database data (syncConfig) when enriched
 */
export interface ProjectInfo {
  /** Project ID (UUID from database) */
  readonly projectId: string;
  /** Project slug (directory name, e.g., "dev-workflow-b9bccf") */
  readonly slug: string;
  /** Project display name */
  readonly name: string;
  /** Connection info for this project's database */
  readonly sourceInfo: SourceInfo;
  /** Machine-specific git root path */
  readonly gitRoot: string;
  /** Sync configuration (from database, requires enrichment) */
  readonly syncConfig?: ProjectManagementConfig | null;
}

/**
 * Source grouping for UI display
 */
export interface Source {
  /** Unique identifier: "local:<slug>", "global", or "remote:<host-prefix>" */
  readonly id: string;
  /** Human-readable display name */
  readonly displayName: string;
  /** Connection info */
  readonly sourceInfo: SourceInfo;
  /** Projects in this source */
  readonly projects: ProjectInfo[];
}

// =============================================================================
// Config File Paths
// =============================================================================

/**
 * Get the config file path for a project slug (new location)
 *
 * @param slug - Project slug (e.g., "dev-workflow-b9bccf")
 * @returns Path to ~/.track/projects/<slug>/config.json
 */
export function getConfigPath(slug: string): string {
  return path.join(resolveGlobalTrackDir(), "projects", slug, "config.json");
}

/**
 * Get the legacy config file path for a project slug (old location)
 *
 * @param slug - Project slug (e.g., "dev-workflow-b9bccf")
 * @returns Path to ~/.track/<slug>/config.json (legacy location)
 */
function getLegacyConfigPath(slug: string): string {
  return path.join(resolveGlobalTrackDir(), slug, "config.json");
}

/**
 * Get the projects directory path
 *
 * @returns Path to ~/.track/projects/
 */
function getProjectsDirectory(): string {
  return path.join(resolveGlobalTrackDir(), "projects");
}

// =============================================================================
// Config File Operations
// =============================================================================

/**
 * Migrate a project from the old location (~/.track/<slug>/) to the new location (~/.track/projects/<slug>/)
 *
 * This is an atomic operation using fs.rename() which works on the same filesystem.
 * If the project is already at the new location, this is a no-op.
 *
 * @param slug - Project slug (e.g., "dev-workflow-b9bccf")
 * @returns True if migration occurred, false if already at new location
 */
async function migrateProjectDirectory(slug: string): Promise<boolean> {
  const oldDir = path.join(resolveGlobalTrackDir(), slug);
  const newDir = path.join(resolveGlobalTrackDir(), "projects", slug);

  // Check if old directory exists
  try {
    await fs.access(oldDir);
  } catch {
    // Old directory doesn't exist, no migration needed
    return false;
  }

  // Check if new directory already exists (shouldn't happen, but be safe)
  try {
    await fs.access(newDir);
    // New directory exists - migration may have been partial, skip
    return false;
  } catch {
    // New directory doesn't exist, proceed with migration
  }

  // Ensure the projects directory exists
  const projectsDir = getProjectsDirectory();
  await fs.mkdir(projectsDir, { recursive: true });

  // Perform atomic move
  try {
    await fs.rename(oldDir, newDir);
    return true;
  } catch (error) {
    // If rename fails (e.g., cross-filesystem), throw error
    // In practice, ~/.track is always on the same filesystem
    throw new ProjectConfigError(
      `Failed to migrate project directory from ${oldDir} to ${newDir}: ${(error as Error).message}`,
      "CONFIG_INVALID",
      { oldDir, newDir, error }
    );
  }
}

/**
 * Read and parse a project's config.json
 *
 * Automatically migrates projects from the old location (~/.track/<slug>/)
 * to the new location (~/.track/projects/<slug>/) on first access.
 *
 * @param slug - Project slug (e.g., "dev-workflow-b9bccf")
 * @returns Resolved project configuration
 * @throws ProjectConfigError if config doesn't exist or is invalid
 */
export async function resolveConfig(slug: string): Promise<ProjectConfig> {
  const newConfigPath = getConfigPath(slug);
  const legacyConfigPath = getLegacyConfigPath(slug);

  // Check if config exists at new location
  let configPath = newConfigPath;
  let content: string | null = null;

  try {
    content = await fs.readFile(newConfigPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    // Not found at new location, check legacy location
  }

  // If not at new location, check legacy and migrate
  if (content === null) {
    try {
      // Check if legacy config exists
      await fs.access(legacyConfigPath);

      // Migrate the entire project directory atomically
      await migrateProjectDirectory(slug);

      // Now read from new location (after migration)
      content = await fs.readFile(newConfigPath, "utf-8");
      configPath = newConfigPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ProjectConfigError(`Config not found for project: ${slug}`, "CONFIG_NOT_FOUND", {
          configPath: newConfigPath,
          legacyConfigPath,
          slug,
        });
      }
      throw error;
    }
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
      `Invalid config structure: missing required fields (slug, name, database, gitRoot, projectId)`,
      "CONFIG_INVALID",
      { configPath, config }
    );
  }

  return config;
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
    typeof obj["slug"] === "string" &&
    typeof obj["name"] === "string" &&
    typeof obj["database"] === "string" &&
    typeof obj["gitRoot"] === "string" &&
    typeof obj["projectId"] === "string"
  );
}

/**
 * Resolve project config from a working directory
 *
 * This is the primary entry point for CLI tools:
 * 1. Find git root from cwd
 * 2. Check for worktree (error if detected)
 * 3. Read slug from .git/config
 * 4. Resolve config from ~/.track/projects/<slug>/config.json
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Resolved project configuration
 * @throws ProjectConfigError if not in a git repo, is a worktree, or slug not configured
 */
export async function resolveConfigFromGit(cwd: string = process.cwd()): Promise<ProjectConfig> {
  const gitOps = new GitOperations();

  // Find git root
  let gitRoot: string;
  try {
    gitRoot = gitOps.findGitRoot(cwd);
  } catch {
    throw new ProjectConfigError(`Not a git repository: ${cwd}`, "NOT_GIT_REPO", { cwd });
  }

  // Check if we're in a worktree
  if (gitOps.isWorktree(cwd)) {
    throw new ProjectConfigError(
      "Cannot run dev-workflow commands from a worktree. Run from the main repository.",
      "WORKTREE_DETECTED",
      { cwd, gitRoot }
    );
  }

  // Read slug from .git/config
  const slug = gitOps.readSlugFromGitConfig(gitRoot);
  if (!slug) {
    throw new ProjectConfigError(
      `Project not initialized. Run 'dfl init' first.`,
      "SLUG_NOT_FOUND",
      { gitRoot }
    );
  }

  // Resolve config from ~/.track/projects/<slug>/config.json
  return resolveConfig(slug);
}

/**
 * Write a project config file
 *
 * @param config - Project configuration to write
 */
export async function writeConfig(config: ProjectConfig): Promise<void> {
  const projectsDir = getProjectsDirectory();
  const configDir = path.join(projectsDir, config.slug);
  const configPath = path.join(configDir, "config.json");

  // Ensure projects directory and project directory exist
  await fs.mkdir(configDir, { recursive: true });

  // Write config with pretty formatting
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        slug: config.slug,
        name: config.name,
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
 * Scans ~/.track/projects/ for directories containing config.json.
 * Also checks legacy location (~/.track/) for backward compatibility during migration.
 *
 * @returns Array of project slugs
 */
async function listConfiguredProjects(): Promise<string[]> {
  const projectsDir = getProjectsDirectory();
  const slugs: string[] = [];

  // Scan new location (~/.track/projects/)
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;

      // Check if config.json exists
      const configPath = path.join(projectsDir, entry.name, "config.json");
      try {
        await fs.access(configPath);
        slugs.push(entry.name);
      } catch {
        // No config.json, skip
      }
    }
  } catch {
    // Projects directory doesn't exist yet
  }

  // Also scan legacy location (~/.track/) for unmigrated projects
  // These will be migrated on first access via resolveConfig()
  const trackDir = resolveGlobalTrackDir();
  try {
    const entries = await fs.readdir(trackDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      // Skip known non-project directories
      if (entry.name === "projects" || entry.name === "templates" || entry.name === "config") {
        continue;
      }
      // Skip if already found in new location
      if (slugs.includes(entry.name)) continue;

      // Check if config.json exists
      const configPath = path.join(trackDir, entry.name, "config.json");
      try {
        await fs.access(configPath);
        slugs.push(entry.name);
      } catch {
        // No config.json, skip
      }
    }
  } catch {
    // Track directory doesn't exist
  }

  return slugs;
}

/**
 * Load all project configs
 *
 * @returns Array of resolved configs for all configured projects
 */
export async function loadAllConfigs(): Promise<ProjectConfig[]> {
  const slugs = await listConfiguredProjects();
  const configs: ProjectConfig[] = [];

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

// =============================================================================
// Helper Functions for UI Display
// =============================================================================

/**
 * Create a display ID for a source (for UI grouping)
 */
function createDisplayId(connectionString: string, slug: string): string {
  // Global database at ~/.track/workflow.db
  if (connectionString.includes("/.track/workflow.db")) {
    return "global";
  }

  // Local database (relative to project)
  return `local:${slug}`;
}

/**
 * Generate display name for a source
 */
function getDisplayName(displayId: string): string {
  if (displayId === "global") {
    return "Global";
  }

  const slug = displayId.replace("local:", "");
  return `Local (${slug})`;
}

/**
 * Convert ProjectConfig to ProjectInfo
 */
function configToProjectInfo(config: ProjectConfig): ProjectInfo {
  return {
    projectId: config.projectId,
    slug: config.slug,
    name: config.name,
    sourceInfo: {
      connectionString: config.database,
    },
    gitRoot: config.gitRoot,
  };
}

// =============================================================================
// ProjectsResolver Class
// =============================================================================

/**
 * Resolver for project configs from ~/.track/projects
 *
 * Design principles:
 * - Only reads config files, never connects to databases
 * - Returns SourceInfo for callers to connect via DbSourceProvider
 * - Caches configs to avoid repeated filesystem access
 */
export class ProjectsResolver extends Service<ProjectsResolver>()("projectsResolver") {
  /** Cached configs by slug (reassigned atomically on each enumeration scan) */
  private configBySlug = new Map<string, ProjectConfig>();

  /**
   * Get a project by slug
   *
   * @param slug - Project slug (e.g., "dev-workflow-b9bccf")
   * @returns ProjectInfo with sourceInfo
   * @throws Error if project not found
   */
  getProjectBySlug(slug: string): Effect<ProjectInfo> {
    const self = this;
    return Effect.gen(function* () {
      let config = self.configBySlug.get(slug);

      if (!config) {
        try {
          config = yield* Effect.promise(() => resolveConfig(slug));
          self.configBySlug.set(slug, config);
        } catch {
          throw new Error(`Project not found: ${slug}`);
        }
      }

      return configToProjectInfo(config);
    });
  }

  /**
   * Get a project by slug (synchronous version)
   *
   * This method only works if the project config is already cached.
   * Call ensureScanned() or getProjectBySlug() first to populate the cache.
   *
   * @param slug - Project slug (e.g., "dev-workflow-b9bccf")
   * @returns ProjectInfo with sourceInfo, or null if not cached
   */
  getProjectBySlugSync(slug: string): ProjectInfo | null {
    const config = this.configBySlug.get(slug);
    if (!config) {
      return null;
    }
    return configToProjectInfo(config);
  }

  /**
   * Get all projects
   *
   * @returns Array of all projects with their sourceInfo
   */
  getAllProjects(): Effect<ProjectInfo[]> {
    const self = this;
    return Effect.gen(function* () {
      yield* self.ensureScannedEffect();

      return Array.from(self.configBySlug.values())
        .map(configToProjectInfo)
        .sort((a, b) => a.slug.localeCompare(b.slug));
    });
  }

  /**
   * Get all sources with their projects (grouped by database)
   *
   * @returns Array of sources, each containing their projects
   */
  getAllSources(): Effect<Source[]> {
    const self = this;
    return Effect.gen(function* () {
      yield* self.ensureScannedEffect();

      // Group configs by connection string
      const sourceMap = new Map<
        string,
        { displayId: string; displayName: string; sourceInfo: SourceInfo; projects: ProjectInfo[] }
      >();

      for (const config of self.configBySlug.values()) {
        const connectionString = config.database;
        const displayId = createDisplayId(config.database, config.slug);

        let source = sourceMap.get(connectionString);
        if (!source) {
          source = {
            displayId,
            displayName: getDisplayName(displayId),
            sourceInfo: { connectionString },
            projects: [],
          };
          sourceMap.set(connectionString, source);
        }

        source.projects.push(configToProjectInfo(config));
      }

      // Convert to array and sort
      const sources: Source[] = Array.from(sourceMap.values()).map((s) => ({
        id: s.displayId,
        displayName: s.displayName,
        sourceInfo: s.sourceInfo,
        projects: s.projects.sort((a, b) => a.slug.localeCompare(b.slug)),
      }));

      // Sort: global first, then local
      return sources.sort((a, b) => {
        const order = (id: string): number => {
          if (id === "global") return 0;
          return 1;
        };
        return order(a.id) - order(b.id);
      });
    });
  }

  /**
   * Clear cached configs
   */
  clear(): void {
    this.configBySlug = new Map();
  }

  /**
   * Enrich ProjectInfo with database data (syncConfig)
   *
   * Call this after getting projects to add database-fetched fields.
   * Requires a DbSourceProvider to connect to databases.
   *
   * @param projects - Array of ProjectInfo to enrich
   * @param getDbSource - Function to get DbSource for a project's sourceInfo
   * @returns Enriched ProjectInfo array with syncConfig populated
   */
  enrichWithDbData(
    projects: ProjectInfo[],
    getDbSource: (sourceInfo: SourceInfo) => Promise<{
      projects: {
        findAll(): Effect<Array<{ id: string; syncConfig: ProjectManagementConfig | null }>>;
      };
    }>
  ): Effect<ProjectInfo[]> {
    return Effect.gen(function* () {
      // Group projects by connection string to minimize DB connections
      const byConnection = new Map<string, ProjectInfo[]>();
      for (const project of projects) {
        const key = project.sourceInfo.connectionString;
        const list = byConnection.get(key) ?? [];
        list.push(project);
        byConnection.set(key, list);
      }

      const enriched: ProjectInfo[] = [];

      for (const [, projectGroup] of byConnection) {
        const firstProject = projectGroup[0];
        if (!firstProject) continue;

        try {
          const dbSource = yield* Effect.promise(() => getDbSource(firstProject.sourceInfo));

          // Fetch all projects from this database in one query
          const dbProjects = yield* dbSource.projects.findAll();
          const dbProjectMap = new Map(dbProjects.map((p) => [p.id, p]));

          for (const project of projectGroup) {
            const dbProject = dbProjectMap.get(project.projectId);
            enriched.push({
              ...project,
              syncConfig: dbProject?.syncConfig ?? null,
            });
          }
        } catch (e) {
          console.log("ERR", e);
          // If we can't connect to this source, keep all projects without syncConfig
          enriched.push(...projectGroup);
        }
      }

      return enriched;
    });
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Scan the projects directory and atomically refresh the config cache.
   *
   * Called on every enumeration (getAllProjects, getAllSources) so long-lived
   * processes (e.g. the UI daemon) always reflect projects registered after
   * they started, without a restart. Not called from getProjectBySlug, which
   * uses the cache and falls back to direct resolveConfig() for new slugs.
   *
   * The directory scan is cheap (~3-15 syscalls for a typical installation).
   */
  private ensureScannedEffect(): Effect<void> {
    const self = this;
    return Effect.promise(async () => {
      const configs = await loadAllConfigs();
      self.configBySlug = new Map(configs.map((c) => [c.slug, c]));
    });
  }
}
