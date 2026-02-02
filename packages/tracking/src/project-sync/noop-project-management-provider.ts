/**
 * NoOpProjectManagementProvider - Null object pattern implementation
 *
 * Does nothing for all operations. Used when no external provider is configured.
 * This eliminates null checks at call sites - just call the provider.
 */

import { Effect } from "@dev-workflow/effect";
import type {
  ProjectManagementProvider,
  AuthResult,
  RepositoryResult,
  CreateIssueParams,
  UpdateIssueParams,
  ExternalIssue,
  ProjectItemResult,
  ProjectDetails,
  ProjectStatusField,
  ProjectField,
  SetFieldResult,
  AvailableLabelsResult,
} from "./project-management-provider.js";
import type { Issue } from "../domain/issues/issue.js";
import type { Task, TaskStatus } from "../domain/tasks/task.js";

/**
 * NoOpProjectManagementProvider - Does nothing
 *
 * All methods are no-ops that return sensible defaults.
 * Use this when no external provider is configured.
 */
export class NoOpProjectManagementProvider implements ProjectManagementProvider {
  readonly providerId = "noop";
  readonly displayName = "None";

  // ===========================================================================
  // Configuration Methods - always disabled/empty
  // ===========================================================================

  isEnabled(): boolean {
    return false;
  }

  hasProjectBoard(): boolean {
    return false;
  }

  getAssignee(): string | undefined {
    return undefined;
  }

  getCustomLabels(): string[] {
    return [];
  }

  getColumnForStatus(_status: TaskStatus): string {
    return "Backlog";
  }

  getProjectId(): string | undefined {
    return undefined;
  }

  getLabelFieldMapping(): Record<string, string> | undefined {
    return undefined;
  }

  // ===========================================================================
  // High-Level Operations - no-op
  // ===========================================================================

  moveItemToStatusColumn(_itemId: string | null | undefined, _status: TaskStatus): Effect<void> {
    return Effect.succeed(undefined);
  }

  assignIssueToConfiguredUser(_issueRef: string): Effect<void> {
    return Effect.succeed(undefined);
  }

  // Auth/Validation - always "works" (nothing to check)
  checkAuth(): Effect<AuthResult> {
    return Effect.succeed({ authenticated: true });
  }

  checkRepository(): Effect<RepositoryResult> {
    return Effect.succeed({ accessible: true });
  }

  // Issue Operations - no-op, throw for create (can't create without provider)
  createIssue(_params: CreateIssueParams): Effect<ExternalIssue> {
    return Effect.promise(() => {
      throw new Error("Cannot create external issue: no provider configured");
    });
  }

  updateIssue(_params: UpdateIssueParams): Effect<ExternalIssue> {
    return Effect.promise(() => {
      throw new Error("Cannot update external issue: no provider configured");
    });
  }

  closeIssue(_issue: Issue, _comment?: string): Effect<void> {
    return Effect.succeed(undefined);
  }

  closeIssueByTask(_task: Task, _comment?: string): Effect<void> {
    return Effect.succeed(undefined);
  }

  reopenIssue(_issueRef: string): Effect<void> {
    return Effect.succeed(undefined);
  }

  getIssue(_issueRef: string): Effect<ExternalIssue | null> {
    return Effect.succeed(null);
  }

  searchIssues(
    _query: string,
    _state?: "open" | "closed" | "all",
    _limit?: number
  ): Effect<ExternalIssue[]> {
    return Effect.succeed([]);
  }

  // Labels - no-op
  ensureLabelsExist(_labels: string[]): Effect<void> {
    return Effect.succeed(undefined);
  }

  // Project Operations - no-op/not supported
  addToProject(_issueNodeId: string, _projectId: string): Effect<ProjectItemResult> {
    return Effect.succeed({ success: false, error: "No provider configured" });
  }

  moveToColumn(_itemId: string, _projectId: string, _columnName: string): Effect<void> {
    return Effect.succeed(undefined);
  }

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

  getAvailableLabels(): Effect<AvailableLabelsResult> {
    return Effect.succeed({ supported: false, labels: [] });
  }

  // Hierarchical - no-op
  linkParentChild(_parentRef: string, _childRef: string): Effect<void> {
    return Effect.succeed(undefined);
  }

  // Comments - no-op
  addComment(_issueRef: string, _body: string): Effect<void> {
    return Effect.succeed(undefined);
  }

  // Assignment - no-op
  assignIssue(_issueRef: string, _assignee: string): Effect<void> {
    return Effect.succeed(undefined);
  }
}
