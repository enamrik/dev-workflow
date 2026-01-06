/**
 * Domain types for Snapshot entity
 */

import type { IssueType, IssuePriority, IssueStatus } from "./issue.js";
import type { PlanComplexity } from "./plan.js";
import type { TaskStatus, TaskSource } from "./task.js";

export type SnapshotStatus = "ACTIVE" | "ARCHIVED";
export type SnapshotType = "MANUAL" | "ISSUE_UPDATE" | "PLAN_REGENERATION";

/**
 * Captured issue state at snapshot time
 */
export interface SnapshotIssueState {
  id: string;
  number: number;
  title: string;
  description: string;
  type: IssueType;
  priority: IssuePriority;
  status: IssueStatus;
  acceptanceCriteria: string[];
  templateUsed?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Captured plan state at snapshot time
 */
export interface SnapshotPlanState {
  id: string;
  issueId: string;
  summary: string;
  approach: string;
  estimatedComplexity: PlanComplexity;
  generatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Captured task state at snapshot time
 */
export interface SnapshotTaskState {
  id: string;
  planId: string;
  number: number; // Task number (stable identifier)
  order: number;
  title: string;
  description: string;
  status: TaskStatus;
  type: IssueType; // Task type (FEATURE, BUG, ENHANCEMENT, TASK)
  source: TaskSource;
  acceptanceCriteria: string[];
  estimatedMinutes?: number;
  isDeleted: boolean;
  deletedAt?: string;
  deletedBy?: string;
  dependsOn?: string[]; // Task dependencies
  startedAt?: string;
  completedAt?: string;
  abandonedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Snapshot entity
 *
 * Groups issue+plan+tasks into a versioned snapshot for complete version tracking.
 * Only one ACTIVE snapshot should exist per issue at a time.
 */
export interface Snapshot {
  readonly id: string; // UUID
  /** Project identifier (e.g., "dev-workflow-abc123") */
  readonly projectId: string;
  readonly issueNumber: number; // Link to issue
  readonly version: number; // Version number (1, 2, 3...)
  readonly status: SnapshotStatus;
  readonly snapshotType: SnapshotType;
  readonly issueState: SnapshotIssueState; // Captured issue state
  readonly planState: SnapshotPlanState | null; // Captured plan state (null if no plan)
  readonly tasksState: SnapshotTaskState[]; // Captured tasks state
  readonly createdBy: string; // Who/what created this snapshot
  readonly createdAt: string; // ISO date string
  readonly notes?: string; // Optional notes about this version
}

/**
 * Repository interface for Snapshot persistence
 *
 * Follows Repository pattern from DDD - abstracts data access
 * behind an interface for testability and flexibility.
 */
export interface SnapshotRepository {
  /**
   * Create a new snapshot
   *
   * Automatically assigns version number based on existing snapshots for the issue.
   * The projectId is provided by the repository implementation.
   *
   * @param snapshot - Snapshot data (without id, projectId, version, createdAt which are generated)
   * @returns The created snapshot with id, projectId, version, and timestamp assigned
   */
  create(snapshot: Omit<Snapshot, "id" | "projectId" | "version" | "createdAt">): Snapshot;

  /**
   * Find a snapshot by its UUID
   *
   * @param id - Snapshot UUID
   * @returns The snapshot if found, null otherwise
   */
  findById(id: string): Snapshot | null;

  /**
   * Find the active snapshot for an issue
   *
   * Returns the latest ACTIVE snapshot for the given issue number.
   *
   * @param issueNumber - Issue number
   * @returns The active snapshot if found, null otherwise
   */
  findActiveByIssueNumber(issueNumber: number): Snapshot | null;

  /**
   * Find all snapshots for an issue (all versions)
   *
   * Returns snapshots ordered by version DESC (newest first).
   *
   * @param issueNumber - Issue number
   * @returns Array of all snapshots for the issue
   */
  findByIssueNumber(issueNumber: number): Snapshot[];

  /**
   * Get the next version number for an issue
   *
   * Used internally by create() to assign sequential version numbers.
   *
   * @param issueNumber - Issue number
   * @returns The next version number (MAX(version) + 1, or 1 if no snapshots exist)
   */
  getNextVersion(issueNumber: number): number;

  /**
   * Archive the current active snapshot for an issue
   *
   * Sets status to ARCHIVED for the active snapshot.
   * Called before creating a new snapshot to maintain single active snapshot constraint.
   *
   * @param issueNumber - Issue number
   */
  archiveCurrent(issueNumber: number): void;

  /**
   * Find a snapshot by issue number and version
   *
   * @param issueNumber - Issue number
   * @param version - Version number
   * @returns The snapshot if found, null otherwise
   */
  findByVersion(issueNumber: number, version: number): Snapshot | null;
}
