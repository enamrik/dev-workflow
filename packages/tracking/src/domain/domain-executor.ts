/**
 * DomainExecutorFactory - Creates per-project domain contexts
 *
 * Wires DbSourceProvider → DbClient → repos → domain services per project.
 * Provides a transaction() wrapper that rebuilds domain services with
 * a transactional DbClient.
 *
 * Usage:
 * ```typescript
 * const { issues, tasks, transaction } = domain.forProject(projectSlug);
 *
 * // Single domain call (no transaction needed)
 * issues.close(issueId);
 *
 * // Multiple domain calls (wrap in transaction)
 * await transaction(async (tx) => {
 *   tx.issues.close(issueId);
 *   tx.tasks.abandonAllForIssue(issueId);
 * });
 * ```
 */

import { Effect, Service } from "@dev-workflow/effect";
import type { DbClient } from "../data-access/db-client.js";
import type { DbSourceProvider } from "../data-access/db-source-provider.js";
import { resolveConfig } from "./projects/projects-resolver.js";
import { IssueDomainService } from "./issues/issue-domain-service.js";
import { TaskDomainService } from "./tasks/task-domain-service.js";
import { PlanDomainService } from "./plans/plan-domain-service.js";
import { MilestoneDomainService } from "./milestones/milestone-domain-service.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Domain services available for a project.
 *
 * Each service encapsulates business logic over repositories.
 * Services are stateless — they can be recreated per-transaction.
 */
export interface DomainServices {
  readonly issues: IssueDomainService;
  readonly tasks: TaskDomainService;
  readonly plans: PlanDomainService;
  readonly milestones: MilestoneDomainService;
}

/**
 * ProjectDomain extends DomainServices with a transaction wrapper.
 *
 * Destructure to get domain services and the transaction function:
 * ```typescript
 * const { issues, tasks, transaction } = domain.forProject(slug);
 * ```
 */
export type ProjectDomain = DomainServices & {
  /**
   * Execute a function inside a database transaction.
   *
   * The callback receives DomainServices whose underlying repositories
   * are scoped to the transaction. Commits on success, rolls back on throw.
   */
  transaction: <T, E>(fn: (tx: DomainServices) => Effect<T, E, never>) => Effect<T, E, never>;
};

// =============================================================================
// Factory
// =============================================================================

export class DomainExecutorFactory extends Service<DomainExecutorFactory>()("domain") {
  constructor(private readonly sourceProvider: DbSourceProvider) {
    super();
  }

  /**
   * Create a ProjectDomain for a project slug.
   *
   * Resolves the slug to a DbClient via config files and DbSourceProvider,
   * then builds domain services.
   */
  forProject(projectSlug: string): Effect<ProjectDomain, never, never> {
    return Effect.promise(async () => {
      const config = await resolveConfig(projectSlug);
      const source = this.sourceProvider.getOrCreate({
        connectionString: config.database,
      });
      const db = source.createClient(config.projectId);
      return this.fromClient(db);
    });
  }

  /**
   * Create a ProjectDomain from an existing DbClient.
   *
   * Use this when the DbClient is already resolved (e.g., from DI container).
   */
  fromClient(db: DbClient): ProjectDomain {
    return {
      ...this.buildServices(db),
      transaction: <T, E>(fn: (tx: DomainServices) => Effect<T, E, never>): Effect<T, E, never> => {
        return Effect.tryPromise({
          try: () =>
            // db.transaction requires a Promise callback - Effect.runPromise is the
            // correct boundary between Effect and the Promise-based transaction API
            db.transaction(async (txClient) => {
              const txServices = this.buildServices(txClient);
              return Effect.runPromise(fn(txServices));
            }),
          catch: (e) => e as E,
        });
      },
    };
  }

  /**
   * Build domain services from a DbClient.
   *
   * Called both for direct use and inside transactions (with a tx-scoped DbClient).
   */
  private buildServices(db: DbClient): DomainServices {
    return {
      issues: new IssueDomainService(db.issues),
      tasks: new TaskDomainService(db.tasks, db.plans),
      plans: new PlanDomainService(db.plans),
      milestones: new MilestoneDomainService(db.milestones, db.issues),
    };
  }
}
