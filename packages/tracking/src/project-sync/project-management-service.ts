/**
 * ProjectManagementService - Orchestration logic for external project management operations
 *
 * This service encapsulates ALL shared orchestration logic:
 * - Null checks on sync state
 * - Timestamp management
 * - Error handling and recovery
 * - Multi-step operation coordination
 *
 * The client (ProjectManagementClient) handles ONLY the low-level API calls.
 * This service wraps the client to provide clean, reusable operations.
 *
 * Architecture:
 * ```
 * TaskService / IssueService
 *     ↓
 * ProjectManagementService (this service - orchestration)
 *     ↓
 * ProjectManagementClient (API calls only)
 * ```
 *
 * Pattern: State in, state out.
 * - Methods take current SyncState (or undefined)
 * - Methods return updated SyncState (or null if nothing to sync)
 * - Callers persist the returned state
 */

import { Effect, Service } from "@dev-workflow/effect";
import type { TaskStatus } from "../domain/tasks/task.js";
import type { SyncState, CreateIssueParams } from "./project-management-provider.js";
import type { ProjectManagementClient } from "./project-management-client.js";

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * ProjectManagementService - Orchestrates external project management operations
 *
 * All methods follow the "state in, state out" pattern:
 * - Input: current SyncState (may be undefined)
 * - Output: updated SyncState (or null if nothing to sync)
 *
 * Example usage in TaskService:
 * ```typescript
 * const updatedState = await this.projectManagement.syncTaskStatus(task.syncState, newStatus);
 * if (updatedState) {
 *   this.db.tasks.updateSyncState(task.id, updatedState);
 * }
 * ```
 */
