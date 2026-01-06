import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import * as schema from "./schema-pg.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DataSourceProvider,
  NeonDrizzleDatabase,
  ConnectionInfo,
  ConnectionTestResult,
} from "../../domain/data-source.js";
import { ConnectionError, MigrationError } from "../../domain/data-source.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Neon PostgreSQL implementation of DataSourceProvider
 *
 * Uses @neondatabase/serverless for HTTP-based connections to Neon PostgreSQL.
 * This is the first remote data source provider, enabling team collaboration
 * and shared state across multiple machines.
 *
 * Connection string format:
 * postgresql://user:password@host.neon.tech/database?sslmode=require
 */
export class NeonDataSource implements DataSourceProvider {
  readonly providerId = "neon";
  readonly displayName = "Neon PostgreSQL";
  readonly isRemote = true;

  private db: NeonDrizzleDatabase;
  private connectionString: string;
  private maskedConnectionString: string;

  private constructor(connectionString: string) {
    this.connectionString = connectionString;
    this.maskedConnectionString = this.maskConnectionString(connectionString);

    // Create Neon HTTP client and Drizzle instance
    const sql = neon(connectionString);
    this.db = drizzle(sql, { schema });
  }

  /**
   * Create a new NeonDataSource instance
   *
   * @param connectionString - Neon PostgreSQL connection string
   */
  static async create(connectionString: string): Promise<NeonDataSource> {
    try {
      const dataSource = new NeonDataSource(connectionString);

      // Validate connection by running a simple query
      const result = await dataSource.testConnection();
      if (!result.success) {
        throw new Error(result.error || "Connection test failed");
      }

      return dataSource;
    } catch (error) {
      throw new ConnectionError(
        `Failed to connect to Neon database: ${error instanceof Error ? error.message : String(error)}`,
        "neon",
        "***masked***",
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get Drizzle database instance for queries
   *
   * Note: Returns the PostgreSQL-typed database instance.
   * Repositories should use dialect-agnostic query patterns.
   */
  getDb(): NeonDrizzleDatabase {
    return this.db;
  }

  /**
   * Run database migrations
   *
   * Uses drizzle-kit generated migrations from the drizzle-pg/ folder.
   * PostgreSQL migrations are separate from SQLite migrations.
   */
  async runMigrations(): Promise<void> {
    try {
      // Path to PostgreSQL migrations folder
      const migrationsFolder = path.resolve(__dirname, "../../drizzle-pg");

      // Use Drizzle's async migrator for PostgreSQL
      await migrate(this.db, { migrationsFolder });
    } catch (error) {
      throw new MigrationError(
        `Failed to run migrations: ${error instanceof Error ? error.message : String(error)}`,
        "neon",
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Close database connection
   *
   * For Neon HTTP, connections are stateless so this is a no-op.
   * The underlying HTTP client doesn't maintain persistent connections.
   */
  close(): void {
    // Neon HTTP is stateless - no connection to close
  }

  /**
   * Test the database connection
   *
   * Performs a simple query to verify connectivity and authentication.
   * Returns latency for remote database monitoring.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const start = Date.now();

      // Use raw SQL via neon client for connection test
      const sql = neon(this.connectionString);
      await sql`SELECT 1`;

      const latencyMs = Date.now() - start;

      return {
        success: true,
        latencyMs,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get connection information for display/logging
   *
   * Masks the password in the connection string for security.
   */
  getConnectionInfo(): ConnectionInfo {
    return {
      dialect: "postgresql",
      description: this.maskedConnectionString,
      isRemote: true,
    };
  }

  /**
   * Mask sensitive parts of the connection string
   *
   * Replaces password with asterisks for safe logging.
   */
  private maskConnectionString(connectionString: string): string {
    try {
      const url = new URL(connectionString);
      if (url.password) {
        url.password = "***";
      }
      return url.toString();
    } catch {
      // If parsing fails, mask everything after the protocol
      return connectionString.replace(/(:\/\/[^:]+:)[^@]+(@)/, "$1***$2");
    }
  }
}
