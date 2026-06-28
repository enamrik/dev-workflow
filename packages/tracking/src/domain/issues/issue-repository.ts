/**
 * Issue Repository
 *
 * Drizzle implementation of IssueRepository. Project-scoped via constructor.
 * Pure data access — no business logic, no external sync.
 */

import { eq, max, and, sql, like, or, notInArray } from "drizzle-orm";
import { issues, type IssueRow } from "@dev-workflow/database/schema.js";
import {
  Issue,
  type IssueData,
  type IssueFilters,
  type IssueRepository,
  type CreateIssueParams,
  type UpdateIssueParams,
} from "./issue.js";
import type { SyncState, SyncStatus } from "@dev-workflow/database/schema.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Mapper Functions (shared by both repositories)
// =============================================================================

function mapRowToSyncState(row: IssueRow): SyncState | undefined {
  if (!row.syncStatus) return undefined;

  return {
    // Convert to string in case it was stored as integer from old schema
    externalId: row.externalId != null ? String(row.externalId) : undefined,
    externalUrl: row.externalUrl ?? undefined,
    externalNodeId: row.externalNodeId ?? undefined,
    syncStatus: row.syncStatus as SyncStatus,
    lastSyncedAt: row.lastSyncedAt ?? undefined,
    lastSyncError: row.lastSyncError ?? undefined,
    remoteProjectId: row.remoteProjectId ?? undefined,
  };
}

function mapRowToIssue(row: IssueRow): Issue {
  const data: IssueData = {
    id: row.id,
    projectId: row.projectId,
    number: row.number,
    title: row.title,
    description: row.description,
    type: row.type as IssueData["type"],
    priority: row.priority as IssueData["priority"],
    status: row.status as IssueData["status"],
    acceptanceCriteria: row.acceptanceCriteria,
    templateUsed: row.templateUsed ?? undefined,
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    syncState: mapRowToSyncState(row),
    milestoneId: row.milestoneId ?? undefined,
    // Convert to string in case it was stored as integer from old schema
    sourceExternalId: row.sourceExternalId != null ? String(row.sourceExternalId) : undefined,
    labels: row.labels ?? undefined,
    isDeleted: row.isDeleted,
    deletedAt: row.deletedAt ?? undefined,
    deletedBy: row.deletedBy ?? undefined,
  };
  return Issue.from(data);
}

/**
 * Drizzle implementation of IssueRepository
 *
 * Uses Drizzle ORM for type-safe queries and automatic JSON serialization.
 * Follows Repository pattern from DDD.
 * Works with any Drizzle-supported database dialect.
 *
 * The repository is scoped to a specific project via projectId.
 * All queries automatically filter by this project.
 */
