/**
 * NoOpProjectManagementClient - Null object pattern implementation
 *
 * Does nothing for all operations. Used when no external provider is configured.
 * This eliminates null checks at call sites - just call the client.
 */

import { Effect } from "@dev-workflow/effect";
import type {
  AuthResult,
  RepositoryResult,
  CreateIssueParams,
  ExternalIssue,
  ProjectItemResult,
  ProjectDetails,
  ProjectStatusField,
  ProjectField,
  SetFieldResult,
  AvailableLabelsResult,
} from "./project-management-provider.js";
import type { TaskStatus } from "../domain/tasks/task.js";
import type { ProjectManagementClient } from "./project-management-client.js";

/**
 * NoOpProjectManagementClient - Does nothing
 *
 * All methods are no-ops that return sensible defaults.
 * Use this when no external provider is configured.
 */
export class NoOpProjectManagementClient implements ProjectManagementClient {
  readonly providerId = "noop";
  readonly displayName = "None";

  // ===========================================================================
  // Configuration Accessors - always disabled/empty
  // ===========================================================================

  isEnabled(): boolean {
    return false;
  }

  getProjectId(): string | null {
    return null;
  }

  getColumnForStatus(_status: TaskStatus): string | null {
    return null;
  }

  getLabelFieldMapping(): Record<string, string> {
    return {};
  }

  getAssignee(): string | null {
    return null;
  }

  getCustomLabels(): string[] {
    return [];
  }

  // ===========================================================================
  // Authentication & Validation - always "works"
  // ===========================================================================

  checkAuth(): Effect<AuthResult> {
    return Effect.succeed({ authenticated: true });
  }

  checkRepository(): Effect<RepositoryResult> {
    return Effect.succeed({ accessible: true });
  }

  // ===========================================================================
  // Issue Operations - no-op or throw
  // ===========================================================================

  createIssue(_params: CreateIssueParams): Effect<ExternalIssue> {
    return Effect.promise(() => {
      throw new Error("Cannot create external issue: no provider configured");
    });
  }

  closeIssue(_externalId: string, _comment?: string): Effect<void> {
    return Effect.succeed(undefined);
  }

  reopenIssue(_externalId: string): Effect<void> {
    return Effect.succeed(undefined);
  }

  getIssue(_externalId: string): Effect<ExternalIssue | null> {
    return Effect.succeed(null);
  }

  searchIssues(
    _query: string,
    _state?: "open" | "closed" | "all",
    _limit?: number
  ): Effect<ExternalIssue[]> {
    return Effect.succeed([]);
  }

  // ===========================================================================
  // Project/Board Operations - no-op
  // ===========================================================================

  addToProject(_nodeId: string, _projectId: string): Effect<ProjectItemResult> {
    return Effect.succeed({ success: false, error: "No provider configured" });
  }

  moveToColumn(_itemId: string, _projectId: string, _columnName: string): Effect<void> {
    return Effect.succeed(undefined);
  }

  setProjectItemField(
    _projectId: string,
    _itemId: string,
    _fieldId: string,
    _value: string
  ): Effect<SetFieldResult> {
    return Effect.succeed({ success: false, error: "No provider configured" });
  }

  clearProjectItemField(
    _projectId: string,
    _itemId: string,
    _fieldId: string
  ): Effect<SetFieldResult> {
    return Effect.succeed({ success: false, error: "No provider configured" });
  }

  // ===========================================================================
  // Project Metadata Operations - no-op
  // ===========================================================================

  checkProject(_projectId: string): Effect<boolean> {
    return Effect.succeed(false);
  }

  getProjectDetails(_projectId: string): Effect<ProjectDetails | null> {
    return Effect.succeed(null);
  }

  getProjectStatusField(_projectId: string): Effect<ProjectStatusField | null> {
    return Effect.succeed(null);
  }

  getProjectFields(_projectId: string): Effect<ProjectField[]> {
    return Effect.succeed([]);
  }

  getAvailableLabels(): Effect<AvailableLabelsResult> {
    return Effect.succeed({ supported: false, labels: [] });
  }

  // ===========================================================================
  // Labels - no-op
  // ===========================================================================

  ensureLabelsExist(_labels: string[]): Effect<void> {
    return Effect.succeed(undefined);
  }

  // ===========================================================================
  // Assignment - no-op
  // ===========================================================================

  assignIssue(_externalId: string, _assignee: string): Effect<void> {
    return Effect.succeed(undefined);
  }

  // ===========================================================================
  // Comments - no-op
  // ===========================================================================

  addComment(_externalId: string, _body: string): Effect<void> {
    return Effect.succeed(undefined);
  }

  // ===========================================================================
  // Hierarchical Issues - no-op
  // ===========================================================================

  linkParentChild(_parentRef: string, _childRef: string): Effect<void> {
    return Effect.succeed(undefined);
  }
}
