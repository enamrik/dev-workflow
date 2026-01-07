/**
 * DataSourceRegistry - Manages data sources and project resolution
 *
 * This class provides a clean abstraction for discovering and connecting to
 * databases across multiple projects. It replaces SourceRegistry with:
 * - Clearer source naming (local:<slug>, global, remote:<host-prefix>)
 * - Simpler API: getDataSource(projectSlug) instead of sourceId lookup
 * - Constructor injection friendly design
 *
 * Source Naming Convention:
 * - "local:<slug>" - Local SQLite database (one project per DB)
 * - "global" - Global SQLite database (~/.track/workflow.db)
 * - "remote:<host-prefix>" - Remote PostgreSQL (host prefix from Neon connection string)
 *
 * Usage:
 * ```typescript
 * const registry = new DataSourceRegistry();
 * const sources = await registry.getSources();
 * const dataSource = await registry.getDataSource("my-project");
 * ```
 */

import { loadAllConfigs, resolveConfig, type ResolvedConfig } from "./project-config-resolver.js";
import { DataSourceFactory } from "../infrastructure/database/data-source-factory.js";
import type { DataSourceProvider } from "../domain/data-source.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Source type identifier
 */
export type SourceType = "local" | "global" | "remote";

/**
 * Represents a data source (database connection)
 */
export interface SourceInfo {
  /** Unique identifier: "local:<slug>", "global", or "remote:<host-prefix>" */
  readonly id: string;
  /** Human-readable display name */
  readonly name: string;
  /** Source type for categorization */
  readonly type: SourceType;
}

/**
 * Project info from a source
 */
export interface ProjectInfo {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly sourceId: string;
  /** GitHub sync configuration (optional) */
  readonly githubSync?: {
    enabled: boolean;
    repoUrl?: string;
    projectId?: string;
    projectUrl?: string;
  } | null;
}

/**
 * Internal metadata for a source
 */
interface SourceMetadata {
  readonly config: ResolvedConfig;
  readonly source: SourceInfo;
}

// =============================================================================
// Source ID Generation
// =============================================================================

/**
 * Extract host prefix from a PostgreSQL connection string
 *
 * For Neon: "postgres://...@ep-cool-darkness-123456.us-east-2.aws.neon.tech/..."
 * Returns: "ep-cool-darkness-123456"
 */
