/**
 * NoOpProjectManagementProvider - Null object pattern implementation
 *
 * Does nothing for all operations. Used when no external provider is configured.
 * This eliminates null checks at call sites - just call the provider.
 */

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
} from "../../domain/project-management-provider.js";
import type { Issue } from "../../domain/issue.js";
import type { Task, TaskStatus } from "../../domain/task.js";

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

  async moveItemToStatusColumn(
    _itemId: string | null | undefined,
    _status: TaskStatus
  ): Promise<void> {
    // No-op
  }

  async assignIssueToConfiguredUser(_issueRef: string): Promise<void> {
    // No-op
  }

  // Auth/Validation - always "works" (nothing to check)
  async checkAuth(): Promise<AuthResult> {
    return { authenticated: true };
  }

  async checkRepository(): Promise<RepositoryResult> {
    return { accessible: true };
  }

  // Issue Operations - no-op, throw for create (can't create without provider)
  async createIssue(_params: CreateIssueParams): Promise<ExternalIssue> {
    throw new Error("Cannot create external issue: no provider configured");
  }

  async updateIssue(_params: UpdateIssueParams): Promise<ExternalIssue> {
    throw new Error("Cannot update external issue: no provider configured");
  }

  async closeIssue(_issue: Issue, _comment?: string): Promise<void> {
    // No-op - nothing to close
  }

  async closeIssueByTask(_task: Task, _comment?: string): Promise<void> {
    // No-op - nothing to close
  }

  async reopenIssue(_issueRef: string): Promise<void> {
    // No-op
  }

  async getIssue(_issueRef: string): Promise<ExternalIssue | null> {
    return null;
  }

  async searchIssues(
    _query: string,
    _state?: "open" | "closed" | "all",
    _limit?: number
  ): Promise<ExternalIssue[]> {
    return [];
  }

  // Labels - no-op
  async ensureLabelsExist(_labels: string[]): Promise<void> {
    // No-op
  }

  // Project Operations - no-op/not supported
  async addToProject(_issueNodeId: string, _projectId: string): Promise<ProjectItemResult> {
    return { success: false, error: "No provider configured" };
  }

  async moveToColumn(_itemId: string, _projectId: string, _columnName: string): Promise<void> {
    // No-op
  }

  async checkProject(_projectId: string): Promise<boolean> {
    return false;
  }

  async getProjectDetails(_projectId: string): Promise<ProjectDetails | null> {
    return null;
  }

  async getProjectStatusField(_projectId: string): Promise<ProjectStatusField | null> {
    return null;
  }

  async getProjectFields(_projectId: string): Promise<ProjectField[]> {
    return [];
  }

  async setProjectItemField(
    _projectId: string,
    _itemId: string,
    _fieldId: string,
    _value: string
  ): Promise<SetFieldResult> {
    return { success: false, error: "No provider configured" };
  }

  async clearProjectItemField(
    _projectId: string,
    _itemId: string,
    _fieldId: string
  ): Promise<SetFieldResult> {
    return { success: false, error: "No provider configured" };
  }

  async getAvailableLabels(): Promise<AvailableLabelsResult> {
    return { supported: false, labels: [] };
  }

  // Hierarchical - no-op
  async linkParentChild(_parentRef: string, _childRef: string): Promise<void> {
    // No-op
  }

  // Comments - no-op
  async addComment(_issueRef: string, _body: string): Promise<void> {
    // No-op
  }

  // Assignment - no-op
  async assignIssue(_issueRef: string, _assignee: string): Promise<void> {
    // No-op
  }
}
