/**
 * DbSourceProvider - Creates DbSource instances from connection strings
 *
 * Usage:
 * ```typescript
 * const provider = new DbSourceProvider();
 * const source = provider.create({ connectionString: "sqlite:///path/to/db.sqlite" });
 *
 * // Provision (migrations, seeding)
 * await source.provision();
 *
 * // Access global repos
 * const project = await source.projects.findBySlug("my-project");
 *
 * // Create project-scoped client
 * const client = source.createClient(project.id);
 * const issues = client.issues.findMany({});
 *
 * source.close();
 * ```
 */

import { Service } from "@dev-workflow/effect";
import * as path from "node:path";
import * as os from "node:os";

import { drizzle as sqliteDrizzle } from "drizzle-orm/better-sqlite3";
import { migrate as sqliteMigrate } from "drizzle-orm/better-sqlite3/migrator";

import * as sqliteSchema from "@dev-workflow/database/schema.js";
import {
  issues as issuesTable,
  plans as plansTable,
  projects as projectsTable,
  tasks as tasksTable,
  sql,
} from "@dev-workflow/database/schema.js";
import { resolveMigrationsFolder } from "@dev-workflow/database/migrations-folder.js";
import { openSqliteDatabase } from "@dev-workflow/database/open-database.js";

import type { DbSource, TaskAssociation } from "./db-source.js";
import type { DbClient } from "./db-client.js";
import type { IssuePriority } from "../domain/issues/issue.js";
import type { MilestoneIssue, MilestoneIssueGateway } from "../domain/milestones/milestone.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";

import { Effect } from "@dev-workflow/effect";
import { DrizzleDbClient } from "./drizzle-db-client.js";
import { DrizzleProjectRepository } from "../domain/projects/project-repository.js";
import { DrizzleTypeRepository } from "../domain/types/type-repository.js";
import { DrizzleGlobalSettingsRepository } from "../domain/global-settings-repository.js";
import { DrizzleMilestoneRepository } from "../domain/milestones/milestone-repository.js";
import { mapRowToIssue } from "../domain/issues/issue-repository.js";
import { DEFAULT_TYPE_DEFINITIONS } from "../domain/types/type-definition.js";

// =============================================================================
// SourceInfo
// =============================================================================

/**
 * Connection info for a data source.
 *
 * Connection string schemes:
 * - sqlite:///absolute/path - SQLite with absolute path
 * - sqlite::memory: - SQLite in-memory
 */
export interface SourceInfo {
  /** Raw connection string */
  readonly connectionString: string;
}

// =============================================================================
// DbSourceProvider
// =============================================================================

/**
 * Provider for creating DbSource instances with connection caching
 */
export class DbSourceProvider extends Service<DbSourceProvider>()("sourceProvider") {
  /** Cache of DbSource instances by connection string */
  private readonly sources = new Map<string, DbSource>();

  /**
   * Get or create a DbSource from connection info.
   * Caches sources by connection string (except :memory: which is always unique).
   *
   * @param sourceInfo - Connection info (connectionString)
   * @returns DbSource with global repos and ability to create project-scoped clients
   */
  getOrCreate(sourceInfo: SourceInfo): DbSource {
    // :memory: databases are unique per connection - never cache
    if (sourceInfo.connectionString.includes(":memory:")) {
      return this.createSource(sourceInfo.connectionString);
    }

    const cached = this.sources.get(sourceInfo.connectionString);
    if (cached) return cached;

    const source = this.createSource(sourceInfo.connectionString);
    this.sources.set(sourceInfo.connectionString, source);
    return source;
  }

  /**
   * Close all cached database connections
   */
  closeAll(): void {
    for (const source of this.sources.values()) {
      source.close();
    }
    this.sources.clear();
  }

  // ===========================================================================
  // Private - Source Creation
  // ===========================================================================

  private createSource(connectionString: string): DbSource {
    const driverPath = this.parseConnectionString(connectionString);
    return this.createSqliteSource(driverPath);
  }

  // ===========================================================================
  // Private - SQLite
  // ===========================================================================

