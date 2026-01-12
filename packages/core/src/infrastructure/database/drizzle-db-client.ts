/**
 * DrizzleDbClient - Drizzle implementation of DbClient
 *
 * Takes DrizzleDb (dialect-agnostic) and creates project-scoped repositories.
 * Created via DbSource.createClient(projectId).
 *
 * Global repositories (projects, types, globalSettings) are on DbSource.
 */

import type { DbClient } from "../../domain/db-client.js";
import type { DrizzleDb } from "../../domain/drizzle-db.js";
import type { IssueRepository } from "../../domain/issue.js";
import type { PlanRepository } from "../../domain/plan.js";
import type { TaskRepository } from "../../domain/task.js";
import type { MilestoneRepository } from "../../domain/milestone.js";
import type { SnapshotRepository } from "../../domain/snapshot.js";
import type { WorkerRepository, DispatchQueueRepository } from "../../domain/worker.js";
import type { ExecutionLogRepository } from "../../domain/execution-log.js";

// Repository implementations
import { DrizzleIssueRepository } from "../repositories/issue-repository.js";
import { DrizzlePlanRepository } from "../repositories/plan-repository.js";
import { DrizzleTaskRepository } from "../repositories/task-repository.js";
import { DrizzleMilestoneRepository } from "../repositories/milestone-repository.js";
import { DrizzleSnapshotRepository } from "../repositories/snapshot-repository.js";
import { DrizzleWorkerRepository } from "../repositories/worker-repository.js";
import { DrizzleDispatchQueueRepository } from "../repositories/dispatch-queue-repository.js";
import { DrizzleExecutionLogRepository } from "../repositories/execution-log-repository.js";

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
  readonly workers: WorkerRepository;
  readonly dispatchQueue: DispatchQueueRepository;
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
    this.workers = new DrizzleWorkerRepository(db);
    this.dispatchQueue = new DrizzleDispatchQueueRepository(db);
  }

  /**
   * Close is a no-op - DbSource owns the connection
   */
  close(): void {
    // DbSource owns the connection, not DbClient
  }
}
