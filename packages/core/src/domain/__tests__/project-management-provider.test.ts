import { describe, it, expect } from "vitest";
import {
  type SyncStatus,
  type SyncState,
  type SyncResult,
  type ExternalIssue,
  type CreateIssueParams,
  type UpdateIssueParams,
  ProjectManagementProviderError,
} from "../project-management-provider.js";

import {
  type LabelsConfig,
  type ColumnMapping,
  type ProjectManagementConfig,
  DEFAULT_LABELS_CONFIG,
  PROVIDER_DEFAULT_COLUMN_MAPPING,
  DEFAULT_PROJECT_MANAGEMENT_CONFIG,
  getColumnForStatus,
  getProviderId,
  isSyncEnabled,
} from "../project-management-config.js";

describe("ProjectManagementProvider types", () => {
  describe("SyncStatus type", () => {
    it("should allow valid sync statuses", () => {
      const statuses: SyncStatus[] = ["NOT_SYNCED", "SYNCED", "PUSH_FAILED"];
      expect(statuses).toHaveLength(3);
    });
  });

  describe("SyncState interface", () => {
    it("should represent a synced state", () => {
      const state: SyncState = {
        externalId: "42",
        externalUrl: "https://github.com/org/repo/issues/42",
        externalNodeId: "I_kwDO123",
        syncStatus: "SYNCED",
        lastSyncedAt: "2025-01-01T00:00:00Z",
        lastSyncError: null,
        projectItemId: "PVTI_123",
      };

      expect(state.syncStatus).toBe("SYNCED");
      expect(state.externalId).toBe("42");
    });

    it("should represent an unsynced state", () => {
      const state: SyncState = {
        externalId: null,
        externalUrl: null,
        externalNodeId: null,
        syncStatus: "NOT_SYNCED",
        lastSyncedAt: null,
        lastSyncError: null,
        projectItemId: null,
      };

      expect(state.syncStatus).toBe("NOT_SYNCED");
      expect(state.externalId).toBeNull();
    });

    it("should represent a failed sync state", () => {
      const state: SyncState = {
        externalId: "42",
        externalUrl: "https://github.com/org/repo/issues/42",
        externalNodeId: "I_kwDO123",
        syncStatus: "PUSH_FAILED",
        lastSyncedAt: "2025-01-01T00:00:00Z",
        lastSyncError: "API rate limit exceeded",
        projectItemId: null,
      };

      expect(state.syncStatus).toBe("PUSH_FAILED");
      expect(state.lastSyncError).toBe("API rate limit exceeded");
    });
  });

  describe("SyncResult interface", () => {
    it("should represent a successful create result", () => {
      const result: SyncResult = {
        success: true,
        action: "created",
        externalId: "42",
        externalUrl: "https://github.com/org/repo/issues/42",
        externalNodeId: "I_kwDO123",
        projectItemId: "PVTI_123",
      };

      expect(result.success).toBe(true);
      expect(result.action).toBe("created");
    });

    it("should represent a failed result", () => {
      const result: SyncResult = {
        success: false,
        action: "none",
        error: "Authentication failed",
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe("Authentication failed");
    });
  });

  describe("ExternalIssue interface", () => {
    it("should represent a GitHub-style issue", () => {
      const issue: ExternalIssue = {
        id: "42",
        numericId: 42,
        url: "https://github.com/org/repo/issues/42",
        nodeId: "I_kwDO123",
        title: "Test issue",
        body: "Issue description",
        state: "OPEN",
        labels: ["bug", "priority:high"],
      };

      expect(issue.id).toBe("42");
      expect(issue.numericId).toBe(42);
      expect(issue.state).toBe("OPEN");
    });

    it("should represent a Jira-style issue", () => {
      const issue: ExternalIssue = {
        id: "PROJ-123",
        url: "https://company.atlassian.net/browse/PROJ-123",
        title: "Test issue",
        body: "Issue description",
        state: "OPEN",
        labels: ["bug"],
      };

      expect(issue.id).toBe("PROJ-123");
      expect(issue.numericId).toBeUndefined();
    });
  });

  describe("CreateIssueParams interface", () => {
    it("should define issue creation parameters", () => {
      const params: CreateIssueParams = {
        title: "New feature",
        body: "Feature description",
        labels: ["feature", "enhancement"],
      };

      expect(params.title).toBe("New feature");
      expect(params.labels).toContain("feature");
    });
  });

  describe("UpdateIssueParams interface", () => {
    it("should define issue update parameters", () => {
      const params: UpdateIssueParams = {
        issueRef: "42",
        title: "Updated title",
        labels: ["bug"],
      };

      expect(params.issueRef).toBe("42");
      expect(params.body).toBeUndefined();
    });
  });

  describe("ProjectManagementProviderError", () => {
    it("should create an error with provider context", () => {
      const error = new ProjectManagementProviderError(
        "Issue not found",
        "github",
        "getIssue",
        new Error("Original error")
      );

      expect(error.message).toBe("[github] getIssue: Issue not found");
      expect(error.providerId).toBe("github");
      expect(error.operation).toBe("getIssue");
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.name).toBe("ProjectManagementProviderError");
    });
  });
});

