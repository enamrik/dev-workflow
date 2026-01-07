/**
 * SourceRegistry - Manages data sources and their projects
 *
 * This service abstracts the discovery and connection management for multiple
 * data sources. It scans project configs, groups them by database, and provides
 * cached access to DataSource instances.
 *
 * Usage:
 * ```typescript
 * const registry = new SourceRegistry();
 * const sources = await registry.listSources();
 * const dataSource = await registry.getDataSource(sourceId);
 * ```
 */

import { loadAllConfigs, type ResolvedConfig } from "./project-config-resolver.js";
import { DataSourceFactory } from "../infrastructure/database/data-source-factory.js";
import type { DataSourceProvider } from "../domain/data-source.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Represents a data source (database connection)
 */
export interface Source {
  /** Unique identifier for this source (hash of connection string) */
  readonly id: string;
  /** Display name for the source */
  readonly name: string;
  /** Source type for categorization */
  readonly type: "local" | "global" | "remote";
}

/**
 * Project info from a source (minimal info needed for selection)
 */
export interface SourceProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly sourceId: string;
}

/**
 * Sources with their projects
 */
export interface SourcesWithProjects {
  readonly sources: Source[];
  readonly projects: SourceProject[];
}

// =============================================================================
// Source ID Generation
// =============================================================================

/**
 * Create a stable source ID from a connection string
 */
function createSourceId(connectionString: string): string {
  let hash = 0;
  for (let i = 0; i < connectionString.length; i++) {
    const char = connectionString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Determine source type from connection string
 */
function getSourceType(connectionString: string): "local" | "global" | "remote" {
  if (connectionString.startsWith("postgresql://") || connectionString.startsWith("postgres://")) {
    return "remote";
  }
  if (connectionString.startsWith("file:./") || connectionString.includes(".track/workflow.db")) {
    return "local";
  }
  if (connectionString.startsWith("file:///")) {
    return "global";
  }
  return "local";
}

/**
 * Generate display name for a source
 */
function getSourceName(connectionString: string, resolvedPath: string): string {
  if (connectionString.startsWith("postgresql://") || connectionString.startsWith("postgres://")) {
    try {
      const url = new URL(connectionString);
      return `Remote: ${url.host}`;
    } catch {
      return "Remote Database";
    }
  }
  if (connectionString.startsWith("file:./")) {
    return "Local Database";
  }
  if (resolvedPath.includes("/.track/workflow.db")) {
    return "Global Database";
  }
  return "Database";
}

// =============================================================================
// SourceRegistry
// =============================================================================

/**
 * Registry for managing data sources and their projects
 */
export class SourceRegistry {
  /** Cached data source connections by source ID */
  private dataSources: Map<string, DataSourceProvider> = new Map();

  /** Cached source metadata by source ID */
  private sourceMetadata: Map<string, { config: ResolvedConfig; source: Source }> = new Map();

  /** Whether sources have been scanned */
  private scanned = false;

  /**
   * Scan configs and return available sources with their projects
   */
  async listSourcesWithProjects(): Promise<SourcesWithProjects> {
    const configs = await loadAllConfigs();

    // Group configs by resolved database path
    const configsByDatabase = new Map<string, ResolvedConfig[]>();
    for (const config of configs) {
      const existing = configsByDatabase.get(config.resolvedDatabase) ?? [];
      existing.push(config);
      configsByDatabase.set(config.resolvedDatabase, existing);
    }

    const sources: Source[] = [];
    const projects: SourceProject[] = [];

    for (const [resolvedDatabase, dbConfigs] of configsByDatabase) {
      // Use first config for source metadata (all share same database)
      const firstConfig = dbConfigs[0];
      if (!firstConfig) continue;

      const sourceId = createSourceId(firstConfig.database);
      const source: Source = {
        id: sourceId,
        name: getSourceName(firstConfig.database, resolvedDatabase),
        type: getSourceType(firstConfig.database),
      };
      sources.push(source);

      // Cache source metadata for later connection
      this.sourceMetadata.set(sourceId, { config: firstConfig, source });

      // Get projects from this database
      try {
        const dataSource = await this.getDataSource(sourceId);

        // Get projects using the repository factory pattern
        const projectRepo = dataSource.getProjectRepository();
        const dbProjects = await projectRepo.findAll();

        for (const p of dbProjects) {
          projects.push({
            id: p.id,
            slug: p.slug,
            name: p.name,
            sourceId,
          });
        }
      } catch {
        // Database not accessible - skip projects from this source
      }
    }

    // Sort sources: global first, then local, then remote
    sources.sort((a, b) => {
      const order = { global: 0, local: 1, remote: 2 };
      return order[a.type] - order[b.type];
    });

    // Sort projects by name
    projects.sort((a, b) => a.name.localeCompare(b.name));

    this.scanned = true;
    return { sources, projects };
  }

  /**
   * Get a cached DataSource for a source ID
   *
   * Creates the connection on first access.
   */
  async getDataSource(sourceId: string): Promise<DataSourceProvider> {
    // Check cache
    const existing = this.dataSources.get(sourceId);
    if (existing) {
      return existing;
    }

    // Get source metadata
    let metadata = this.sourceMetadata.get(sourceId);
    if (!metadata) {
      // Need to scan first
      if (!this.scanned) {
        await this.listSourcesWithProjects();
        metadata = this.sourceMetadata.get(sourceId);
      }
      if (!metadata) {
        throw new Error(`Unknown source: ${sourceId}`);
      }
    }

    // Create connection
    const dataSource = await DataSourceFactory.create({
      connectionString: metadata.config.resolvedDatabase,
    });

    // Run migrations
    dataSource.runMigrations();

    // Cache and return
    this.dataSources.set(sourceId, dataSource);
    return dataSource;
  }

  /**
   * Close all cached connections
   */
  close(): void {
    for (const dataSource of this.dataSources.values()) {
      dataSource.close();
    }
    this.dataSources.clear();
    this.sourceMetadata.clear();
    this.scanned = false;
  }
}

// =============================================================================
// Singleton for convenience
// =============================================================================

let registryInstance: SourceRegistry | null = null;

/**
 * Get the shared SourceRegistry instance
 */
export function getSourceRegistry(): SourceRegistry {
  if (!registryInstance) {
    registryInstance = new SourceRegistry();
  }
  return registryInstance;
}
