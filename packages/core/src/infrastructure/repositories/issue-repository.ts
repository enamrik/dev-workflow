import { eq, max, and } from "drizzle-orm";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { issues, IssueRow } from "../database/schema.js";
import type { Issue, IssueFilters, IssueRepository } from "../../domain/issue.js";
import type { GitHubSyncState, GitHubSyncStatus } from "../../domain/github.js";
import * as schema from "../database/schema.js";

/**
 * SQLite implementation of IssueRepository
 *
 * Uses Drizzle ORM for type-safe queries and automatic JSON serialization.
 * Follows Repository pattern from DDD.
 *
 * The repository is scoped to a specific project via projectId.
 * All queries automatically filter by this project.
 */
export class SqliteIssueRepository implements IssueRepository {
  constructor(
    private readonly db: BetterSQLite3Database<typeof schema>,
    private readonly projectId: string
  ) {}

  create(data: Omit<Issue, "id" | "number" | "projectId" | "createdAt" | "updatedAt">): Issue {
    const id = crypto.randomUUID();
    const number = this.getNextIssueNumber();
    const now = new Date().toISOString();

    const issue: Issue = {
      id,
      projectId: this.projectId,
      number,
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    // Insert into database
    this.db
      .insert(issues)
      .values({
        id: issue.id,
        projectId: issue.projectId,
        number: issue.number,
        title: issue.title,
        description: issue.description,
        type: issue.type,
        priority: issue.priority,
        status: issue.status,
        acceptanceCriteria: issue.acceptanceCriteria,
        templateUsed: issue.templateUsed,
        createdBy: issue.createdBy,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        // GitHub sync fields
        githubIssueNumber: issue.githubSync?.githubIssueNumber ?? null,
        githubUrl: issue.githubSync?.githubUrl ?? null,
        githubNodeId: issue.githubSync?.githubNodeId ?? null,
        githubSyncStatus: issue.githubSync?.syncStatus ?? null,
        githubLastSyncedAt: issue.githubSync?.lastSyncedAt ?? null,
        githubLastSyncError: issue.githubSync?.lastSyncError ?? null,
        githubProjectItemId: issue.githubSync?.projectItemId ?? null,
        // Milestone association
        milestoneId: issue.milestoneId ?? null,
      })
      .run();

    return issue;
  }

  findById(id: string): Issue | null {
    const result = this.db
      .select()
      .from(issues)
      .where(and(eq(issues.projectId, this.projectId), eq(issues.id, id)))
      .get();

    return result ? this.mapRowToIssue(result) : null;
  }

  findByNumber(number: number): Issue | null {
    const result = this.db
      .select()
      .from(issues)
      .where(and(eq(issues.projectId, this.projectId), eq(issues.number, number)))
      .get();

    return result ? this.mapRowToIssue(result) : null;
  }

  findMany(filters?: IssueFilters): Issue[] {
    // Always filter by project
    const conditions = [eq(issues.projectId, this.projectId)];

    // Apply additional SQL filters for status, type, and milestone (scalar columns)
    if (filters?.status) {
      conditions.push(eq(issues.status, filters.status));
    }
    if (filters?.type) {
      conditions.push(eq(issues.type, filters.type));
    }
    if (filters?.milestoneId) {
      conditions.push(eq(issues.milestoneId, filters.milestoneId));
    }

    const results = this.db
      .select()
      .from(issues)
      .where(and(...conditions))
      .all();

    // Map database rows to domain objects
    return results.map((row) => this.mapRowToIssue(row));
  }

  getNextIssueNumber(): number {
    const result = this.db
      .select({ maxNumber: max(issues.number) })
      .from(issues)
      .where(eq(issues.projectId, this.projectId))
      .get();

    return (result?.maxNumber ?? 0) + 1;
  }

  update(
    id: string,
    data: Partial<Omit<Issue, "id" | "number" | "projectId" | "createdAt">>
  ): Issue {
    const now = new Date().toISOString();

    // Build the update object, mapping githubSync to flat columns
    const { githubSync, ...restData } = data;
    const updateData: Record<string, unknown> = {
      ...restData,
      updatedAt: now,
    };

    // Map githubSync fields if provided
    if (githubSync !== undefined) {
      updateData["githubIssueNumber"] = githubSync?.githubIssueNumber ?? null;
      updateData["githubUrl"] = githubSync?.githubUrl ?? null;
      updateData["githubNodeId"] = githubSync?.githubNodeId ?? null;
      updateData["githubSyncStatus"] = githubSync?.syncStatus ?? null;
      updateData["githubLastSyncedAt"] = githubSync?.lastSyncedAt ?? null;
      updateData["githubLastSyncError"] = githubSync?.lastSyncError ?? null;
      updateData["githubProjectItemId"] = githubSync?.projectItemId ?? null;
    }

    // Update the issue (scoped to this project)
    this.db
      .update(issues)
      .set(updateData)
      .where(and(eq(issues.projectId, this.projectId), eq(issues.id, id)))
      .run();

    // Fetch and return the updated issue
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Failed to update issue: ${id}`);
    }

    return updated;
  }

  /**
   * Map database row to domain Issue object
   *
   * Handles type conversion and null-to-undefined mapping for optional fields.
   */
  private mapRowToIssue(row: IssueRow): Issue {
    // Build GitHub sync state if any GitHub fields are present
    const githubSync = this.mapRowToGitHubSync(row);

    return {
      id: row.id,
      projectId: row.projectId,
      number: row.number,
      title: row.title,
      description: row.description,
      type: row.type as Issue["type"],
      priority: row.priority as Issue["priority"],
      status: row.status as Issue["status"],
      acceptanceCriteria: row.acceptanceCriteria,
      templateUsed: row.templateUsed ?? undefined,
      createdBy: row.createdBy ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      githubSync,
      milestoneId: row.milestoneId ?? undefined,
    };
  }

  /**
   * Map database row GitHub fields to GitHubSyncState
   *
   * Returns undefined if no GitHub data is present.
   */
  private mapRowToGitHubSync(row: IssueRow): GitHubSyncState | undefined {
    // If no sync status, GitHub integration was never used for this issue
    if (!row.githubSyncStatus) {
      return undefined;
    }

    return {
      githubIssueNumber: row.githubIssueNumber ?? null,
      githubUrl: row.githubUrl ?? null,
      githubNodeId: row.githubNodeId ?? null,
      syncStatus: row.githubSyncStatus as GitHubSyncStatus,
      lastSyncedAt: row.githubLastSyncedAt ?? null,
      lastSyncError: row.githubLastSyncError ?? null,
      projectItemId: row.githubProjectItemId ?? null,
    };
  }
}
