/**
 * Tests for GitHubProjectManagementProvider
 *
 * Verifies the provider correctly wraps GitHubCLI operations and maps types.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { GitHubProjectManagementProvider } from "../github-project-management-provider.js";
import { ProjectManagementProviderError } from "../../../domain/project-management-provider.js";
import { MockGitHubCLI } from "../../../__tests__/mocks/mock-github-cli.js";
import type { Issue } from "../../../domain/issue.js";

/**
 * Create a minimal Issue object for testing closeIssue
 */
function createMockIssue(githubIssueNumber: number | null): Issue {
  return {
    id: "test-issue-id",
    projectId: "test-project",
    number: 1,
    title: "Test Issue",
    description: "Test description",
    type: "FEATURE",
    status: "OPEN",
    priority: "MEDIUM",
    acceptanceCriteria: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDeleted: false,
    githubSync: githubIssueNumber
      ? {
          githubIssueNumber,
          githubUrl: `https://github.com/test/repo/issues/${githubIssueNumber}`,
          githubNodeId: `I_test_${githubIssueNumber}`,
          syncStatus: "SYNCED",
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: null,
          projectItemId: null,
        }
      : undefined,
  };
}

describe("GitHubProjectManagementProvider", () => {
  let mockGitHubCLI: MockGitHubCLI;
  let provider: GitHubProjectManagementProvider;
  let enabledProvider: GitHubProjectManagementProvider;

  beforeEach(() => {
    mockGitHubCLI = new MockGitHubCLI();
    // Provider with null config (disabled) - for testing low-level operations
    provider = new GitHubProjectManagementProvider(mockGitHubCLI, null);
    // Provider with enabled config - for testing entity-level operations that check isEnabled()
    enabledProvider = new GitHubProjectManagementProvider(mockGitHubCLI, {
      enabled: true,
    });
  });

  // ===========================================================================
  // Identity
  // ===========================================================================

  describe("identity", () => {
    it("should have correct providerId", () => {
      expect(provider.providerId).toBe("github");
    });

    it("should have correct displayName", () => {
      expect(provider.displayName).toBe("GitHub");
    });
  });

  // ===========================================================================
  // Authentication & Validation
  // ===========================================================================

  describe("checkAuth", () => {
    it("should return authenticated when gh CLI is authenticated", async () => {
      mockGitHubCLI.setConfig({ isAuthenticated: true });

      const result = await provider.checkAuth();

      expect(result.authenticated).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return not authenticated when gh CLI is not authenticated", async () => {
      mockGitHubCLI.setConfig({ isAuthenticated: false });

      const result = await provider.checkAuth();

      expect(result.authenticated).toBe(false);
      expect(result.error).toContain("not authenticated");
    });

    it("should return error when auth check throws", async () => {
      mockGitHubCLI.setConfig({ errors: { checkAuth: new Error("Network error") } });

      const result = await provider.checkAuth();

      expect(result.authenticated).toBe(false);
      expect(result.error).toContain("Network error");
    });
  });

  describe("checkRepository", () => {
    it("should return accessible when in a GitHub repo", async () => {
      mockGitHubCLI.setConfig({ isInRepository: true });

      const result = await provider.checkRepository();

      expect(result.accessible).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return not accessible when not in a repo", async () => {
      mockGitHubCLI.setConfig({ isInRepository: false });

      const result = await provider.checkRepository();

      expect(result.accessible).toBe(false);
      expect(result.error).toContain("Not in a Git repository");
    });
  });

  // ===========================================================================
  // Issue Operations
  // ===========================================================================

  describe("createIssue", () => {
    it("should create issue and map to ExternalIssue", async () => {
      const result = await provider.createIssue({
        title: "Test Issue",
        body: "Test body",
        labels: ["bug"],
      });

      expect(result.id).toBe("1");
      expect(result.numericId).toBe(1);
      expect(result.title).toBe("Test Issue");
      expect(result.body).toBe("Test body");
      expect(result.state).toBe("OPEN");
      expect(result.labels).toContain("bug");
      expect(result.url).toContain("/issues/1");
      expect(result.nodeId).toBeDefined();
    });

    it("should throw ProjectManagementProviderError on failure", async () => {
      mockGitHubCLI.setConfig({ errors: { createIssue: new Error("Rate limited") } });

      await expect(
        provider.createIssue({ title: "Test", body: "Body", labels: [] })
      ).rejects.toThrow(ProjectManagementProviderError);
    });
  });

  describe("updateIssue", () => {
    it("should update issue and return mapped ExternalIssue", async () => {
      // Create an issue first
      await provider.createIssue({
        title: "Original",
        body: "Original body",
        labels: ["bug"],
      });

      const result = await provider.updateIssue({
        issueRef: "1",
        title: "Updated Title",
        body: "Updated body",
        labels: ["enhancement"],
      });

      expect(result.id).toBe("1");
      expect(result.title).toBe("Updated Title");
      expect(result.body).toBe("Updated body");
      expect(result.labels).toContain("enhancement");
    });

    it("should preserve existing fields when not provided", async () => {
      // Create an issue first
      await provider.createIssue({
        title: "Original",
        body: "Original body",
        labels: ["bug"],
      });

      const result = await provider.updateIssue({
        issueRef: "1",
        title: "Updated Title",
        // body and labels not provided
      });

      expect(result.title).toBe("Updated Title");
      expect(result.body).toBe("Original body");
      expect(result.labels).toContain("bug");
    });

    it("should throw error if issue not found", async () => {
      await expect(provider.updateIssue({ issueRef: "999", title: "New" })).rejects.toThrow(
        ProjectManagementProviderError
      );
    });
  });

  describe("closeIssue", () => {
    it("should close issue without comment", async () => {
      // Create an issue first
      await enabledProvider.createIssue({
        title: "Test",
        body: "Body",
        labels: [],
      });

      const issue = createMockIssue(1);
      await expect(enabledProvider.closeIssue(issue)).resolves.not.toThrow();

      const calls = mockGitHubCLI.getCallsTo("closeIssue");
      expect(calls.length).toBe(1);
      expect(calls[0].args[0]).toBe(1);
    });

    it("should close issue with comment", async () => {
      // Create an issue first
      await enabledProvider.createIssue({
        title: "Test",
        body: "Body",
        labels: [],
      });

      const issue = createMockIssue(1);
      await expect(enabledProvider.closeIssue(issue, "Closing comment")).resolves.not.toThrow();

      const calls = mockGitHubCLI.getCallsTo("closeIssueWithComment");
      expect(calls.length).toBe(1);
      expect(calls[0].args).toEqual([1, "Closing comment"]);
    });

    it("should no-op when issue has no githubSync", async () => {
      const issue = createMockIssue(null);
      await expect(enabledProvider.closeIssue(issue)).resolves.not.toThrow();

      const calls = mockGitHubCLI.getCallsTo("closeIssue");
      expect(calls.length).toBe(0);
    });

    it("should no-op when provider is disabled", async () => {
      const issue = createMockIssue(1);
      // Using the disabled provider
      await expect(provider.closeIssue(issue)).resolves.not.toThrow();

      const calls = mockGitHubCLI.getCallsTo("closeIssue");
      expect(calls.length).toBe(0);
    });
  });

  describe("reopenIssue", () => {
    it("should reopen a closed issue", async () => {
      // Create and close an issue using enabled provider
      await enabledProvider.createIssue({ title: "Test", body: "Body", labels: [] });
      const issue = createMockIssue(1);
      await enabledProvider.closeIssue(issue);

      await expect(provider.reopenIssue("1")).resolves.not.toThrow();

      const calls = mockGitHubCLI.getCallsTo("reopenIssue");
      expect(calls.length).toBe(1);
      expect(calls[0].args[0]).toBe(1);
    });
  });

  describe("getIssue", () => {
    it("should get issue and map to ExternalIssue", async () => {
      // Create an issue first
      await provider.createIssue({
        title: "Test Issue",
        body: "Body",
        labels: ["bug"],
      });

      const result = await provider.getIssue("1");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("1");
      expect(result!.title).toBe("Test Issue");
      expect(result!.state).toBe("OPEN");
    });

    it("should return null for non-existent issue", async () => {
      const result = await provider.getIssue("999");
      expect(result).toBeNull();
    });

    it("should throw error on invalid issue ref", async () => {
      await expect(provider.getIssue("invalid")).rejects.toThrow(ProjectManagementProviderError);
    });
  });

  describe("searchIssues", () => {
    it("should search and map results to ExternalIssues", async () => {
      mockGitHubCLI.setConfig({
        searchResults: [
          {
            number: 1,
            url: "https://github.com/test/repo/issues/1",
            nodeId: "I_test_1",
            title: "Test Issue",
            body: "Body",
            state: "OPEN",
            labels: ["bug"],
          },
          {
            number: 2,
            url: "https://github.com/test/repo/issues/2",
            nodeId: "I_test_2",
            title: "Another Issue",
            body: "Body 2",
            state: "CLOSED",
            labels: [],
          },
        ],
      });

      const results = await provider.searchIssues("test");

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("1");
      expect(results[0].title).toBe("Test Issue");
      expect(results[1].id).toBe("2");
      expect(results[1].state).toBe("CLOSED");
    });

    it("should filter by state", async () => {
      mockGitHubCLI.setConfig({
        searchResults: [
          {
            number: 1,
            url: "https://github.com/test/repo/issues/1",
            nodeId: "I_test_1",
            title: "Open Issue",
            body: "Body",
            state: "OPEN",
            labels: [],
          },
          {
            number: 2,
            url: "https://github.com/test/repo/issues/2",
            nodeId: "I_test_2",
            title: "Closed Issue",
            body: "Body 2",
            state: "CLOSED",
            labels: [],
          },
        ],
      });

      const results = await provider.searchIssues("test", "open");

      expect(results).toHaveLength(1);
      expect(results[0].state).toBe("OPEN");
    });
  });

  // ===========================================================================
  // Label Operations
  // ===========================================================================

  describe("ensureLabelsExist", () => {
    it("should create missing labels", async () => {
      mockGitHubCLI.setConfig({ existingLabels: ["bug"] });

      await provider.ensureLabelsExist(["bug", "enhancement", "feature"]);

      const createLabelCalls = mockGitHubCLI.getCallsTo("createLabel");
      // Should only create enhancement and feature, not bug
      expect(createLabelCalls.length).toBe(2);
      expect(createLabelCalls.map((c) => c.args[0])).toContain("enhancement");
      expect(createLabelCalls.map((c) => c.args[0])).toContain("feature");
    });

    it("should handle case-insensitive label matching", async () => {
      mockGitHubCLI.setConfig({ existingLabels: ["Bug"] });

      await provider.ensureLabelsExist(["bug"]);

      const createLabelCalls = mockGitHubCLI.getCallsTo("createLabel");
      // Should not create "bug" since "Bug" already exists
      expect(createLabelCalls.length).toBe(0);
    });
  });

  // ===========================================================================
  // Project/Board Operations
  // ===========================================================================

  describe("addToProject", () => {
    it("should add issue to project and return item ID", async () => {
      mockGitHubCLI.setConfig({ projectExists: true });

      const result = await provider.addToProject("I_test_1", "PVT_project");

      expect(result.success).toBe(true);
      expect(result.itemId).toBeDefined();
    });

    it("should return error when project does not exist", async () => {
      mockGitHubCLI.setConfig({ projectExists: false });

      const result = await provider.addToProject("I_test_1", "PVT_nonexistent");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("checkProject", () => {
    it("should return true when project exists", async () => {
      mockGitHubCLI.setConfig({ projectExists: true });

      const result = await provider.checkProject("PVT_project");

      expect(result).toBe(true);
    });

    it("should return false when project does not exist", async () => {
      mockGitHubCLI.setConfig({ projectExists: false });

      const result = await provider.checkProject("PVT_nonexistent");

      expect(result).toBe(false);
    });
  });

  describe("getProjectDetails", () => {
    it("should return project details", async () => {
      mockGitHubCLI.setConfig({
        projectExists: true,
        projectDetails: {
          id: "PVT_test",
          title: "Test Project",
          url: "https://github.com/orgs/test/projects/1",
        },
      });

      const result = await provider.getProjectDetails("PVT_test");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("PVT_test");
      expect(result!.title).toBe("Test Project");
      expect(result!.url).toBe("https://github.com/orgs/test/projects/1");
    });

    it("should return null when project does not exist", async () => {
      mockGitHubCLI.setConfig({ projectExists: false });

      const result = await provider.getProjectDetails("PVT_nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getProjectStatusField", () => {
    it("should return status field with options", async () => {
      mockGitHubCLI.setConfig({
        projectStatusField: {
          fieldId: "PVTSSF_status",
          options: [
            { id: "opt_1", name: "Backlog" },
            { id: "opt_2", name: "In Progress" },
            { id: "opt_3", name: "Done" },
          ],
        },
      });

      const result = await provider.getProjectStatusField("PVT_project");

      expect(result).not.toBeNull();
      expect(result!.fieldId).toBe("PVTSSF_status");
      expect(result!.fieldName).toBe("Status");
      expect(result!.options).toHaveLength(3);
      expect(result!.options[0].name).toBe("Backlog");
      expect(result!.options[1].name).toBe("In Progress");
      expect(result!.options[2].name).toBe("Done");
    });
  });

  describe("moveToColumn", () => {
    it("should move item to specified column", async () => {
      mockGitHubCLI.setConfig({
        projectStatusField: {
          fieldId: "PVTSSF_status",
          options: [
            { id: "opt_backlog", name: "Backlog" },
            { id: "opt_in_progress", name: "In Progress" },
            { id: "opt_done", name: "Done" },
          ],
        },
      });

      await expect(
        provider.moveToColumn("PVTI_item", "PVT_project", "In Progress")
      ).resolves.not.toThrow();

      const runCalls = mockGitHubCLI.getCallsTo("run");
      // Should have called run for getProjectStatusField and updateProjectItemField
      expect(runCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("should throw error when column not found", async () => {
      mockGitHubCLI.setConfig({
        projectStatusField: {
          fieldId: "PVTSSF_status",
          options: [
            { id: "opt_backlog", name: "Backlog" },
            { id: "opt_done", name: "Done" },
          ],
        },
      });

      await expect(
        provider.moveToColumn("PVTI_item", "PVT_project", "NonExistent")
      ).rejects.toThrow(ProjectManagementProviderError);
    });

    it("should match column names case-insensitively", async () => {
      mockGitHubCLI.setConfig({
        projectStatusField: {
          fieldId: "PVTSSF_status",
          options: [
            { id: "opt_backlog", name: "Backlog" },
            { id: "opt_in_progress", name: "In Progress" },
          ],
        },
      });

      // Should match "in progress" to "In Progress"
      await expect(
        provider.moveToColumn("PVTI_item", "PVT_project", "in progress")
      ).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // Comments
  // ===========================================================================

  describe("addComment", () => {
    it("should add comment to issue", async () => {
      // Create an issue first
      await provider.createIssue({ title: "Test", body: "Body", labels: [] });

      await expect(provider.addComment("1", "This is a comment")).resolves.not.toThrow();

      const calls = mockGitHubCLI.getCallsTo("commentOnIssue");
      expect(calls.length).toBe(1);
      expect(calls[0].args).toEqual([1, "This is a comment"]);
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe("error handling", () => {
    it("should wrap errors in ProjectManagementProviderError", async () => {
      mockGitHubCLI.setConfig({
        errors: { createIssue: new Error("API error") },
      });

      try {
        await provider.createIssue({ title: "Test", body: "Body", labels: [] });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectManagementProviderError);
        const providerError = error as ProjectManagementProviderError;
        expect(providerError.providerId).toBe("github");
        expect(providerError.operation).toBe("createIssue");
        expect(providerError.message).toContain("API error");
      }
    });

    it("should include cause error in wrapped error", async () => {
      const causeError = new Error("Original error");
      mockGitHubCLI.setConfig({ errors: { closeIssue: causeError } });

      try {
        const issue = createMockIssue(1);
        // Use enabledProvider so it doesn't no-op
        await enabledProvider.closeIssue(issue);
        expect.fail("Should have thrown");
      } catch (error) {
        const providerError = error as ProjectManagementProviderError;
        expect(providerError.cause).toBe(causeError);
      }
    });
  });

  // ===========================================================================
  // Issue Reference Parsing
  // ===========================================================================

  describe("issue reference parsing", () => {
    it("should accept numeric string issue refs", async () => {
      await provider.createIssue({ title: "Test", body: "Body", labels: [] });

      const result = await provider.getIssue("1");
      expect(result).not.toBeNull();
    });

    it("should reject non-numeric issue refs", async () => {
      await expect(provider.getIssue("abc")).rejects.toThrow(ProjectManagementProviderError);
    });

    it("should reject zero or negative issue refs", async () => {
      await expect(provider.getIssue("0")).rejects.toThrow(ProjectManagementProviderError);
      await expect(provider.getIssue("-1")).rejects.toThrow(ProjectManagementProviderError);
    });
  });
});
