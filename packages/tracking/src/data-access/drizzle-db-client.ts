/**
 * DrizzleDbClient - Drizzle implementation of DbClient
 *
 * Takes DrizzleDb (dialect-agnostic) and creates project-scoped repositories.
 * Created via DbSource.createClient(projectId).
 *
 * Global repositories (projects, types, globalSettings) are on DbSource.
 */

import type { DbClient } from "./db-client.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";
import type { IssueRepository } from "../issues/issue.js";
import type { PlanRepository } from "../plans/plan.js";
import type { TaskRepository } from "../tasks/task.js";
import type { MilestoneRepository } from "../milestones/milestone.js";
import type { SnapshotRepository } from "../snapshots/snapshot.js";
import type { ExecutionLogRepository } from "../execution-log.js";

// Repository implementations
import { DrizzleIssueRepository } from "../issues/issue-repository.js";
import { DrizzlePlanRepository } from "../plans/plan-repository.js";
import { DrizzleTaskRepository } from "../tasks/task-repository.js";
import { DrizzleMilestoneRepository } from "../milestones/milestone-repository.js";
import { DrizzleSnapshotRepository } from "../snapshots/snapshot-repository.js";
import { DrizzleExecutionLogRepository } from "../execution-log-repository.js";

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
  readonly milestones: MilestoneRepository;
  readonly snapshots: SnapshotRepository;
  readonly executionLogs: ExecutionLogRepository;

  /**
   * Create a DbClient for a specific project
   *
   * @param db - DrizzleDb instance (dialect-agnostic)
   * @param projectId - The project to scope repositories to
   */
  constructor(
    db: DrizzleDb,
    public readonly projectId: string
  ) {
    // Project-scoped repositories
    this.issues = new DrizzleIssueRepository(db, projectId);
    this.milestones = new DrizzleMilestoneRepository(db, projectId);
    this.snapshots = new DrizzleSnapshotRepository(db, projectId);

    // Non-scoped repositories (still on DbClient for operational use)
    this.plans = new DrizzlePlanRepository(db);
    this.tasks = new DrizzleTaskRepository(db);
    this.executionLogs = new DrizzleExecutionLogRepository(db);
  }

  /**
   * Close is a no-op - DbSource owns the connection
   */
  close(): void {
    // DbSource owns the connection, not DbClient
  }
}
