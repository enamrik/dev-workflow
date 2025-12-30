/**
 * Domain types for Plan entity
 */

export type PlanComplexity = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

/**
 * Plan entity
 *
 * Represents an AI-generated implementation plan for an issue.
 * Plans are part of snapshots and versioned together with issues and tasks.
 */
export interface Plan {
  readonly id: string; // UUID
  readonly snapshotId: string; // Foreign key to Snapshot
  readonly issueId: string; // Foreign key to Issue
  readonly summary: string; // Brief summary of the plan
  readonly approach: string; // Detailed implementation approach (markdown)
  readonly estimatedComplexity: PlanComplexity;
  readonly generatedBy: string; // e.g., "claude-sonnet-4.5"
  readonly createdAt: string; // ISO date string
  readonly updatedAt: string; // ISO date string
}

/**
 * Repository interface for Plan persistence
 *
 * Follows Repository pattern from DDD - abstracts data access
 * behind an interface for testability and flexibility.
 */
export interface PlanRepository {
  /**
   * Create a new plan
   *
   * @param plan - Plan data (without id, createdAt, updatedAt which are generated)
   * @returns The created plan with id and timestamps assigned
   */
  create(plan: Omit<Plan, "id" | "createdAt" | "updatedAt">): Plan;

  /**
   * Find a plan by its UUID
   *
   * @param id - Plan UUID
   * @returns The plan if found, null otherwise
   */
  findById(id: string): Plan | null;

  /**
   * Find the active plan for an issue
   *
   * Returns the plan associated with the active snapshot for the issue.
   *
   * @param issueId - Issue UUID
   * @returns The active plan if found, null otherwise
   */
  findActiveByIssueId(issueId: string): Plan | null;

  /**
   * Find plan by snapshot ID
   *
   * Returns the plan for a specific snapshot (version).
   *
   * @param snapshotId - Snapshot UUID
   * @returns The plan if found, null otherwise
   */
  findBySnapshotId(snapshotId: string): Plan | null;
}
