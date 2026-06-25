import { eq } from "drizzle-orm";
import {
  projects,
  issues,
  milestones,
  snapshots,
  type ProjectRow,
} from "@dev-workflow/database/schema.js";
import { Effect } from "@dev-workflow/effect";
import type {
  Project,
  ProjectRepository,
  CreateProjectData,
  UpdateProjectData,
} from "./project.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";
import type { ProjectManagementConfig } from "@dev-workflow/database/schema.js";

/**
 * Migrate stored syncConfig from legacy typeLabels to typeMappings.
 *
 * Existing configs may have labels.typeLabels in the JSON column.
 * This normalizes them to labels.typeMappings on read so the rest
 * of the codebase only deals with the new name.
 */
function migrateSyncConfig(config: ProjectManagementConfig | null): ProjectManagementConfig | null {
  if (!config?.labels) return config;

  const raw = config.labels as unknown as Record<string, unknown>;
  if ("typeMappings" in raw) return config;
  if (!("typeLabels" in raw)) return config;

  const { typeLabels, ...rest } = raw;
  return {
    ...config,
    labels: { ...rest, typeMappings: typeLabels } as ProjectManagementConfig["labels"],
  };
}

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

  create(data: CreateProjectData): Effect<Project> {
    return Effect.promise(async () => {
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

      this.db
        .insert(projects)
        .values({
          id: project.id,
          gitRootHash: project.gitRootHash,
          name: project.name,
          slug: project.slug,
          syncConfig: project.syncConfig,
          isArchived: project.isArchived,
          archivedAt: project.archivedAt,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        })
        .run();

      return project;
    });
  }

  findById(id: string): Effect<Project | null> {
    return Effect.promise(async () => {
      const result = this.db.select().from(projects).where(eq(projects.id, id)).limit(1).get();
      return result ? this.mapRowToProject(result) : null;
    });
  }

  findByGitRootHash(gitRootHash: string): Effect<Project | null> {
    return Effect.promise(async () => {
      const result = this.db
        .select()
        .from(projects)
        .where(eq(projects.gitRootHash, gitRootHash))
        .limit(1)
        .get();
      return result ? this.mapRowToProject(result) : null;
    });
  }

  findBySlug(slug: string): Effect<Project | null> {
    return Effect.promise(async () => {
      const result = this.db.select().from(projects).where(eq(projects.slug, slug)).limit(1).get();
      return result ? this.mapRowToProject(result) : null;
    });
  }

  findAll(): Effect<Project[]> {
    return Effect.promise(async () => {
      const results = this.db.select().from(projects).all();
      return results.map((row) => this.mapRowToProject(row));
    });
  }

  update(id: string, data: UpdateProjectData): Effect<Project> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      self.db
        .update(projects)
        .set({
          ...data,
          updatedAt: now,
        })
        .where(eq(projects.id, id))
        .run();

      const updated = yield* self.findById(id);
      if (!updated) {
        throw new Error(`Failed to update project: ${id}`);
      }

      return updated;
    });
  }

  hardDelete(id: string): Effect<void> {
    return Effect.promise(async () => {
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
    });
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
      syncConfig: migrateSyncConfig(row.syncConfig ?? null),
      isArchived: row.isArchived,
      archivedAt: row.archivedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
