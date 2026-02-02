/**
 * Web Container - Awilix DI container for Next.js API routes
 *
 * Infrastructure-only container. Operations are called directly by endpoints
 * and resolve their dependencies from the container via the Effect runtime.
 */

import {
  createContainer,
  asClass,
  asFunction,
  asValue,
  InjectionMode,
  type AwilixContainer,
} from "awilix";
import {
  ProjectsResolver,
  DbSourceProvider,
  DomainExecutorFactory,
  ProjectManagementService,
  NoOpProjectManagementClient,
} from "@dev-workflow/tracking";
import { GlobalDbWorkerQueueDb } from "@dev-workflow/local-workers/local-worker-queue-db.js";
import { NodeGitWorktreeService } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import type { GitWorktreeService } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import type { WorkerQueueDb } from "@dev-workflow/dispatch/worker-queue-db.js";

// =============================================================================
// WebCradle - Infrastructure dependencies only
// =============================================================================

/**
 * The cradle type defines what dependencies are available for injection.
 * Keys match the Service tag ids used by operations via yield*.
 */
export interface WebCradle {
  // Index signature required by createRuntime's Record<string, unknown> constraint
  [key: string]: unknown;

  // Infrastructure (shared across all requests)
  projectsResolver: ProjectsResolver;
  sourceProvider: DbSourceProvider;

  // Domain executor factory (for mutation operations)
  domain: DomainExecutorFactory;

  // Project management (no-op for web — real impl in MCP)
  projectManagement: ProjectManagementService;

  // Worker queue (for board + worker endpoints)
  workerQueueDb: WorkerQueueDb;

  // Worktree service factory (for worktree endpoints)
  createWorktreeService: (gitRoot: string) => GitWorktreeService;
}

// =============================================================================
// Container Builder
// =============================================================================

/**
 * Build the web container with infrastructure dependencies.
 */
export function buildWebContainer(): AwilixContainer<WebCradle> {
  const container = createContainer<WebCradle>({
    injectionMode: InjectionMode.PROXY,
  });

  container.register({
    projectsResolver: asClass(ProjectsResolver).singleton(),
    sourceProvider: asClass(DbSourceProvider).singleton(),

    domain: asFunction(
      ({ sourceProvider }) => new DomainExecutorFactory(sourceProvider)
    ).singleton(),

    projectManagement: asFunction(
      () => new ProjectManagementService(new NoOpProjectManagementClient())
    ).singleton(),

    workerQueueDb: asFunction(() => new GlobalDbWorkerQueueDb()).singleton(),

    createWorktreeService: asValue((gitRoot: string) => new NodeGitWorktreeService(gitRoot)),
  });

  return container;
}

// =============================================================================
// Production Container (singleton)
// =============================================================================

let _webContainer: AwilixContainer<WebCradle> | null = null;

export function getWebContainer(): AwilixContainer<WebCradle> {
  if (!_webContainer) {
    _webContainer = buildWebContainer();
  }
  return _webContainer;
}
