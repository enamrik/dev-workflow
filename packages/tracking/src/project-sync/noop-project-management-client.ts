/**
 * NoOpProjectManagementClient - Null object pattern implementation
 *
 * Does nothing for all operations. Used when no external provider is configured.
 * This eliminates null checks at call sites - just call the client.
 */

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
import type { TaskStatus } from "../tasks/task.js";
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

  async checkAuth(): Promise<AuthResult> {
    return { authenticated: true };
  }

  async checkRepository(): Promise<RepositoryResult> {
    return { accessible: true };
  }

  // ===========================================================================
  // Issue Operations - no-op or throw
  // ===========================================================================

  async createIssue(_params: CreateIssueParams): Promise<ExternalIssue> {
    throw new Error("Cannot create external issue: no provider configured");
  }

  async closeIssue(_externalId: string, _comment?: string): Promise<void> {
    // No-op - nothing to close
  }

  async reopenIssue(_externalId: string): Promise<void> {
    // No-op
  }

  async getIssue(_externalId: string): Promise<ExternalIssue | null> {
    return null;
  }

  async searchIssues(
    _query: string,
    _state?: "open" | "closed" | "all",
    _limit?: number
  ): Promise<ExternalIssue[]> {
    return [];
  }

  // ===========================================================================
  // Project/Board Operations - no-op
  // ===========================================================================

  async addToProject(_nodeId: string, _projectId: string): Promise<ProjectItemResult> {
    return { success: false, error: "No provider configured" };
  }

  async moveToColumn(_itemId: string, _projectId: string, _columnName: string): Promise<void> {
    // No-op
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

  // ===========================================================================
  // Project Metadata Operations - no-op
  // ===========================================================================

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

  async getAvailableLabels(): Promise<AvailableLabelsResult> {
    return { supported: false, labels: [] };
  }

  // ===========================================================================
  // Labels - no-op
  // ===========================================================================

  async ensureLabelsExist(_labels: string[]): Promise<void> {
    // No-op
  }

  // ===========================================================================
  // Assignment - no-op
  // ===========================================================================

  async assignIssue(_externalId: string, _assignee: string): Promise<void> {
    // No-op
  }

  // ===========================================================================
  // Comments - no-op
  // ===========================================================================

  async addComment(_externalId: string, _body: string): Promise<void> {
    // No-op
  }

  // ===========================================================================
  // Hierarchical Issues - no-op
  // ===========================================================================

  async linkParentChild(_parentRef: string, _childRef: string): Promise<void> {
    // No-op
  }
}
