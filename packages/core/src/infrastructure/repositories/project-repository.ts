import { eq } from "drizzle-orm";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { projects, issues, milestones, snapshots, ProjectRow } from "../database/schema.js";
import type {
  Project,
  ProjectRepository,
  CreateProjectData,
  UpdateProjectData,
} from "../../domain/project.js";
import * as schema from "../database/schema.js";

/**
 * SQLite implementation of ProjectRepository
 *
 * Uses Drizzle ORM for type-safe queries.
 * Follows Repository pattern from DDD.
 *
 * Unlike other repositories, this is NOT scoped to a projectId
 * since it manages projects themselves.
 */
export class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  create(data: CreateProjectData): Project {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const project: Project = {
      id,
      gitRootHash: data.gitRootHash,
      name: data.name,
      githubSync: data.githubSync ?? null,
      isArchived: false,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    // Insert into database
    this.db
      .insert(projects)
      .values({
        id: project.id,
        gitRootHash: project.gitRootHash,
        name: project.name,
        githubSync: project.githubSync,
        isArchived: project.isArchived,
        archivedAt: project.archivedAt,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      })
      .run();

    return project;
  }

  findById(id: string): Project | null {
    const result = this.db.select().from(projects).where(eq(projects.id, id)).get();

    return result ? this.mapRowToProject(result) : null;
  }

  findByGitRootHash(gitRootHash: string): Project | null {
    const result = this.db
      .select()
      .from(projects)
      .where(eq(projects.gitRootHash, gitRootHash))
      .get();

    return result ? this.mapRowToProject(result) : null;
  }

  findAll(includeArchived: boolean = false): Project[] {
    let query = this.db.select().from(projects);

    if (!includeArchived) {
      query = query.where(eq(projects.isArchived, false)) as typeof query;
    }

    const results = query.all();
    return results.map((row) => this.mapRowToProject(row));
  }

  update(id: string, data: UpdateProjectData): Project {
    const now = new Date().toISOString();

    this.db
      .update(projects)
      .set({
        ...data,
        updatedAt: now,
      })
      .where(eq(projects.id, id))
      .run();

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Failed to update project: ${id}`);
    }

    return updated;
  }

  delete(id: string): void {
    this.db.delete(projects).where(eq(projects.id, id)).run();
  }

  archive(id: string): Project {
    const now = new Date().toISOString();

    this.db
      .update(projects)
      .set({
        isArchived: true,
        archivedAt: now,
        updatedAt: now,
      })
      .where(eq(projects.id, id))
      .run();

    const archived = this.findById(id);
    if (!archived) {
      throw new Error(`Failed to archive project: ${id}`);
    }

    return archived;
  }

  unarchive(id: string): Project {
    const now = new Date().toISOString();

    this.db
      .update(projects)
      .set({
        isArchived: false,
        archivedAt: null,
        updatedAt: now,
      })
      .where(eq(projects.id, id))
      .run();

    const unarchived = this.findById(id);
    if (!unarchived) {
      throw new Error(`Failed to unarchive project: ${id}`);
    }

    return unarchived;
  }

  hardDelete(id: string): void {
    // Delete in order to respect foreign key constraints
    // Note: plans and tasks cascade from issues, task_status_history and
    // task_execution_logs cascade from tasks

    // 1. Delete snapshots for this project
    this.db.delete(snapshots).where(eq(snapshots.projectId, id)).run();

    // 2. Delete milestones for this project
    this.db.delete(milestones).where(eq(milestones.projectId, id)).run();

    // 3. Delete issues for this project (cascades to plans, tasks, etc.)
    this.db.delete(issues).where(eq(issues.projectId, id)).run();

    // 4. Finally delete the project itself
    this.db.delete(projects).where(eq(projects.id, id)).run();
  }

  /**
   * Map database row to domain Project object
   */
  private mapRowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      gitRootHash: row.gitRootHash,
      name: row.name,
      githubSync: row.githubSync ?? null,
      isArchived: row.isArchived,
      archivedAt: row.archivedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
