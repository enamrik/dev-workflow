/**
 * DbSource - Database connection abstraction
 *
 * Represents a database connection that can:
 * - Provision itself (migrations, seeding)
 * - Provide access to global repositories (not project-scoped)
 * - Create project-scoped DbClient instances
 *
 * This separates connection management from project scoping.
 */

import type { ProjectRepository } from "../domain/projects/project.js";
import type { TypeRepository } from "../domain/types/type-definition.js";
import type { GlobalSettingsRepository } from "../domain/global-settings-repository.js";
import type { DbClient } from "./db-client.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";
import { Service } from "@dev-workflow/effect";

/**
 * Database source - owns the connection and global repositories
 */
export interface DbSource {
  /**
   * Provision the database (run migrations, seed data, etc.)
   * Implementation varies by database type.
   */
  provision(): Promise<void>;

  /**
   * Global repositories (not project-scoped)
   */
  readonly projects: ProjectRepository;
  readonly types: TypeRepository;
  readonly globalSettings: GlobalSettingsRepository;

  /**
   * Get the underlying Drizzle database instance.
   * Use sparingly - prefer using repositories.
   */
  getDb(): DrizzleDb;

  /**
   * Create a project-scoped client
   *
   * @param projectId - Project ID to scope repositories to
   * @returns DbClient with project-scoped repositories
   */
  createClient(projectId: string): DbClient;

  /**
   * Close the database connection
   */
  close(): void;
}

/**
 * Standalone Service tag for DbSource interface
 *
 * Used in Effect-based operations to yield the DbSource dependency.
 */
export class DbSourceTag extends Service<DbSource>()("dbSource") {}
