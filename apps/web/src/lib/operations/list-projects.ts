/**
 * listProjects / listProjectsWithSync - List projects with stats or sync config
 */

import { Effect } from "@dev-workflow/effect";
import { ProjectsResolver, DbSourceProvider } from "@dev-workflow/tracking";
import { getDbClient } from "./helpers";

// =============================================================================
// Types
// =============================================================================

export interface ProjectWithStats {
  projectId: string;
  name: string;
  slug: string;
  issueCount: number;
  taskCount: number;
}

export interface ProjectApiInfo {
  id: string;
  name: string;
  slug: string;
  gitRoot: string;
  syncConfig: object | null;
}

// =============================================================================
// Operations
// =============================================================================

export function listProjectsWithSync() {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const sourceProvider = yield* DbSourceProvider;

    const projects = yield* projectsResolver.getAllProjects();

    const enrichedProjects = yield* projectsResolver.enrichWithDbData(
      projects,
      async (sourceInfo) => {
        const source = sourceProvider.getOrCreate(sourceInfo);
        await source.provision();
        return source;
      }
    );

    return enrichedProjects.map((p) => ({
      id: p.projectId,
      name: p.name,
      slug: p.slug,
      gitRoot: p.gitRoot,
      syncConfig: p.syncConfig ?? null,
    }));
  });
}

export function listProjects() {
  return Effect.gen(function* () {
    const projectsResolver = yield* ProjectsResolver;
    const sourceProvider = yield* DbSourceProvider;

    const projects = yield* projectsResolver.getAllProjects();
    const result: ProjectWithStats[] = [];

    for (const project of projects) {
      try {
        const db = yield* Effect.promise(() => getDbClient(project, sourceProvider));
        const issues = yield* db.issues.findMany({});
        const plans = [];
        for (const issue of issues) {
          const plan = yield* db.plans.findByIssueId(issue.id);
          if (plan) plans.push(plan);
        }
        let taskCount = 0;
        for (const plan of plans) {
          const tasks = yield* db.tasks.findByPlanId(plan.id);
          taskCount += tasks.length;
        }

        result.push({
          projectId: project.projectId,
          name: project.name,
          slug: project.slug,
          issueCount: issues.length,
          taskCount,
        });
      } catch {
        // Skip inaccessible projects
      }
    }

    return result;
  });
}
