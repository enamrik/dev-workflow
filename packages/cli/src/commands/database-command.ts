/**
 * DatabaseCommand - Configure database connection
 *
 * Handles database configuration for local SQLite or remote PostgreSQL.
 * Receives all dependencies via constructor injection.
 */

import { DatabaseConfigService, TRACK_DATABASE_URL_ENV } from "../application/database.service.js";

export interface ConfigureOptions {
  url?: string;
  local?: boolean;
}

export class DatabaseCommand {
  constructor(private readonly databaseService: DatabaseConfigService) {}

  /**
   * Configure database connection.
   */
  async configure(options: ConfigureOptions): Promise<void> {
    try {
      // Validate options
      if (options.url && options.local) {
        console.error("❌ Cannot specify both --url and --local");
        process.exit(1);
      }

      if (!options.url && !options.local) {
        console.error("❌ Must specify either --url <connection-string> or --local");
        console.error("\nExamples:");
        console.error(
          "  dev-workflow database configure --url postgresql://user:pass@host.neon.tech/db"
        );
        console.error("  dev-workflow database configure --local");
        process.exit(1);
      }

      if (options.local) {
        console.log("🔧 Resetting to local SQLite database...\n");
        const result = await this.databaseService.configureLocal();

        if (result.success) {
          console.log("✓ " + result.message);
          console.log(`  Path: ${this.databaseService.getDatabasePath()}`);
          console.log("\n⚠️  IMPORTANT: Restart Claude Code to use the new configuration.");
        } else {
          console.error(`❌ ${result.message}`);
          process.exit(1);
        }
      } else if (options.url) {
        console.log("🔧 Configuring remote database...\n");
        console.log("Validating connection...");

        const result = await this.databaseService.configureRemote(options.url);

        if (result.success) {
          console.log("\n✓ " + result.message);
          console.log(`  URL: ${DatabaseConfigService.maskPassword(options.url)}`);
          console.log("\n⚠️  IMPORTANT: Restart Claude Code to use the new configuration.");
        } else {
          console.error(`\n❌ ${result.message}`);
          process.exit(1);
        }
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  /**
   * Show current database configuration.
   */
  async status(): Promise<void> {
    try {
      const status = await this.databaseService.getStatus();

      console.log("Database Configuration:");
      console.log(`  Provider: ${status.provider}`);
      console.log(`  Connection: ${DatabaseConfigService.maskPassword(status.connectionString)}`);
      console.log(
        `  Source: ${status.source === "env" ? `environment (${TRACK_DATABASE_URL_ENV})` : status.source === "config" ? "stored configuration" : "default"}`
      );

      if (status.configuredAt) {
        console.log(`  Configured at: ${status.configuredAt}`);
      }

      if (status.source === "env") {
        console.log(
          `\n⚠️  Note: Environment variable ${TRACK_DATABASE_URL_ENV} overrides stored configuration.`
        );
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
}
