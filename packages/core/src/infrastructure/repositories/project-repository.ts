import { eq } from "drizzle-orm";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { projects, ProjectRow } from "../database/schema.js";
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
  constructor(
    private readonly db: BetterSQLite3Database<typeof schema>
  ) {}

  create(data: CreateProjectData): Project {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const project: Project = {
      id,
      gitRootHash: data.gitRootHash,
      name: data.name,
      gitRoot: data.gitRoot,
      githubSync: data.githubSync ?? null,
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
        gitRoot: project.gitRoot,
        githubSync: project.githubSync,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      })
      .run();

    return project;
  }

  findById(id: string): Project | null {
    const result = this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .get();

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

  findAll(): Project[] {
    const results = this.db
      .select()
      .from(projects)
      .all();

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
    this.db
      .delete(projects)
      .where(eq(projects.id, id))
      .run();
  }

  /**
   * Map database row to domain Project object
   */
  private mapRowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      gitRootHash: row.gitRootHash,
      name: row.name,
      gitRoot: row.gitRoot,
      githubSync: row.githubSync ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
