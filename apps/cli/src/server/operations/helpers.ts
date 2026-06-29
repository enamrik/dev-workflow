/**
 * Shared helpers for web operation functions
 */

import type { ProjectInfo, DbSourceProvider, DbClient, DbSource } from "@dev-workflow/tracking";

/**
 * Resolve a provisioned DbSource from ProjectInfo + DbSourceProvider.
 *
 * The DbSource owns global repositories (projects, types, globalSettings,
 * milestones). Use this when an operation needs global (cross-project) data.
 */
export async function getDbSource(
  project: ProjectInfo,
  sourceProvider: DbSourceProvider
): Promise<DbSource> {
  const source = sourceProvider.getOrCreate(project.sourceInfo);
  await source.provision();
  return source;
}

/**
 * Resolve a DbClient from ProjectInfo + DbSourceProvider.
 */
export async function getDbClient(
  project: ProjectInfo,
  sourceProvider: DbSourceProvider
): Promise<DbClient> {
  const source = await getDbSource(project, sourceProvider);
  return source.createClient(project.projectId);
}

/**
 * Filter projects by slug or projectId.
 */
export function filterProjects(projects: ProjectInfo[], filter?: string): ProjectInfo[] {
  if (!filter) return projects;
  return projects.filter((p) => p.projectId === filter || p.slug === filter);
}
