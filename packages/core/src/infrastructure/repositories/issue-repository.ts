import { eq, max, and } from "drizzle-orm";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { issues, IssueRow } from "../database/schema.js";
import type { Issue, IssueFilters, IssueRepository } from "../../domain/issue.js";
import * as schema from "../database/schema.js";

/**
 * SQLite implementation of IssueRepository
 *
 * Uses Drizzle ORM for type-safe queries and automatic JSON serialization.
 * Follows Repository pattern from DDD.
 */
export class SqliteIssueRepository implements IssueRepository {
  constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  create(data: Omit<Issue, "id" | "number" | "createdAt" | "updatedAt">): Issue {
    const id = crypto.randomUUID();
    const number = this.getNextIssueNumber();
    const now = new Date().toISOString();

    const issue: Issue = {
      id,
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
      })
      .run();

    return issue;
  }

  findById(id: string): Issue | null {
    const result = this.db
      .select()
      .from(issues)
      .where(eq(issues.id, id))
      .get();

    return result ? this.mapRowToIssue(result) : null;
  }

  findByNumber(number: number): Issue | null {
    const result = this.db
      .select()
      .from(issues)
      .where(eq(issues.number, number))
      .get();

    return result ? this.mapRowToIssue(result) : null;
  }

  findMany(filters?: IssueFilters): Issue[] {
    let query = this.db.select().from(issues);

    // Apply SQL filters for status and type (scalar columns)
    const conditions = [];
    if (filters?.status) {
      conditions.push(eq(issues.status, filters.status));
    }
    if (filters?.type) {
      conditions.push(eq(issues.type, filters.type));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const results = query.all();

    // Map database rows to domain objects
    return results.map((row) => this.mapRowToIssue(row));
  }

  getNextIssueNumber(): number {
    const result = this.db
      .select({ maxNumber: max(issues.number) })
      .from(issues)
      .get();

    return (result?.maxNumber ?? 0) + 1;
  }

  update(
    id: string,
    data: Partial<Omit<Issue, "id" | "number" | "createdAt">>
  ): Issue {
    const now = new Date().toISOString();

    // Update the issue
    this.db
      .update(issues)
      .set({
        ...data,
        updatedAt: now,
      })
      .where(eq(issues.id, id))
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
    return {
      id: row.id,
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
    };
  }
}
