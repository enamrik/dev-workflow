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

import type { IssueRepository } from "./issue.js";
import type { PlanRepository } from "./plan.js";
import type { TaskRepository } from "./task.js";
import type { MilestoneRepository } from "./milestone.js";
import type { SnapshotRepository } from "./snapshot.js";
import type { ExecutionLogRepository } from "./execution-log.js";

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
   * Close the database connection.
   *
   * SQLite: Closes the underlying better-sqlite3 connection.
   * PostgreSQL (Neon): No-op since Neon HTTP is stateless.
   */
  close(): void;
}