export class ProjectManagementService extends Service<ProjectManagementService>()(
  "projectManagement"
) {
  constructor(private readonly client: ProjectManagementClient) {
    super();
  }

  // ===========================================================================
  // Configuration Accessors (delegate to client)
  // ===========================================================================

  /**
   * Check if sync is enabled
   */
  isEnabled(): boolean {
    return this.client.isEnabled();
  }

  /**
   * Get provider ID
   */
  getProviderId(): string {
    return this.client.providerId;
  }

  /**
   * Get display name
   */
  getDisplayName(): string {
    return this.client.displayName;
  }

  /**
   * Get configured project ID
   */
  getProjectId(): string | null {
    return this.client.getProjectId();
  }

  // ===========================================================================
  // Sync Operations (State In, State Out)
  // ===========================================================================

  /**
   * Sync task status to project board column
   *
   * Handles:
   * - Null check on syncState.remoteProjectId
   * - Column mapping lookup
   * - API call to move item
   * - Timestamp update on success
   * - Error capture on failure
   *
   * @param syncState - Current sync state (may be undefined)
   * @param newStatus - The new task status
   * @returns Updated sync state, or null if nothing to sync
   */
  async syncTaskStatus(
    syncState: SyncState | undefined,
    newStatus: TaskStatus
  ): Promise<SyncState | null> {
    // Nothing to sync if no project item
    if (!syncState?.remoteProjectId) {
      return null;
    }

    // Get column for this status
    const columnName = this.client.getColumnForStatus(newStatus);
    if (!columnName) {
      return null; // No column mapping for this status
    }

    const projectId = this.client.getProjectId();
    if (!projectId) {
      return null;
    }

    try {
      await this.client.moveToColumn(syncState.remoteProjectId, projectId, columnName);
      return {
        ...syncState,
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to sync status to provider: ${errorMessage}`);
      return {
        ...syncState,
        lastSyncError: errorMessage,
      };
    }
  }

  /**
   * Sync task labels to project field values
   *
   * Handles:
   * - Null check on syncState.remoteProjectId
   * - Field mapping lookup
   * - Iteration over label-to-field mappings
   * - Per-field error handling
   * - Timestamp update
   *
   * @param syncState - Current sync state (may be undefined)
   * @param labels - Task labels to sync (key-value pairs)
   * @returns Updated sync state, or null if nothing to sync
   */
  async syncTaskLabels(
    syncState: SyncState | undefined,
    labels: Record<string, string> | undefined | null
  ): Promise<SyncState | null> {
    if (!syncState?.remoteProjectId) {
      return null;
    }

    if (!labels || Object.keys(labels).length === 0) {
      return null;
    }

    const projectId = this.client.getProjectId();
    if (!projectId) {
      return null;
    }

    const fieldMapping = this.client.getLabelFieldMapping();
    if (Object.keys(fieldMapping).length === 0) {
      return null; // No label field mapping configured
    }

    let hasError = false;
    const errors: string[] = [];

    for (const [labelKey, labelValue] of Object.entries(labels)) {
      const fieldId = fieldMapping[labelKey];
      if (!fieldId) {
        continue; // Label not mapped - skip
      }

      try {
        if (labelValue === "" || labelValue === null || labelValue === undefined) {
          // Empty value - clear the field
          const result = await this.client.clearProjectItemField(
            projectId,
            syncState.remoteProjectId,
            fieldId
          );
          if (!result.success && result.error) {
            hasError = true;
            errors.push(`${labelKey}: ${result.error}`);
          }
        } else {
          // Non-empty value - set the field
          const result = await this.client.setProjectItemField(
            projectId,
            syncState.remoteProjectId,
            fieldId,
            labelValue
          );
          if (!result.success && result.error) {
            hasError = true;
            errors.push(`${labelKey}: ${result.error}`);
          }
        }
      } catch (error) {
        hasError = true;
        errors.push(`${labelKey}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      ...syncState,
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: hasError ? errors.join("; ") : null,
    };
  }

  /**
   * Create external issue and add to project board
   *
   * Handles:
   * - Config checks (enabled, projectId)
   * - Issue creation via client
   * - Project add via client
   * - Column placement
   * - Label sync to project fields
   * - Complete SyncState assembly
   *
   * @param params - Issue creation parameters
   * @param initialStatus - Initial task status for column placement
   * @param labels - Optional labels to sync to project fields
   * @returns Complete sync state ready to persist, or null if sync disabled
   */
  async createProjectItem(
    params: CreateIssueParams,
    initialStatus: TaskStatus,
    labels?: Record<string, string> | null
  ): Promise<SyncState | null> {
    if (!this.client.isEnabled()) {
      return null;
    }

    const projectId = this.client.getProjectId();

    try {
      // 1. Create external issue
      const externalIssue = await this.client.createIssue(params);

      // 2. Add to project board if configured
      let remoteProjectId: string | null = null;
      if (projectId && externalIssue.nodeId) {
        const result = await this.client.addToProject(externalIssue.nodeId, projectId);

        if (!result.success || !result.itemId) {
          throw new Error(
            result.error ?? `Project association returned empty item ID for project ${projectId}`
          );
        }

        remoteProjectId = result.itemId;

        // 3. Move to initial column
        const columnName = this.client.getColumnForStatus(initialStatus);
        if (columnName) {
          await this.client.moveToColumn(remoteProjectId, projectId, columnName);
        }

        // 4. Sync labels to project fields
        if (labels && Object.keys(labels).length > 0) {
          const fieldMapping = this.client.getLabelFieldMapping();
          for (const [labelKey, labelValue] of Object.entries(labels)) {
            const fieldId = fieldMapping[labelKey];
            if (!fieldId) continue;

            if (labelValue) {
              await this.client.setProjectItemField(
                projectId,
                remoteProjectId,
                fieldId,
                labelValue
              );
            }
          }
        }
      }

      // 5. Return complete sync state
      return {
        externalId: externalIssue.numericId?.toString() ?? externalIssue.id,
        externalUrl: externalIssue.url,
        externalNodeId: externalIssue.nodeId ?? null,
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        remoteProjectId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to create project item: ${errorMessage}`);
      return {
        externalId: null,
        externalUrl: null,
        externalNodeId: null,
        syncStatus: "PUSH_FAILED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: errorMessage,
        remoteProjectId: null,
      };
    }
  }

  /**
   * Close an external issue
   *
   * Handles:
   * - Null check on externalId
   * - API call to close
   * - Timestamp update
   * - Error capture
   *
   * @param syncState - Current sync state (may be undefined)
   * @param comment - Optional comment to add when closing
   * @returns Updated sync state, or null if nothing to close
   */
  closeIssue(syncState: SyncState | undefined, comment?: string): Effect<SyncState | null> {
    const client = this.client;
    return Effect.promise(async () => {
      if (!syncState?.externalId) {
        return null;
      }

      try {
        await client.closeIssue(syncState.externalId, comment);
        return {
          ...syncState,
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: null,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to close external issue: ${errorMessage}`);
        return {
          ...syncState,
          lastSyncError: errorMessage,
        };
      }
    });
  }

  /**
   * Auto-assign issue to configured user
   *
   * Handles:
   * - Null check on externalId
   * - Assignee config check
   * - API call to assign
   * - Timestamp update
   * - Error capture
   *
   * @param syncState - Current sync state (may be undefined)
   * @returns Updated sync state, or null if nothing to assign
   */
  async autoAssign(syncState: SyncState | undefined): Promise<SyncState | null> {
    if (!syncState?.externalId) {
      return null;
    }

    const assignee = this.client.getAssignee();
    if (!assignee) {
      return null; // No assignee configured
    }

    try {
      await this.client.assignIssue(syncState.externalId, assignee);
      return {
        ...syncState,
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to assign issue: ${errorMessage}`);
      return {
        ...syncState,
        lastSyncError: errorMessage,
      };
    }
  }

  /**
   * Add comment to an external issue
   *
   * @param syncState - Current sync state (may be undefined)
   * @param body - Comment text
   * @returns Updated sync state, or null if nothing to comment on
   */
  async addComment(syncState: SyncState | undefined, body: string): Promise<SyncState | null> {
    if (!syncState?.externalId) {
      return null;
    }

    try {
      await this.client.addComment(syncState.externalId, body);
      return {
        ...syncState,
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to add comment: ${errorMessage}`);
      return {
        ...syncState,
        lastSyncError: errorMessage,
      };
    }
  }

  /**
   * Reopen a closed external issue
   *
   * @param syncState - Current sync state (may be undefined)
   * @returns Updated sync state, or null if nothing to reopen
   */
  async reopenIssue(syncState: SyncState | undefined): Promise<SyncState | null> {
    if (!syncState?.externalId) {
      return null;
    }

    try {
      await this.client.reopenIssue(syncState.externalId);
      return {
        ...syncState,
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to reopen issue: ${errorMessage}`);
      return {
        ...syncState,
        lastSyncError: errorMessage,
      };
    }
  }

  /**
   * Link an issue to a project board (without creating new issue)
   *
   * Used for linking existing external issues (e.g., imported issues).
   *
   * @param syncState - Current sync state with externalNodeId
   * @param initialStatus - Status for column placement
   * @param labels - Optional labels to sync to project fields
   * @returns Updated sync state with remoteProjectId, or null if nothing to link
   */
  async linkToProject(
    syncState: SyncState | undefined,
    initialStatus: TaskStatus,
    labels?: Record<string, string> | null
  ): Promise<SyncState | null> {
    if (!syncState?.externalNodeId) {
      return null;
    }

    const projectId = this.client.getProjectId();
    if (!projectId) {
      return null;
    }

    try {
      const result = await this.client.addToProject(syncState.externalNodeId, projectId);

      if (!result.success || !result.itemId) {
        throw new Error(
          result.error ?? `Project association returned empty item ID for project ${projectId}`
        );
      }

      const remoteProjectId = result.itemId;

      // Move to initial column
      const columnName = this.client.getColumnForStatus(initialStatus);
      if (columnName) {
        await this.client.moveToColumn(remoteProjectId, projectId, columnName);
      }

      // Sync labels to project fields
      if (labels && Object.keys(labels).length > 0) {
        const fieldMapping = this.client.getLabelFieldMapping();
        for (const [labelKey, labelValue] of Object.entries(labels)) {
          const fieldId = fieldMapping[labelKey];
          if (!fieldId) continue;

          if (labelValue) {
            await this.client.setProjectItemField(projectId, remoteProjectId, fieldId, labelValue);
          }
        }
      }

      return {
        ...syncState,
        remoteProjectId,
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to link to project: ${errorMessage}`);
      return {
        ...syncState,
        lastSyncError: errorMessage,
      };
    }
  }

  /**
   * Link an issue as a child of another (sub-issue)
   *
   * @param parentExternalId - Parent issue's external ID
   * @param childSyncState - Child's sync state (must have externalId)
   * @returns Updated sync state, or null if nothing to link
   */
  async linkParentChild(
    parentExternalId: string,
    childSyncState: SyncState | undefined
  ): Promise<SyncState | null> {
    if (!childSyncState?.externalId) {
      return null;
    }

    try {
      await this.client.linkParentChild(parentExternalId, childSyncState.externalId);
      return {
        ...childSyncState,
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to link parent-child: ${errorMessage}`);
      return {
        ...childSyncState,
        lastSyncError: errorMessage,
      };
    }
  }

  // ===========================================================================
  // Read Operations (delegate to client)
  // ===========================================================================

  /**
   * Get issue details from external system
   */
  async getIssue(externalId: string) {
    return this.client.getIssue(externalId);
  }

  /**
   * Search for issues in external system
   */
  async searchIssues(query: string, state?: "open" | "closed" | "all", limit?: number) {
    return this.client.searchIssues(query, state, limit);
  }

  /**
   * Check authentication status
   */
  async checkAuth() {
    return this.client.checkAuth();
  }

  /**
   * Check repository accessibility
   */
  async checkRepository() {
    return this.client.checkRepository();
  }

  /**
   * Get project details
   */
  async getProjectDetails(projectId: string) {
    return this.client.getProjectDetails(projectId);
  }

  /**
   * Get project status field
   */
  async getProjectStatusField(projectId: string) {
    return this.client.getProjectStatusField(projectId);
  }

  /**
   * Get project fields
   */
  async getProjectFields(projectId: string) {
    return this.client.getProjectFields(projectId);
  }

  /**
   * Get available labels
   */
  async getAvailableLabels() {
    return this.client.getAvailableLabels();
  }

  /**
   * Check if a project exists
   */
  async checkProject(projectId: string) {
    return this.client.checkProject(projectId);
  }

  /**
   * Ensure labels exist in external system
   */
  async ensureLabelsExist(labels: string[]) {
    return this.client.ensureLabelsExist(labels);
  }

  /**
   * Get custom labels from config
   */
  getCustomLabels(): string[] {
    return this.client.getCustomLabels();
  }

  // ===========================================================================
  // Low-Level Operations (for complex flows that need direct access)
  // ===========================================================================

  /**
   * Get label field mapping from config
   */
  getLabelFieldMapping(): Record<string, string> {
    return this.client.getLabelFieldMapping();
  }

  /**
   * Get column name for a task status
   */
  getColumnForStatus(status: TaskStatus): string | null {
    return this.client.getColumnForStatus(status);
  }

  /**
   * Create an issue in the external system (low-level)
   * For most cases, use createProjectItem() instead which handles full setup.
   */
  async createIssue(params: CreateIssueParams) {
    return this.client.createIssue(params);
  }

  /**
   * Add an issue to a project board (low-level)
   */
  async addToProject(nodeId: string, projectId: string) {
    return this.client.addToProject(nodeId, projectId);
  }

  /**
   * Move an item to a column on a project board (low-level)
   */
  async moveToColumn(itemId: string, projectId: string, columnName: string) {
    return this.client.moveToColumn(itemId, projectId, columnName);
  }

  /**
   * Set a field value on a project item (low-level)
   */
  async setProjectItemField(projectId: string, itemId: string, fieldId: string, value: string) {
    return this.client.setProjectItemField(projectId, itemId, fieldId, value);
  }

  /**
   * Clear a field value on a project item (low-level)
   */
  async clearProjectItemField(projectId: string, itemId: string, fieldId: string) {
    return this.client.clearProjectItemField(projectId, itemId, fieldId);
  }

  /**
   * Assign an issue to a user (low-level)
   */
  async assignIssue(externalId: string, assignee: string) {
    return this.client.assignIssue(externalId, assignee);
  }

  /**
   * Link issues as parent/child (low-level)
   */
  async linkIssues(parentRef: string, childRef: string) {
    return this.client.linkParentChild(parentRef, childRef);
  }
}