function extractHostPrefix(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const host = url.hostname;

    // Neon hostnames: ep-cool-darkness-123456.us-east-2.aws.neon.tech
    // Extract the first segment (endpoint name)
    const firstSegment = host.split(".")[0];
    if (firstSegment) {
      return firstSegment;
    }

    // Fallback: use full host
    return host;
  } catch {
    // Fallback: hash the connection string
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
 * Create a source ID from a connection string and config
 */
function createSourceId(connectionString: string, resolvedDatabase: string, slug: string): string {
  // PostgreSQL - remote
  if (connectionString.startsWith("postgresql://") || connectionString.startsWith("postgres://")) {
    const hostPrefix = extractHostPrefix(connectionString);
    return `remote:${hostPrefix}`;
  }

  // Local file:./path - one project per DB
  if (connectionString.startsWith("file:./")) {
    return `local:${slug}`;
  }

  // Global file:///~/.track/workflow.db
  if (connectionString.startsWith("file:///") || resolvedDatabase.includes("/.track/workflow.db")) {
    return "global";
  }

  // Default to local
  return `local:${slug}`;
}

/**
 * Get source type from source ID
 */
function getSourceType(sourceId: string): SourceType {
  if (sourceId.startsWith("remote:")) return "remote";
  if (sourceId === "global") return "global";
  return "local";
}

/**
 * Generate display name for a source
 */
function getSourceDisplayName(sourceId: string): string {
  const type = getSourceType(sourceId);

  switch (type) {
    case "remote": {
      const hostPrefix = sourceId.replace("remote:", "");
      return `Remote (${hostPrefix})`;
    }
    case "global":
      return "Global";
    case "local": {
      const slug = sourceId.replace("local:", "");
      return `Local (${slug})`;
    }
  }
}

// =============================================================================
// DataSourceRegistry
// =============================================================================

/**
 * Registry for managing data sources and project resolution
 *
 * Design principles:
 * - No global state - create instances as needed
 * - Caches connections for efficiency
 * - Simple API: getDataSource(projectSlug)
 */
export class DataSourceRegistry {
  /** Cached data source connections by source ID */
  private readonly connections = new Map<string, DataSourceProvider>();

  /** Cached source metadata by source ID */
  private readonly sourceMetadata = new Map<string, SourceMetadata>();

  /** Cached project-to-source mapping by slug */
  private readonly projectToSource = new Map<string, string>();

  /** Whether sources have been scanned */
  private scanned = false;

  /**
   * Get all available sources
   *
   * Sources are deduplicated by their resolved database path.
   * For example, two projects sharing the same Neon DB will
   * appear as a single remote source.
   */
  async getSources(): Promise<SourceInfo[]> {
    await this.ensureScanned();

    const sources = Array.from(this.sourceMetadata.values()).map((m) => m.source);

    // Sort: global first, then local, then remote
    return sources.sort((a, b) => {
      const order = { global: 0, local: 1, remote: 2 };
      return order[a.type] - order[b.type];
    });
  }

  /**
   * Get projects for a specific source
   *
   * @param sourceId - Source ID (e.g., "local:dev-workflow", "global", "remote:ep-cool-123")
   * @returns Projects in this source, sorted by name
   */
  async getProjects(sourceId: string): Promise<ProjectInfo[]> {
    await this.ensureScanned();

    const dataSource = await this.getDataSourceBySourceId(sourceId);
    const projectRepo = dataSource.getProjectRepository();
    const dbProjects = await projectRepo.findAll();

    return dbProjects
      .map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        sourceId,
        githubSync: p.githubSync,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get all sources with their projects in a single call
   *
   * Useful for UI that needs to display source/project hierarchy.
   */
  async getSourcesWithProjects(): Promise<{
    sources: SourceInfo[];
    projects: ProjectInfo[];
  }> {
    await this.ensureScanned();

    const sources = await this.getSources();
    const allProjects: ProjectInfo[] = [];

    for (const source of sources) {
      try {
        const projects = await this.getProjects(source.id);
        allProjects.push(...projects);
      } catch {
        // Skip sources we can't connect to
      }
    }

    return { sources, projects: allProjects };
  }

  /**
   * Get a DataSourceProvider for a project by slug
   *
   * This is the primary API for getting database access.
   * The slug uniquely identifies the project across all sources.
   *
   * @param projectSlug - Project slug (e.g., "dev-workflow-b9bccf")
   * @returns DataSourceProvider with database connection
   * @throws Error if project not found
   */
  async getDataSource(projectSlug: string): Promise<DataSourceProvider> {
    await this.ensureScanned();

    // Check if we have cached the source ID for this project
    let sourceId = this.projectToSource.get(projectSlug);

    if (!sourceId) {
      // Try to resolve the config directly
      try {
        const config = await resolveConfig(projectSlug);
        sourceId = createSourceId(config.database, config.resolvedDatabase, projectSlug);

        // Cache the mapping
        this.projectToSource.set(projectSlug, sourceId);

        // Ensure source metadata is cached
        if (!this.sourceMetadata.has(sourceId)) {
          this.sourceMetadata.set(sourceId, {
            config,
            source: {
              id: sourceId,
              name: getSourceDisplayName(sourceId),
              type: getSourceType(sourceId),
            },
          });
        }
      } catch {
        throw new Error(`Project not found: ${projectSlug}`);
      }
    }

    return this.getDataSourceBySourceId(sourceId);
  }

  /**
   * Find a project by slug
   *
   * @param slug - Project slug
   * @returns Project info if found, null otherwise
   */
  async findProjectBySlug(slug: string): Promise<ProjectInfo | null> {
    const { projects } = await this.getSourcesWithProjects();
    return projects.find((p) => p.slug === slug) ?? null;
  }

  /**
   * Close all cached connections
   */
  close(): void {
    for (const dataSource of this.connections.values()) {
      dataSource.close();
    }
    this.connections.clear();
    this.sourceMetadata.clear();
    this.projectToSource.clear();
    this.scanned = false;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Ensure sources have been scanned
   */
  private async ensureScanned(): Promise<void> {
    if (this.scanned) return;

    const configs = await loadAllConfigs();

    // Group configs by resolved database (deduplication)
    const configsByDatabase = new Map<string, ResolvedConfig[]>();
    for (const config of configs) {
      const existing = configsByDatabase.get(config.resolvedDatabase) ?? [];
      existing.push(config);
      configsByDatabase.set(config.resolvedDatabase, existing);
    }

    // Create source metadata for each unique database
    for (const [, dbConfigs] of configsByDatabase) {
      const firstConfig = dbConfigs[0];
      if (!firstConfig) continue;

      const sourceId = createSourceId(
        firstConfig.database,
        firstConfig.resolvedDatabase,
        firstConfig.slug
      );

      // Cache source metadata
      this.sourceMetadata.set(sourceId, {
        config: firstConfig,
        source: {
          id: sourceId,
          name: getSourceDisplayName(sourceId),
          type: getSourceType(sourceId),
        },
      });

      // Cache project-to-source mappings
      for (const config of dbConfigs) {
        this.projectToSource.set(config.slug, sourceId);
      }
    }

    this.scanned = true;
  }

  /**
   * Get DataSourceProvider by source ID (internal)
   */
  private async getDataSourceBySourceId(sourceId: string): Promise<DataSourceProvider> {
    // Check cache
    const existing = this.connections.get(sourceId);
    if (existing) {
      return existing;
    }

    // Get source metadata
    const metadata = this.sourceMetadata.get(sourceId);
    if (!metadata) {
      throw new Error(`Unknown source: ${sourceId}`);
    }

    // Create connection
    const dataSource = await DataSourceFactory.create({
      connectionString: metadata.config.resolvedDatabase,
    });

    // Run migrations
    dataSource.runMigrations();

    // Cache and return
    this.connections.set(sourceId, dataSource);
    return dataSource;
  }
}
