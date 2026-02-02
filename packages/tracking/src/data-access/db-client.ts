/**
 * DbClient - Project-scoped repository facade
 *
 * Provides access to project-scoped repositories. Created via DbSource.createClient(projectId).
 *
 * For global repositories (projects, types, globalSettings), use DbSource directly.
 *
 * Usage:
 * ```typescript
 * // Get from DbSource
 * const source = new DbSourceProvider().create(sourceInfo);
 * await source.provision();
 * const client = source.createClient(projectId);
 *
 * // Use repositories
 * const issues = client.issues.findMany({});
 * ```
 */

import { Service } from "@dev-workflow/effect";
import type { IssueRepository } from "../domain/issues/issue.js";
import type { PlanRepository } from "../domain/plans/plan.js";
import type { TaskRepository } from "../domain/tasks/task.js";
import type { MilestoneRepository } from "../domain/milestones/milestone.js";
import type { SnapshotRepository } from "../domain/snapshots/snapshot.js";
import type { ExecutionLogRepository } from "../domain/execution-log.js";

/**
 * DbClient provides access to project-scoped repositories.
 *
 * Global repositories (projects, types, globalSettings) are on DbSource.
 */
export interface DbClient {
  /** The project ID this client is scoped to */
  readonly projectId: string;

  // Project-scoped repositories
  readonly issues: IssueRepository;
  readonly plans: PlanRepository;
  readonly tasks: TaskRepository;
  readonly milestones: MilestoneRepository;
  readonly snapshots: SnapshotRepository;
  readonly executionLogs: ExecutionLogRepository;

  /**
   * Execute a function inside a database transaction.
   *
   * The callback receives a new DbClient whose repositories are
   * scoped to the transaction. If the callback throws, the
   * transaction is rolled back.
   */
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;

  /**
   * Close the database connection.
   *
   * SQLite: Closes the underlying better-sqlite3 connection.
   * PostgreSQL (Neon): No-op since Neon HTTP is stateless.
   */
  close(): void;
}

/**
 * Standalone Service tag for DbClient.
 * Allows operations to yield* DbClientTag to get the project-scoped DbClient.
 */
export class DbClientTag extends Service<DbClient>()("dbClient") {}
