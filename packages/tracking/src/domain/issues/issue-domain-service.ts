/**
 * IssueDomainService - Domain logic for issue operations
 *
 * Encapsulates business rules over the IssueRepository. No external sync,
 * no cross-service orchestration. Those belong in operations.
 *
 * Takes explicit repo dependencies (not DbClient) to declare exactly
 * what it uses.
 */

import type {
  IssueRepository,
  IssueStatus,
  IssueFilters,
  CreateIssueParams,
  UpdateIssueParams,
} from "./issue.js";
import { Issue } from "./issue.js";
import { BusinessRuleError, EntityNotFoundError } from "../errors.js";
import { Effect, Service } from "@dev-workflow/effect";

export class IssueDomainService extends Service<IssueDomainService>()("issueDomainService") {
  constructor(private readonly repo: IssueRepository) {
    super();
  }

  // ============================================================================
  // Read Operations
  // ============================================================================

  findById(issueId: string, includeDeleted = false): Effect<Issue | null> {
    return this.repo.findById(issueId, includeDeleted);
  }

  findByNumber(number: number, includeDeleted = false): Effect<Issue | null> {
    return this.repo.findByNumber(number, includeDeleted);
  }

  findMany(filters?: IssueFilters): Effect<Issue[]> {
    return this.repo.findMany(filters);
  }

  search(
    query: string
  ): Effect<Pick<Issue, "id" | "number" | "title" | "status" | "type" | "priority">[]> {
    return this.repo.search(query);
  }

  getStatusCounts(): Effect<Record<string, number>> {
    return this.repo.getStatusCounts();
  }

  getNextIssueNumber(): Effect<number> {
    return this.repo.getNextIssueNumber();
  }

  // ============================================================================
  // Get-or-throw Operations
  // ============================================================================

  getOrThrow(issueId: string): Effect<Issue, EntityNotFoundError> {
    const repo = this.repo;
    return Effect.gen(function* () {
      const issue = yield* repo.findById(issueId);
      if (!issue) {
        return yield* Effect.fail(new EntityNotFoundError("Issue", issueId));
      }
      return issue;
    });
  }

  getByNumber(number: number): Effect<Issue, EntityNotFoundError> {
    const repo = this.repo;
    return Effect.gen(function* () {
      const issue = yield* repo.findByNumber(number);
      if (!issue) {
        return yield* Effect.fail(new EntityNotFoundError("Issue", `#${number}`));
      }
      return issue;
    });
  }

  getIssueByNumber(issueNumber: number): Effect<Issue, EntityNotFoundError> {
    const repo = this.repo;
    return Effect.gen(function* () {
      const issue = yield* repo.findByNumber(issueNumber);
      if (!issue) {
        return yield* Effect.fail(new EntityNotFoundError("Issue", String(issueNumber)));
      }
      return issue;
    });
  }

  // ============================================================================
  // Write Operations (with business rules)
  // ============================================================================

  create(data: CreateIssueParams): Effect<Issue> {
    return this.repo.create(data);
  }

  update(issueId: string, data: UpdateIssueParams): Effect<Issue> {
    return this.repo.update(issueId, data);
  }

  /**
   * Close an issue.
   *
   * Domain-level close: validates status transition, updates to CLOSED.
   * Does NOT abandon tasks or sync externally — that's the operation's job.
   */
  close(issueId: string): Effect<Issue, EntityNotFoundError | BusinessRuleError> {
    const repo = this.repo;
    return Effect.gen(function* () {
      const issue = yield* repo.findById(issueId);
      if (!issue) {
        return yield* Effect.fail(new EntityNotFoundError("Issue", issueId));
      }
      if (issue.isClosed) {
        return yield* Effect.fail(new BusinessRuleError("Issue is already closed"));
      }
      return yield* repo.update(issueId, { status: "CLOSED" as IssueStatus });
    });
  }

  /**
   * Update issue status.
   *
   * For non-CLOSED transitions. Use close() for closing.
   */
  updateStatus(issueId: string, newStatus: IssueStatus): Effect<Issue, EntityNotFoundError> {
    const getOrThrow = (id: string) => this.getOrThrow(id);
    const { repo } = this;
    return Effect.gen(function* () {
      yield* getOrThrow(issueId);
      return yield* repo.update(issueId, { status: newStatus });
    });
  }

  delete(issueId: string, deletedBy: string): Effect<Issue> {
    return this.repo.delete(issueId, deletedBy);
  }

  restore(issueId: string): Effect<Issue> {
    return this.repo.restore(issueId);
  }

  assignToMilestone(issueId: string, milestoneId: string): Effect<Issue> {
    return this.repo.update(issueId, { milestoneId });
  }

  removeFromMilestone(issueId: string): Effect<Issue> {
    return this.repo.update(issueId, { milestoneId: undefined });
  }
}