  private createSqliteSource(driverPath: string): DbSource {
    const sqlite = openSqliteDatabase(driverPath);
    sqlite.pragma("foreign_keys = ON");
    const db = sqliteDrizzle(sqlite, { schema: sqliteSchema });
    const rawDrizzleDb = db as unknown as DrizzleDb;
    const migrationsFolder = resolveMigrationsFolder();

    // Wrap to support async transaction callbacks.
    // better-sqlite3's native transaction() is synchronous and commits before
    // async callbacks finish. We use raw BEGIN/COMMIT/ROLLBACK instead.
    // In SQLite, all operations on the same connection are in the transaction.
    const drizzleDb: DrizzleDb = {
      select: (fields) => rawDrizzleDb.select(fields),
      insert: (table) => rawDrizzleDb.insert(table),
      update: (table) => rawDrizzleDb.update(table),
      delete: (table) => rawDrizzleDb.delete(table),
      async transaction<T>(fn: (tx: DrizzleDb) => Promise<T>): Promise<T> {
        sqlite.exec("BEGIN");
        try {
          const result = await fn(rawDrizzleDb);
          sqlite.exec("COMMIT");
          return result;
        } catch (e) {
          sqlite.exec("ROLLBACK");
          throw e;
        }
      },
    };

    // Create global repositories
    const projects = new DrizzleProjectRepository(drizzleDb);
    const types = new DrizzleTypeRepository(drizzleDb);
    const globalSettings = new DrizzleGlobalSettingsRepository(drizzleDb);
    const milestones = new DrizzleMilestoneRepository(drizzleDb);

    // Cross-project issue port for milestones. Milestones are global, so reading
    // a milestone's member issues joins issues → projects across every project,
    // and writing a single issue's milestone link is a global update by issue id.
    const milestoneIssues: MilestoneIssueGateway = {
      findIssuesByMilestoneId: (milestoneId: string): Effect<MilestoneIssue[]> =>
        Effect.promise(async () => {
          const rows = drizzleDb
            .select({
              issue: issuesTable,
              projectSlug: projectsTable.slug,
              projectName: projectsTable.name,
            })
            .from(issuesTable)
            .innerJoin(projectsTable, sql`${projectsTable.id} = ${issuesTable.projectId}`)
            .where(
              sql`${issuesTable.milestoneId} = ${milestoneId} AND ${issuesTable.isDeleted} = 0`
            )
            .all();

          return rows.map((row) => ({
            issue: mapRowToIssue(row.issue),
            projectId: row.issue.projectId,
            projectSlug: row.projectSlug,
            projectName: row.projectName,
          }));
        }),

      clearMilestoneFromIssues: (milestoneId: string): Effect<number> =>
        Effect.promise(async () => {
          const affected = drizzleDb
            .select({ id: issuesTable.id })
            .from(issuesTable)
            .where(sql`${issuesTable.milestoneId} = ${milestoneId}`)
            .all();

          drizzleDb
            .update(issuesTable)
            .set({ milestoneId: null })
            .where(sql`${issuesTable.milestoneId} = ${milestoneId}`)
            .run();

          return affected.length;
        }),

      setIssueMilestone: (issueId: string, milestoneId: string | null): Effect<void> =>
        Effect.promise(async () => {
          drizzleDb
            .update(issuesTable)
            .set({ milestoneId })
            .where(sql`${issuesTable.id} = ${issueId}`)
            .run();
        }),
    };

    return {
      provision: async () => {
        // Run migrations
        sqliteMigrate(db, { migrationsFolder });

        // Seed default types if they don't exist
        this.seedDefaultTypes(types);
      },

      projects,
      types,
      globalSettings,
      milestones,
      milestoneIssues,

      getDb: () => drizzleDb,

      findProjectSlugByTaskId: (taskId: string): string | null => {
        const result = drizzleDb
          .select({ slug: projectsTable.slug })
          .from(tasksTable)
          .innerJoin(plansTable, sql`${plansTable.id} = ${tasksTable.planId}`)
          .innerJoin(issuesTable, sql`${issuesTable.id} = ${plansTable.issueId}`)
          .innerJoin(projectsTable, sql`${projectsTable.id} = ${issuesTable.projectId}`)
          .where(sql`${tasksTable.id} = ${taskId}`)
          .get();

        return result?.slug ?? null;
      },

      findTaskAssociationById: (taskId: string): TaskAssociation | null => {
        const result = drizzleDb
          .select({
            issueNumber: issuesTable.number,
            taskNumber: tasksTable.number,
            taskTitle: tasksTable.title,
          })
          .from(tasksTable)
          .innerJoin(plansTable, sql`${plansTable.id} = ${tasksTable.planId}`)
          .innerJoin(issuesTable, sql`${issuesTable.id} = ${plansTable.issueId}`)
          .where(sql`${tasksTable.id} = ${taskId}`)
          .get();

        return result ?? null;
      },

      findIssuePriorityByPlanId: (planId: string): IssuePriority | null => {
        const result = drizzleDb
          .select({ priority: issuesTable.priority })
          .from(plansTable)
          .innerJoin(issuesTable, sql`${issuesTable.id} = ${plansTable.issueId}`)
          .where(sql`${plansTable.id} = ${planId}`)
          .get();

        return (result?.priority as IssuePriority) ?? null;
      },

      createClient: (projectId: string): DbClient => {
        return new DrizzleDbClient(drizzleDb, projectId);
      },

      close: () => {
        sqlite.close();
      },
    };
  }

  // ===========================================================================
  // Private - Helpers
  // ===========================================================================

  /**
   * Seed default types if they don't exist
   */
  private seedDefaultTypes(types: DrizzleTypeRepository): void {
    const existingTypes = types.findAll(true);
    const existingNames = new Set(existingTypes.map((t) => t.name));

    const toSeed = DEFAULT_TYPE_DEFINITIONS.filter((t) => !existingNames.has(t.name)).map(
      (typeDef) => ({
        name: typeDef.name,
        displayName: typeDef.name.charAt(0) + typeDef.name.slice(1).toLowerCase(),
        description: typeDef.description,
        keywords: typeDef.keywords,
      })
    );

    if (toSeed.length > 0) {
      types.seedTypes(toSeed);
    }
  }

  /**
   * Parse raw connection string into driver-ready path.
   * Connection strings must use absolute paths.
   */
  private parseConnectionString(raw: string): string {
    // sqlite:///absolute/path (3 slashes)
    if (raw.startsWith("sqlite:///")) {
      let absolutePath = raw.slice(9); // "sqlite://" is 9 chars
      if (absolutePath.startsWith("~")) {
        absolutePath = path.join(os.homedir(), absolutePath.slice(1));
      }
      return absolutePath;
    }

    // sqlite::memory:
    if (raw === "sqlite::memory:") {
      return ":memory:";
    }

    throw new Error(
      `Invalid connection string: ${raw}. Expected sqlite:///absolute/path or sqlite::memory:`
    );
  }
}
