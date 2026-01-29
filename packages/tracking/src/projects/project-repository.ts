import { eq } from "drizzle-orm";
import {
  projects,
  issues,
  milestones,
  snapshots,
  type ProjectRow,
} from "@dev-workflow/database/schema.js";
import type {
  Project,
  ProjectRepository,
  CreateProjectData,
  UpdateProjectData,
} from "./project.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";

/**
 * Generate a URL-safe slug from project name and git root hash
 *
 * Format: {slugified-name}-{first 6 chars of hash}
 * Example: "dev-workflow-b9bccf"
 */
function generateSlug(name: string, gitRootHash: string): string {
  const slugifiedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const shortHash = gitRootHash.slice(0, 6);
  return `${slugifiedName}-${shortHash}`;
}

/**
 * Drizzle implementation of ProjectRepository
 *
 * Uses Drizzle ORM for type-safe queries.
 * Follows Repository pattern from DDD.
 * Works with any Drizzle-supported database dialect.
 *
 * Unlike other repositories, this is NOT scoped to a projectId
 * since it manages projects themselves.
 */
export class DrizzleProjectRepository implements ProjectRepository {
  constructor(private readonly db: DrizzleDb) {}

  async create(data: CreateProjectData): Promise<Project> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const slug = generateSlug(data.name, data.gitRootHash);

    const project: Project = {
      id,
      gitRootHash: data.gitRootHash,
      name: data.name,
      slug,
      syncConfig: data.syncConfig ?? null,
      isArchived: false,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    // Insert into database
    await this.db.insert(projects).values({
      id: project.id,
      gitRootHash: project.gitRootHash,
      name: project.name,
      slug: project.slug,
      syncConfig: project.syncConfig,
      isArchived: project.isArchived,
      archivedAt: project.archivedAt,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });

    return project;
  }

  async findById(id: string): Promise<Project | null> {
    const [result] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return result ? this.mapRowToProject(result) : null;
  }

  async findByGitRootHash(gitRootHash: string): Promise<Project | null> {
    const [result] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.gitRootHash, gitRootHash))
      .limit(1);
    return result ? this.mapRowToProject(result) : null;
  }

  async findBySlug(slug: string): Promise<Project | null> {
    const [result] = await this.db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    return result ? this.mapRowToProject(result) : null;
  }

  async findAll(includeArchived: boolean = false): Promise<Project[]> {
    const results = includeArchived
      ? await this.db.select().from(projects)
      : await this.db.select().from(projects).where(eq(projects.isArchived, false));
    return results.map((row) => this.mapRowToProject(row));
  }

  async update(id: string, data: UpdateProjectData): Promise<Project> {
    const now = new Date().toISOString();

    await this.db
      .update(projects)
      .set({
        ...data,
        updatedAt: now,
      })
      .where(eq(projects.id, id));

    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`Failed to update project: ${id}`);
    }

    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  async archive(id: string): Promise<Project> {
    const now = new Date().toISOString();

    await this.db
      .update(projects)
      .set({
        isArchived: true,
        archivedAt: now,
        updatedAt: now,
      })
      .where(eq(projects.id, id));

    const archived = await this.findById(id);
    if (!archived) {
      throw new Error(`Failed to archive project: ${id}`);
    }

    return archived;
  }

  async unarchive(id: string): Promise<Project> {
    const now = new Date().toISOString();

    await this.db
      .update(projects)
      .set({
        isArchived: false,
        archivedAt: null,
        updatedAt: now,
      })
      .where(eq(projects.id, id));

    const unarchived = await this.findById(id);
    if (!unarchived) {
      throw new Error(`Failed to unarchive project: ${id}`);
    }

    return unarchived;
  }

  async hardDelete(id: string): Promise<void> {
    // Delete in order to respect foreign key constraints
    // Note: plans and tasks cascade from issues, task_status_history and
    // task_execution_logs cascade from tasks

    // 1. Delete snapshots for this project
    await this.db.delete(snapshots).where(eq(snapshots.projectId, id));

    // 2. Delete milestones for this project
    await this.db.delete(milestones).where(eq(milestones.projectId, id));

    // 3. Delete issues for this project (cascades to plans, tasks, etc.)
    await this.db.delete(issues).where(eq(issues.projectId, id));

    // 4. Finally delete the project itself
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  /**
   * Map database row to domain Project object
   */
  private mapRowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      gitRootHash: row.gitRootHash,
      name: row.name,
      slug: row.slug,
      syncConfig: row.syncConfig ?? null,
      isArchived: row.isArchived,
      archivedAt: row.archivedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
