/**
 * DrizzleDbClient - Drizzle implementation of DbClient
 *
 * Takes DrizzleDb (dialect-agnostic) and creates project-scoped repositories.
 * Created via DbSource.createClient(projectId).
 *
 * Global repositories (projects, types, globalSettings, milestones) are on DbSource.
 */

import type { DbClient } from "./db-client.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";
import type { IssueRepository } from "../domain/issues/issue.js";
import type { PlanRepository } from "../domain/plans/plan.js";
import type { TaskRepository } from "../domain/tasks/task.js";
import type { SnapshotRepository } from "../domain/snapshots/snapshot.js";
import type { ExecutionLogRepository } from "../domain/execution-log.js";

// Repository implementations
import { DrizzleIssueRepository } from "../domain/issues/issue-repository.js";
import { DrizzlePlanRepository } from "../domain/plans/plan-repository.js";
import { DrizzleTaskRepository } from "../domain/tasks/task-repository.js";
import { DrizzleSnapshotRepository } from "../domain/snapshots/snapshot-repository.js";
import { DrizzleExecutionLogRepository } from "../domain/execution-log-repository.js";

/**
 * Drizzle implementation of DbClient
 *
 * Provides project-scoped repository access. Created via DbSource.createClient().
 * The DbSource owns the connection - DbClient.close() is a no-op.
 */
export class DrizzleDbClient implements DbClient {
  readonly issues: IssueRepository;
  readonly plans: PlanRepository;
  readonly tasks: TaskRepository;
  readonly snapshots: SnapshotRepository;
  readonly executionLogs: ExecutionLogRepository;

  /**
   * Create a DbClient for a specific project
   *
   * @param db - DrizzleDb instance (dialect-agnostic)
   * @param projectId - The project to scope repositories to
   */
  constructor(
    private readonly db: DrizzleDb,
    public readonly projectId: string
  ) {
    // Project-scoped repositories
    this.issues = new DrizzleIssueRepository(db, projectId);
    this.snapshots = new DrizzleSnapshotRepository(db, projectId);

    // Non-scoped repositories (still on DbClient for operational use)
    this.plans = new DrizzlePlanRepository(db);
    this.tasks = new DrizzleTaskRepository(db);
    this.executionLogs = new DrizzleExecutionLogRepository(db);
  }

  /**
   * Execute a function inside a database transaction.
   *
   * Creates a new DbClient whose repositories are scoped to the
   * transactional connection. Commits on success, rolls back on throw.
   */
  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.db.transaction(async (txDb) => {
      const txClient = new DrizzleDbClient(txDb, this.projectId);
      return fn(txClient);
    });
  }

  /**
   * Close is a no-op - DbSource owns the connection
   */
  close(): void {
    // DbSource owns the connection, not DbClient
  }
}
