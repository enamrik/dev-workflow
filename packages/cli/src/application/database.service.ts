/**
 * DatabaseConfigService - CLI service for database configuration
 *
 * Handles database configuration for switching between local SQLite
 * and remote PostgreSQL (Neon) databases.
 */

import {
  getGlobalDatabasePath,
  DataSourceFactory,
  SqliteGlobalSettingsRepository,
  type DatabaseConfig,
  type SqliteDataSource,
} from "@dev-workflow/core";

/**
 * Result of a database configuration operation
 */
export interface DatabaseConfigureResult {
  success: boolean;
  message: string;
}

/**
 * Result of a database connection validation
 */
export interface DatabaseValidationResult {
  success: boolean;
  error?: string;
  provider?: "sqlite" | "neon";
}

/**
 * Database status information
 */
export interface DatabaseStatus {
  provider: "sqlite" | "neon";
  connectionString: string;
  source: "default" | "config" | "env";
  configuredAt?: string;
}

/**
 * Environment variable for database URL override
 */
export const TRACK_DATABASE_URL_ENV = "TRACK_DATABASE_URL";

/**
 * DatabaseConfigService - Manages database configuration
 */
export class DatabaseConfigService {
  private dbService: SqliteDataSource | null = null;
  private settingsRepository: SqliteGlobalSettingsRepository | null = null;

  /**
   * Initialize the database connection (to global settings DB)
   */
  private async initialize(): Promise<void> {
    if (this.dbService) {
      return;
    }

    const databasePath = getGlobalDatabasePath();
    this.dbService = await DataSourceFactory.createSqlite(databasePath);
    this.dbService.runMigrations();

    const db = this.dbService.getDb();
    this.settingsRepository = new SqliteGlobalSettingsRepository(db);
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.dbService) {
      this.dbService.close();
      this.dbService = null;
      this.settingsRepository = null;
    }
  }

  /**
   * Get current database configuration
   */
  async getConfig(): Promise<DatabaseConfig | null> {
    await this.initialize();
    return this.settingsRepository!.getDatabaseConfig();
  }

  /**
   * Get the effective database status (considering env var override)
   */
  async getStatus(): Promise<DatabaseStatus> {
    await this.initialize();

    // Check environment variable first (highest priority)
    const envUrl = process.env[TRACK_DATABASE_URL_ENV];
    if (envUrl) {
      return {
        provider: this.detectProvider(envUrl),
        connectionString: envUrl,
        source: "env",
      };
    }

    // Check stored config
    const config = this.settingsRepository!.getDatabaseConfig();
    if (config && config.connectionString) {
      return {
        provider: config.provider,
        connectionString: config.connectionString,
        source: "config",
        configuredAt: config.configuredAt,
      };
    }

    // Default to SQLite
    return {
      provider: "sqlite",
      connectionString: getGlobalDatabasePath(),
      source: "default",
    };
  }

  /**
   * Configure remote database
   */
  async configureRemote(connectionString: string): Promise<DatabaseConfigureResult> {
    await this.initialize();

    // Detect provider from connection string
    const provider = this.detectProvider(connectionString);

    if (provider === "sqlite") {
      return {
        success: false,
        message:
          "Invalid connection string. For remote databases, use a PostgreSQL URL (postgresql://...)",
      };
    }

    // Validate connection before saving
    const validation = await this.validateConnection(connectionString, provider);
    if (!validation.success) {
      return {
        success: false,
        message: `Connection failed: ${validation.error}`,
      };
    }

    // Save configuration
    const config: DatabaseConfig = {
      provider,
      connectionString,
      configuredAt: new Date().toISOString(),
    };

    this.settingsRepository!.setDatabaseConfig(config);

    return {
      success: true,
      message: `Database configured successfully. Provider: ${provider}`,
    };
  }

  /**
   * Reset to local SQLite database
   */
  async configureLocal(): Promise<DatabaseConfigureResult> {
    await this.initialize();

    // Remove any stored config
    this.settingsRepository!.deleteDatabaseConfig();

    return {
      success: true,
      message: "Database reset to local SQLite.",
    };
  }

  /**
   * Validate a database connection
   */
  async validateConnection(
    connectionString: string,
    provider?: "sqlite" | "neon"
  ): Promise<DatabaseValidationResult> {
    const detectedProvider = provider ?? this.detectProvider(connectionString);

    try {
      if (detectedProvider === "neon") {
        // Test Neon connection
        const neonDs = await DataSourceFactory.createNeon(connectionString);
        // Neon's create method validates the connection by running a simple query
        neonDs.close();
        return { success: true, provider: "neon" };
      } else {
        // For SQLite, just check file accessibility
        const sqliteDs = await DataSourceFactory.createSqlite(connectionString);
        sqliteDs.close();
        return { success: true, provider: "sqlite" };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        provider: detectedProvider,
      };
    }
  }

  /**
   * Detect provider from connection string
   */
  private detectProvider(connectionString: string): "sqlite" | "neon" {
    if (
      connectionString.startsWith("postgresql://") ||
      connectionString.startsWith("postgres://")
    ) {
      return "neon";
    }
    return "sqlite";
  }

  /**
   * Mask password in a connection string for display
   */
  static maskPassword(connectionString: string): string {
    // Match password in postgresql://user:password@host pattern
    return connectionString.replace(/(postgresql:\/\/[^:]+:)([^@]+)(@)/, "$1****$3");
  }

  /**
   * Get the path to the global database
   */
  getDatabasePath(): string {
    return getGlobalDatabasePath();
  }

  /**
   * Check if the current configuration uses a remote database
   */
  async isRemote(): Promise<boolean> {
    const status = await this.getStatus();
    return status.provider !== "sqlite";
  }
}
