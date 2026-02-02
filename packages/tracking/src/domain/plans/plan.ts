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
  create(plan: Omit<Plan, "id" | "createdAt" | "updatedAt">): Promise<Plan>;

  /**
   * Find a plan by its UUID
   *
   * @param id - Plan UUID
   * @returns The plan if found, null otherwise
   */
  findById(id: string): Promise<Plan | null>;

  /**
   * Find the plan for an issue
   *
   * Returns the plan for the issue (one plan per issue).
   *
   * @param issueId - Issue UUID
   * @returns The plan if found, null otherwise
   */
  findByIssueId(issueId: string): Promise<Plan | null>;

  /**
   * Update an existing plan
   *
   * @param id - Plan UUID
   * @param data - Partial plan data to update
   * @returns The updated plan
   */
  update(id: string, data: Partial<Omit<Plan, "id" | "issueId" | "createdAt">>): Promise<Plan>;

  /**
   * Delete a plan
   *
   * @param id - Plan UUID
   */
  delete(id: string): Promise<void>;
}
