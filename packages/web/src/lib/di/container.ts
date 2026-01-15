/**
 * Web Container - Awilix DI container for Next.js API routes
 *
 * This module provides the dependency injection container for the web package.
 * AppServices are registered here and injected into endpoints via cradle.
 */

import {
  createContainer,
  asClass,
  asFunction,
  InjectionMode,
  type AwilixContainer,
} from "@dev-workflow/core";
import { ProjectsResolver, DbSourceProvider } from "@dev-workflow/core";
import { IssueAppService } from "../app-services/issue-app-service";
import { TaskAppService } from "../app-services/task-app-service";
import { ProjectAppService } from "../app-services/project-app-service";

// =============================================================================
// WebCradle - Types available for injection
// =============================================================================

/**
 * The cradle type defines what dependencies are available for injection.
 * Endpoints destructure what they need: `{ issueAppService }` from WebCradle
 */
export interface WebCradle {
  // Infrastructure (shared across all requests)
  projectsResolver: ProjectsResolver;
  sourceProvider: DbSourceProvider;

  // App Services (stateless, can be shared)
  issueAppService: IssueAppService;
  taskAppService: TaskAppService;
  projectAppService: ProjectAppService;
}

// =============================================================================
// Container Builder
// =============================================================================

/**
 * Build the web container with all dependencies registered.
 */
export function buildWebContainer(): AwilixContainer<WebCradle> {
  // Use PROXY injection mode - supports destructured parameters in asFunction callbacks.
  // CLASSIC mode requires named parameters matching registration keys exactly.
  const container = createContainer<WebCradle>({
    injectionMode: InjectionMode.PROXY,
  });

  container.register({
    // Infrastructure - singletons shared across requests
    projectsResolver: asClass(ProjectsResolver).singleton(),
    sourceProvider: asClass(DbSourceProvider).singleton(),

    // App Services - depend on infrastructure
    issueAppService: asFunction(
      ({ projectsResolver, sourceProvider }) =>
        new IssueAppService(projectsResolver, sourceProvider)
    ).singleton(),
    taskAppService: asFunction(
      ({ projectsResolver, sourceProvider }) => new TaskAppService(projectsResolver, sourceProvider)
    ).singleton(),
    projectAppService: asFunction(
      ({ projectsResolver, sourceProvider }) =>
        new ProjectAppService(projectsResolver, sourceProvider)
    ).singleton(),
  });

  return container;
}

// =============================================================================
// Production Container (singleton)
// =============================================================================

/**
 * The production container - lazily initialized on first use.
 * This is imported by createApiRoute to bind endpoints to dependencies.
 */
let _webContainer: AwilixContainer<WebCradle> | null = null;

export function getWebContainer(): AwilixContainer<WebCradle> {
  if (!_webContainer) {
    _webContainer = buildWebContainer();
  }
  return _webContainer;
}
