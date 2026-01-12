/**
 * ProjectsResolver - Resolves project configs from ~/.track/projects
 *
 * This class ONLY parses config files. It does NOT connect to databases.
 * Consumers use the returned SourceInfo to connect via DbSourceProvider.
 *
 * Usage:
 * ```typescript
 * const resolver = new ProjectsResolver();
 *
 * // Get project config by slug
 * const project = await resolver.getProjectBySlug("dev-workflow-b9bccf");
 *
 * // Connect to database (done by caller, not resolver)
 * const sourceProvider = new DbSourceProvider();
 * const source = sourceProvider.getOrCreate(project.sourceInfo);
 * await source.provision();
 * const client = source.createClient(project.projectId);
 * ```
 */

import { loadAllConfigs, resolveConfig, type ResolvedConfig } from "./project-config-resolver.js";
import type { SourceInfo } from "../infrastructure/database/db-source-provider.js";

// Re-export for convenience
export type { SourceInfo } from "../infrastructure/database/db-source-provider.js";

/**
 * Project info with source connection details
 *
 * Contains everything needed to connect to the database.
 * Does NOT require database access to obtain.
 */
export interface ProjectInfo {
  /** Project ID from config.json */
  readonly projectId: string;
  /** Project slug (directory name) */
  readonly slug: string;
  /** Project display name (from config or derived from gitRoot) */
  readonly name: string;
  /** Connection info for this project's database */
  readonly sourceInfo: SourceInfo;
  /** Machine-specific git root path */
  readonly gitRoot: string;
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
// Helper Functions
// =============================================================================

/**
 * Extract host prefix from a PostgreSQL connection string
 */
function extractHostPrefix(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const host = url.hostname;
    const firstSegment = host.split(".")[0];
    return firstSegment ?? host;
  } catch {
    let hash = 0;
    for (let i = 0; i < connectionString.length; i++) {
      const char = connectionString.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}

/**
 * Create a display ID for a source (for UI grouping)
 */
function createDisplayId(connectionString: string, resolvedDatabase: string, slug: string): string {
  if (connectionString.startsWith("postgresql://") || connectionString.startsWith("postgres://")) {
    const hostPrefix = extractHostPrefix(connectionString);
    return `remote:${hostPrefix}`;
  }

  if (connectionString.startsWith("file:./") || connectionString.startsWith("sqlite:./")) {
    return `local:${slug}`;
  }

  if (
    connectionString.startsWith("file:///") ||
    connectionString.startsWith("sqlite:///") ||
    resolvedDatabase.includes("/.track/workflow.db")
  ) {
    return "global";
  }

  return `local:${slug}`;
}

/**
 * Generate display name for a source
 */
function getDisplayName(displayId: string): string {
  if (displayId.startsWith("remote:")) {
    const hostPrefix = displayId.replace("remote:", "");
    return `Remote (${hostPrefix})`;
  }

  if (displayId === "global") {
    return "Global";
  }

  const slug = displayId.replace("local:", "");
  return `Local (${slug})`;
}

/**
 * Convert a resolved database path to a connection string with scheme.
 */
function toConnectionString(resolvedDatabase: string): string {
  if (resolvedDatabase.startsWith("postgresql://") || resolvedDatabase.startsWith("postgres://")) {
    return resolvedDatabase;
  }

  if (resolvedDatabase.startsWith("sqlite:")) {
    return resolvedDatabase;
  }

  if (resolvedDatabase.startsWith("/")) {
    return `sqlite://${resolvedDatabase}`;
  }

  return `sqlite://${resolvedDatabase}`;
}

/**
 * Convert ResolvedConfig to ProjectInfo
 */
function configToProjectInfo(config: ResolvedConfig): ProjectInfo {
  return {
    projectId: config.projectId,
    slug: config.slug,
    name: config.name,
    sourceInfo: {
      connectionString: toConnectionString(config.resolvedDatabase),
    },
    gitRoot: config.gitRoot,
  };
}

// =============================================================================
// ProjectsResolver
// =============================================================================

/**
 * Resolver for project configs from ~/.track/projects
 *
 * Design principles:
 * - Only reads config files, never connects to databases
 * - Returns SourceInfo for callers to connect via DbSourceProvider
 * - Caches configs to avoid repeated filesystem access
 */
export class ProjectsResolver {
  /** Cached configs by slug */
  private readonly configBySlug = new Map<string, ResolvedConfig>();

  /** Whether configs have been scanned */
  private scanned = false;

  /**
   * Get a project by slug
   *
   * @param slug - Project slug (e.g., "dev-workflow-b9bccf")
   * @returns ProjectInfo with sourceInfo
   * @throws Error if project not found
   */
  async getProjectBySlug(slug: string): Promise<ProjectInfo> {
    await this.ensureScanned();

    let config = this.configBySlug.get(slug);

    if (!config) {
      try {
        config = await resolveConfig(slug);
        this.configBySlug.set(slug, config);
      } catch {
        throw new Error(`Project not found: ${slug}`);
      }
    }

    return configToProjectInfo(config);
  }

  /**
   * Get all projects
   *
   * @returns Array of all projects with their sourceInfo
   */
  async getAllProjects(): Promise<ProjectInfo[]> {
    await this.ensureScanned();

    return Array.from(this.configBySlug.values())
      .map(configToProjectInfo)
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * Get all sources with their projects (grouped by database)
   *
   * @returns Array of sources, each containing their projects
   */
  async getAllSources(): Promise<Source[]> {
    await this.ensureScanned();

    // Group configs by connection string
    const sourceMap = new Map<
      string,
      { displayId: string; displayName: string; sourceInfo: SourceInfo; projects: ProjectInfo[] }
    >();

    for (const config of this.configBySlug.values()) {
      const connectionString = toConnectionString(config.resolvedDatabase);
      const displayId = createDisplayId(config.database, config.resolvedDatabase, config.slug);

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

    // Sort: global first, then local, then remote
    return sources.sort((a, b) => {
      const order = (id: string): number => {
        if (id === "global") return 0;
        if (id.startsWith("local:")) return 1;
        return 2;
      };
      return order(a.id) - order(b.id);
    });
  }

  /**
   * Clear cached configs
   */
  clear(): void {
    this.configBySlug.clear();
    this.scanned = false;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Ensure configs have been scanned
   */
  private async ensureScanned(): Promise<void> {
    if (this.scanned) return;

    const configs = await loadAllConfigs();

    for (const config of configs) {
      this.configBySlug.set(config.slug, config);
    }

    this.scanned = true;
  }
}
