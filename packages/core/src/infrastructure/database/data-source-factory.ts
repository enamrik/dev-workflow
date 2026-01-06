import type { DataSourceProvider } from "../../domain/data-source.js";
import { DataSourceError } from "../../domain/data-source.js";
import { SqliteDataSource } from "./sqlite-data-source.js";

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for creating a data source
 */
export interface DataSourceConfig {
  /**
   * Database connection string or path
   *
   * For SQLite: file path (e.g., "/path/to/workflow.db")
   * For PostgreSQL: connection URL (e.g., "postgresql://user:pass@host/db")
   */
  readonly connectionString: string;

  /**
   * Optional: Force a specific provider
   *
   * If not specified, the provider is auto-detected from the connection string.
   * - File paths → SQLite
   * - postgresql:// URLs → PostgreSQL (Neon)
   */
  readonly provider?: "sqlite" | "neon";
}

// =============================================================================
// Factory
// =============================================================================

/**
 * DataSourceFactory - Creates DataSourceProvider instances based on configuration
 *
 * This is the main entry point for obtaining a database connection.
 * It auto-detects the appropriate provider based on the connection string,
 * or uses an explicitly specified provider.
 *
 * Currently supports:
 * - SQLite (local file-based database)
 *
 * Future support planned for:
 * - Neon (serverless PostgreSQL)
 * - Turso (edge SQLite)
 */
export class DataSourceFactory {
  /**
   * Create a DataSourceProvider based on configuration
   *
   * Auto-detects provider from connection string if not explicitly specified:
   * - File paths (no protocol) → SQLite
   * - postgresql:// or postgres:// → Neon (not yet implemented)
   *
   * @param config - Data source configuration
   * @returns A DataSourceProvider instance
   * @throws DataSourceError if provider is not supported or connection fails
   */
  static async create(config: DataSourceConfig): Promise<DataSourceProvider> {
    const provider = config.provider ?? this.detectProvider(config.connectionString);

    switch (provider) {
      case "sqlite":
        return SqliteDataSource.create(config.connectionString);

      case "neon":
        throw new DataSourceError(
          "Neon PostgreSQL provider is not yet implemented. Use SQLite for now.",
          "neon",
          "create"
        );

      default: {
        const unknownProvider = provider as string;
        throw new DataSourceError(
          `Unknown provider: ${unknownProvider}`,
          unknownProvider,
          "create"
        );
      }
    }
  }

  /**
   * Create a SQLite data source directly
   *
   * Convenience method for the common case of using SQLite.
   *
   * @param databasePath - Path to the SQLite database file
   * @returns A SqliteDataSource instance
   */
  static async createSqlite(databasePath: string): Promise<SqliteDataSource> {
    return SqliteDataSource.create(databasePath);
  }

  /**
   * Detect provider from connection string
   *
   * @param connectionString - Database path or URL
   * @returns Detected provider type
   */
  private static detectProvider(connectionString: string): "sqlite" | "neon" {
    // PostgreSQL URLs
    if (
      connectionString.startsWith("postgresql://") ||
      connectionString.startsWith("postgres://")
    ) {
      return "neon";
    }

    // Default to SQLite (file path)
    return "sqlite";
  }

  /**
   * Check if a connection string is for a remote database
   *
   * Useful for safety checks (e.g., preventing nuke on remote databases).
   *
   * @param connectionString - Database path or URL
   * @returns True if the connection string is for a remote database
   */
  static isRemote(connectionString: string): boolean {
    const provider = this.detectProvider(connectionString);
    return provider === "neon";
  }
}
