/**
 * Shared helpers for web operation functions
 */

import type { ProjectInfo, DbSourceProvider, DbClient } from "@dev-workflow/tracking";

/**
 * Resolve a DbClient from ProjectInfo + DbSourceProvider.
 */
export async function getDbClient(
  project: ProjectInfo,
  sourceProvider: DbSourceProvider
): Promise<DbClient> {
  const source = sourceProvider.getOrCreate(project.sourceInfo);
  await source.provision();
  return source.createClient(project.projectId);
}

/**
 * Filter projects by slug or projectId.
 */
export function filterProjects(projects: ProjectInfo[], filter?: string): ProjectInfo[] {
  if (!filter) return projects;
  return projects.filter((p) => p.projectId === filter || p.slug === filter);
}