export class DrizzleIssueRepository implements IssueRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly projectId: string
  ) {}

  create(data: CreateIssueParams): Effect<Issue> {
    const db = this.db;
    const projectId = this.projectId;
    const getNext = () => this.getNextIssueNumber();
    return Effect.gen(function* () {
      const id = crypto.randomUUID();
      const number = yield* getNext();
      const now = new Date().toISOString();

      const issue: Issue = Issue.from({
        id,
        projectId,
        number,
        ...data,
        createdAt: now,
        updatedAt: now,
      });

      // Insert into database
      db.insert(issues)
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
          // External sync state fields
          externalId: issue.syncState?.externalId ?? null,
          externalUrl: issue.syncState?.externalUrl ?? null,
          externalNodeId: issue.syncState?.externalNodeId ?? null,
          syncStatus: issue.syncState?.syncStatus ?? null,
          lastSyncedAt: issue.syncState?.lastSyncedAt ?? null,
          lastSyncError: issue.syncState?.lastSyncError ?? null,
          remoteProjectId: issue.syncState?.remoteProjectId ?? null,
          // Milestone association
          milestoneId: issue.milestoneId ?? null,
          // Source external issue for imports
          sourceExternalId: issue.sourceExternalId ?? null,
          // Labels
          labels: issue.labels ?? null,
        })
        .run();

      return issue;
    });
  }

  findById(id: string, includeDeleted = false): Effect<Issue | null> {
    return Effect.promise(async () => {
      const conditions = [eq(issues.projectId, this.projectId), eq(issues.id, id)];
      if (!includeDeleted) {
        conditions.push(eq(issues.isDeleted, false));
      }

      const result = this.db
        .select()
        .from(issues)
        .where(and(...conditions))
        .get();

      return result ? mapRowToIssue(result) : null;
    });
  }

  findByNumber(number: number, includeDeleted = false): Effect<Issue | null> {
    return Effect.promise(async () => {
      const conditions = [eq(issues.projectId, this.projectId), eq(issues.number, number)];
      if (!includeDeleted) {
        conditions.push(eq(issues.isDeleted, false));
      }

      const result = this.db
        .select()
        .from(issues)
        .where(and(...conditions))
        .get();

      return result ? mapRowToIssue(result) : null;
    });
  }

  findMany(filters?: IssueFilters): Effect<Issue[]> {
    return Effect.promise(async () => {
      // Always filter by project
      const conditions = [eq(issues.projectId, this.projectId)];

      // Exclude deleted issues by default
      if (!filters?.includeDeleted) {
        conditions.push(eq(issues.isDeleted, false));
      }

      // Apply additional SQL filters for status, type, and milestone (scalar columns)
      if (filters?.status) {
        conditions.push(eq(issues.status, filters.status));
      }
      if (filters?.excludeStatuses && filters.excludeStatuses.length > 0) {
        conditions.push(notInArray(issues.status, filters.excludeStatuses));
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
      return results.map((row) => mapRowToIssue(row));
    });
  }

  getNextIssueNumber(): Effect<number> {
    return Effect.promise(async () => {
      const result = this.db
        .select({ maxNumber: max(issues.number) })
        .from(issues)
        .where(eq(issues.projectId, this.projectId))
        .get();

      return (result?.maxNumber ?? 0) + 1;
    });
  }

  update(id: string, data: UpdateIssueParams): Effect<Issue> {
    const db = this.db;
    const projectId = this.projectId;
    const findById = (issueId: string) => this.findById(issueId);
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      // Build the update object, mapping syncState to flat columns
      const { syncState, milestoneId, sourceExternalId, labels, ...restData } = data;
      const updateData: Record<string, unknown> = {
        ...restData,
        updatedAt: now,
      };

      // Handle milestoneId explicitly (null means unassign from milestone)
      if ("milestoneId" in data) {
        updateData["milestoneId"] = milestoneId ?? null;
      }

      // Handle sourceExternalId explicitly
      if ("sourceExternalId" in data) {
        updateData["sourceExternalId"] = sourceExternalId ?? null;
      }

      // Handle labels explicitly (null means clear labels)
      if ("labels" in data) {
        updateData["labels"] = labels ?? null;
      }

      // Map syncState fields if provided
      if (syncState !== undefined) {
        updateData["externalId"] = syncState?.externalId ?? null;
        updateData["externalUrl"] = syncState?.externalUrl ?? null;
        updateData["externalNodeId"] = syncState?.externalNodeId ?? null;
        updateData["syncStatus"] = syncState?.syncStatus ?? null;
        updateData["lastSyncedAt"] = syncState?.lastSyncedAt ?? null;
        updateData["lastSyncError"] = syncState?.lastSyncError ?? null;
        updateData["remoteProjectId"] = syncState?.remoteProjectId ?? null;
      }

      // Update the issue (scoped to this project)
      db.update(issues)
        .set(updateData)
        .where(and(eq(issues.projectId, projectId), eq(issues.id, id)))
        .run();

      // Fetch and return the updated issue
      const updated = yield* findById(id);
      if (!updated) {
        throw new Error(`Failed to update issue: ${id}`);
      }

      return updated;
    });
  }

  delete(id: string, deletedBy: string): Effect<Issue> {
    const db = this.db;
    const projectId = this.projectId;
    const findById = (issueId: string, includeDeleted?: boolean) =>
      this.findById(issueId, includeDeleted);
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      // Check if issue exists first
      const existing = yield* findById(id, true);
      if (!existing) {
        throw new Error(`Issue not found: ${id}`);
      }

      if (existing.isDeleted) {
        throw new Error(`Issue is already deleted: ${id}`);
      }

      // Soft delete the issue
      db.update(issues)
        .set({
          isDeleted: true,
          deletedAt: now,
          deletedBy,
          updatedAt: now,
        })
        .where(and(eq(issues.projectId, projectId), eq(issues.id, id)))
        .run();

      // Fetch and return the deleted issue
      const deleted = yield* findById(id, true);
      if (!deleted) {
        throw new Error(`Failed to delete issue: ${id}`);
      }

      return deleted;
    });
  }

  restore(id: string): Effect<Issue> {
    const db = this.db;
    const projectId = this.projectId;
    const findById = (issueId: string, includeDeleted?: boolean) =>
      this.findById(issueId, includeDeleted);
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      // Check if issue exists and is deleted
      const existing = yield* findById(id, true);
      if (!existing) {
        throw new Error(`Issue not found: ${id}`);
      }

      if (!existing.isDeleted) {
        throw new Error(`Issue is not deleted: ${id}`);
      }

      // Restore the issue
      db.update(issues)
        .set({
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          updatedAt: now,
        })
        .where(and(eq(issues.projectId, projectId), eq(issues.id, id)))
        .run();

      // Fetch and return the restored issue
      const restored = yield* findById(id);
      if (!restored) {
        throw new Error(`Failed to restore issue: ${id}`);
      }

      return restored;
    });
  }

  /**
   * Get counts of issues by status
   *
   * Returns counts for each status, excluding soft-deleted issues.
   */
  getStatusCounts(): Effect<Record<string, number>> {
    return Effect.promise(async () => {
      const results = this.db
        .select({
          status: issues.status,
          count: sql<number>`count(*)`,
        })
        .from(issues)
        .where(and(eq(issues.projectId, this.projectId), eq(issues.isDeleted, false)))
        .groupBy(issues.status)
        .all();

      // Initialize all statuses to 0
      const counts: Record<string, number> = {
        PLANNED: 0,
        OPEN: 0,
        IN_PROGRESS: 0,
        CLOSED: 0,
      };

      // Fill in actual counts
      for (const row of results) {
        counts[row.status] = row.count;
      }

      return counts;
    });
  }

  /**
   * Search issues by keyword in title or description
   *
   * Returns slim issue objects (id, number, title, status, type, priority).
   * Case-insensitive search, limited to 10 results.
   */
  search(
    query: string
  ): Effect<Pick<Issue, "id" | "number" | "title" | "status" | "type" | "priority">[]> {
    return Effect.promise(async () => {
      const searchPattern = `%${query}%`;

      const results = this.db
        .select({
          id: issues.id,
          number: issues.number,
          title: issues.title,
          status: issues.status,
          type: issues.type,
          priority: issues.priority,
        })
        .from(issues)
        .where(
          and(
            eq(issues.projectId, this.projectId),
            eq(issues.isDeleted, false),
            or(
              like(sql`lower(${issues.title})`, sql`lower(${searchPattern})`),
              like(sql`lower(${issues.description})`, sql`lower(${searchPattern})`)
            )
          )
        )
        .limit(10)
        .all();

      return results.map((row) => ({
        id: row.id,
        number: row.number,
        title: row.title,
        status: row.status as Issue["status"],
        type: row.type as Issue["type"],
        priority: row.priority as Issue["priority"],
      }));
    });
  }
}