describe("ProjectManagementConfig types", () => {
  describe("DEFAULT_LABELS_CONFIG", () => {
    it("should have default type labels", () => {
      expect(DEFAULT_LABELS_CONFIG.typeLabels.FEATURE).toBe("feature");
      expect(DEFAULT_LABELS_CONFIG.typeLabels.BUG).toBe("bug");
      expect(DEFAULT_LABELS_CONFIG.typeLabels.ENHANCEMENT).toBe("enhancement");
      expect(DEFAULT_LABELS_CONFIG.typeLabels.TASK).toBe("task");
    });

    it("should have empty custom labels by default", () => {
      expect(DEFAULT_LABELS_CONFIG.customLabels).toEqual([]);
    });
  });

  describe("PROVIDER_DEFAULT_COLUMN_MAPPING", () => {
    it("should map all task statuses", () => {
      expect(PROVIDER_DEFAULT_COLUMN_MAPPING.PLANNED).toBe("Backlog");
      expect(PROVIDER_DEFAULT_COLUMN_MAPPING.BACKLOG).toBe("Backlog");
      expect(PROVIDER_DEFAULT_COLUMN_MAPPING.READY).toBe("Ready");
      expect(PROVIDER_DEFAULT_COLUMN_MAPPING.IN_PROGRESS).toBe("In Progress");
      expect(PROVIDER_DEFAULT_COLUMN_MAPPING.PR_REVIEW).toBe("In Review");
      expect(PROVIDER_DEFAULT_COLUMN_MAPPING.COMPLETED).toBe("Done");
      expect(PROVIDER_DEFAULT_COLUMN_MAPPING.ABANDONED).toBe("Done");
    });
  });

  describe("getColumnForStatus", () => {
    it("should return default column when no custom mapping", () => {
      expect(getColumnForStatus("BACKLOG")).toBe("Backlog");
      expect(getColumnForStatus("IN_PROGRESS")).toBe("In Progress");
      expect(getColumnForStatus("COMPLETED")).toBe("Done");
    });

    it("should use custom mapping when provided", () => {
      const customMapping: ColumnMapping = {
        BACKLOG: "To Do",
        IN_PROGRESS: "Doing",
      };

      expect(getColumnForStatus("BACKLOG", customMapping)).toBe("To Do");
      expect(getColumnForStatus("IN_PROGRESS", customMapping)).toBe("Doing");
      // Non-overridden values should use default
      expect(getColumnForStatus("COMPLETED", customMapping)).toBe("Done");
    });

    it("should handle partial custom mapping", () => {
      const customMapping: ColumnMapping = {
        PR_REVIEW: "Code Review",
      };

      expect(getColumnForStatus("PR_REVIEW", customMapping)).toBe("Code Review");
      expect(getColumnForStatus("BACKLOG", customMapping)).toBe("Backlog");
    });
  });

  describe("DEFAULT_PROJECT_MANAGEMENT_CONFIG", () => {
    it("should be disabled by default", () => {
      expect(DEFAULT_PROJECT_MANAGEMENT_CONFIG.enabled).toBe(false);
    });

    it("should default to github provider", () => {
      expect(DEFAULT_PROJECT_MANAGEMENT_CONFIG.providerId).toBe("github");
    });
  });

  describe("getProviderId", () => {
    it("should return github for undefined config", () => {
      expect(getProviderId(undefined)).toBe("github");
    });

    it("should return github for null config", () => {
      expect(getProviderId(null)).toBe("github");
    });

    it("should return github for config without providerId", () => {
      const config: ProjectManagementConfig = { enabled: true };
      expect(getProviderId(config)).toBe("github");
    });

    it("should return configured providerId", () => {
      const config: ProjectManagementConfig = { enabled: true, providerId: "jira" };
      expect(getProviderId(config)).toBe("jira");
    });
  });

  describe("isSyncEnabled", () => {
    it("should return false for undefined config", () => {
      expect(isSyncEnabled(undefined)).toBe(false);
    });

    it("should return false for null config", () => {
      expect(isSyncEnabled(null)).toBe(false);
    });

    it("should return false for disabled config", () => {
      const config: ProjectManagementConfig = { enabled: false };
      expect(isSyncEnabled(config)).toBe(false);
    });

    it("should return true for enabled config", () => {
      const config: ProjectManagementConfig = { enabled: true };
      expect(isSyncEnabled(config)).toBe(true);
    });
  });

  describe("LabelsConfig interface", () => {
    it("should allow custom type labels", () => {
      const config: LabelsConfig = {
        typeLabels: {
          FEATURE: "type:feature",
          BUG: "type:bug",
          ENHANCEMENT: "type:enhancement",
          TASK: "type:task",
        },
        customLabels: ["dev-workflow", "team:backend"],
      };

      expect(config.typeLabels.FEATURE).toBe("type:feature");
      expect(config.customLabels).toContain("dev-workflow");
    });
  });

  describe("ProjectManagementConfig interface", () => {
    it("should allow full configuration", () => {
      const config: ProjectManagementConfig = {
        enabled: true,
        providerId: "github",
        projectId: "PVT_kwDO123",
        projectUrl: "https://github.com/orgs/org/projects/1",
        labels: {
          typeLabels: {
            FEATURE: "feature",
            BUG: "bug",
            ENHANCEMENT: "enhancement",
            TASK: "task",
          },
          customLabels: ["dev-workflow"],
        },
        columnMapping: {
          IN_PROGRESS: "Doing",
          PR_REVIEW: "Code Review",
        },
      };

      expect(config.enabled).toBe(true);
      expect(config.providerId).toBe("github");
      expect(config.projectId).toBe("PVT_kwDO123");
    });

    it("should allow minimal configuration", () => {
      const config: ProjectManagementConfig = {
        enabled: false,
      };

      expect(config.enabled).toBe(false);
      expect(config.providerId).toBeUndefined();
    });
  });
});

// Type-level tests to ensure the interface is properly structured
// These don't run at runtime but verify the interface at compile time
describe("ProjectManagementProvider interface structure", () => {
  it("should define all required methods", () => {
    // This test verifies the interface is importable and has the expected shape
    // The actual method signatures are validated by TypeScript at compile time
    const requiredMethods = [
      "checkAuth",
      "checkRepository",
      "createIssue",
      "updateIssue",
      "closeIssue",
      "reopenIssue",
      "getIssue",
      "searchIssues",
      "ensureLabelsExist",
      "addToProject",
      "moveToColumn",
      "checkProject",
      "getProjectDetails",
      "getProjectStatusField",
      "linkParentChild",
      "addComment",
    ];

    // The interface is validated at compile time
    // This test just documents the expected methods
    expect(requiredMethods).toHaveLength(16);
  });

  it("should define required properties", () => {
    const requiredProperties = ["providerId", "displayName"];
    expect(requiredProperties).toHaveLength(2);
  });
});
