/**
 * Registers the infrastructure services that the ported web API operations
 * need but the base CLI container does not provide.
 *
 * The CLI container already registers: projectsResolver, sourceProvider,
 * workerQueueDb, eventBus. The web API additionally requires:
 * - typeDomainService (global type service)
 * - domain (DomainExecutorFactory, used by mutation operations in @dev-workflow/tracking)
 * - gitWorktreeService (GitWorktreeService tag, resolved by worktree operations)
 * - createWorktreeService (factory keyed to WorktreeServiceFactoryTag)
 *
 * Mirrors apps/web/src/lib/di/container.ts.
 */

import { asFunction, asValue, type AwilixContainer } from "awilix";
import { DomainExecutorFactory, TypeDomainService, DbSourceProvider } from "@dev-workflow/tracking";
import { NodeGitWorktreeService } from "@dev-workflow/git/worktrees/git-worktree-service.js";
import { getGlobalDatabasePath } from "@dev-workflow/git/track-directory-resolver.js";

export function registerWebApiServices(container: AwilixContainer): void {
  container.register({
    typeDomainService: asFunction(({ sourceProvider }: { sourceProvider: DbSourceProvider }) => {
      const connectionString = `sqlite://${getGlobalDatabasePath()}`;
      const source = sourceProvider.getOrCreate({ connectionString });
      return new TypeDomainService(source.types);
    }).singleton(),

    domain: asFunction(
      ({
        sourceProvider,
        typeDomainService,
      }: {
        sourceProvider: DbSourceProvider;
        typeDomainService: TypeDomainService;
      }) => new DomainExecutorFactory(sourceProvider, typeDomainService)
    ).singleton(),

    gitWorktreeService: asFunction(() => new NodeGitWorktreeService(process.cwd())).singleton(),

    createWorktreeService: asValue((gitRoot: string) => new NodeGitWorktreeService(gitRoot)),
  });
}
