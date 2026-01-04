import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDatabase } from "../../__tests__/setup.js";
import { createRepositories } from "../../__tests__/helpers.js";
import { GitHubSyncService, GitHubSyncError } from "../github-sync-service.js";
import type { GitHubCLI } from "../../infrastructure/github/github-cli.js";
import type { GitHubIssueData } from "../../domain/github.js";

/**
 * Create a mock GitHubCLI for testing
 */
function createMockGitHubCLI(overrides: Partial<GitHubCLI> = {}): GitHubCLI {
  return {
    checkAuth: vi.fn().mockResolvedValue(true),
    checkCurrentRepository: vi.fn().mockResolvedValue(true),
    createIssue: vi.fn().mockResolvedValue({
      number: 1,
      url: "https://github.com/owner/repo/issues/1",
      nodeId: "I_abc123",
      title: "Test Issue",
      body: "Test body",
      state: "OPEN",
      labels: [],
    } as GitHubIssueData),
    updateIssue: vi.fn().mockResolvedValue({
      number: 1,
      url: "https://github.com/owner/repo/issues/1",
      nodeId: "I_abc123",
      title: "Updated Issue",
      body: "Updated body",
      state: "OPEN",
      labels: [],
    } as GitHubIssueData),
    closeIssue: vi.fn().mockResolvedValue(undefined),
    reopenIssue: vi.fn().mockResolvedValue(undefined),
    getIssue: vi.fn().mockResolvedValue(null),
    listLabels: vi.fn().mockResolvedValue([]),
    createLabel: vi.fn().mockResolvedValue(undefined),
    addToProject: vi.fn().mockResolvedValue("PVTI_project_item_123"),
    checkProject: vi.fn().mockResolvedValue(true),
    getProjectDetails: vi.fn().mockResolvedValue({
      id: "PVT_123",
      title: "Test Project",
      url: "https://github.com/orgs/owner/projects/1",
    }),
    createPR: vi.fn().mockResolvedValue({
      number: 1,
      url: "https://github.com/owner/repo/pull/1",
      nodeId: "PR_abc123",
      title: "Test PR",
      body: "",
      state: "OPEN",
      isDraft: false,
      headBranch: "feature",
      baseBranch: "main",
      merged: false,
      mergeable: "MERGEABLE",
    }),
    mergePR: vi.fn().mockResolvedValue({
      number: 1,
      url: "https://github.com/owner/repo/pull/1",
      nodeId: "PR_abc123",
      title: "Test PR",
      body: "",
      state: "MERGED",
      isDraft: false,
      headBranch: "feature",
      baseBranch: "main",
      merged: true,
      mergeable: "UNKNOWN",
    }),
    getPR: vi.fn().mockResolvedValue(null),
    findPRByBranch: vi.fn().mockResolvedValue(null),
    run: vi.fn().mockResolvedValue({ success: true, stdout: "", stderr: "", exitCode: 0 }),
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof createRepositories>;
  let mockGitHubCLI: GitHubCLI;
  let service: GitHubSyncService;
  let testProjectId: string;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);
    mockGitHubCLI = createMockGitHubCLI();

    // Create a project with GitHub sync enabled
    const project = repos.projectRepository.create({
      name: "Test Project",
      gitRootHash: "abc123",
      githubSync: {
        enabled: true,
        projectId: "PVT_test_project_456",
        labels: {
          typeLabels: {
            FEATURE: "feature",
            BUG: "bug",
            ENHANCEMENT: "enhancement",
            TASK: "task",
          },
        },
      },
    });
    testProjectId = project.id;

    service = new GitHubSyncService(
      repos.issueRepository,
      mockGitHubCLI,
      repos.projectRepository,
      testProjectId
    );
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("createGitHubIssue", () => {
    it("should create a GitHub issue and add to project successfully", async () => {
      const result = await service.createGitHubIssue(
        "Test Issue",
        "Test description",
        ["Criterion 1"],
        "FEATURE"
      );

      expect(result.data.number).toBe(1);
      expect(result.data.url).toBe("https://github.com/owner/repo/issues/1");
      expect(result.syncState.projectItemId).toBe("PVTI_project_item_123");
      expect(result.syncState.syncStatus).toBe("SYNCED");
      expect(mockGitHubCLI.addToProject).toHaveBeenCalledWith("PVT_test_project_456", "I_abc123");
    });

    it("should fail when GitHub issue creation fails", async () => {
      mockGitHubCLI = createMockGitHubCLI({
        createIssue: vi.fn().mockRejectedValue(new Error("GitHub API error")),
      });
      service = new GitHubSyncService(
        repos.issueRepository,
        mockGitHubCLI,
        repos.projectRepository,
        testProjectId
      );

      await expect(
        service.createGitHubIssue("Test Issue", "Test description", [], "FEATURE")
      ).rejects.toThrow("GitHub API error");
    });

    it("should fail when project association fails", async () => {
      mockGitHubCLI = createMockGitHubCLI({
        addToProject: vi.fn().mockRejectedValue(new Error("Project not found")),
      });
      service = new GitHubSyncService(
        repos.issueRepository,
        mockGitHubCLI,
        repos.projectRepository,
        testProjectId
      );

      await expect(
        service.createGitHubIssue("Test Issue", "Test description", [], "FEATURE")
      ).rejects.toThrow(GitHubSyncError);

      await expect(
        service.createGitHubIssue("Test Issue", "Test description", [], "FEATURE")
      ).rejects.toThrow("Failed to add issue to GitHub Project PVT_test_project_456");
    });

    it("should fail when project association returns empty item ID", async () => {
      mockGitHubCLI = createMockGitHubCLI({
        addToProject: vi.fn().mockResolvedValue(""), // Empty string
      });
      service = new GitHubSyncService(
        repos.issueRepository,
        mockGitHubCLI,
        repos.projectRepository,
        testProjectId
      );

      await expect(
        service.createGitHubIssue("Test Issue", "Test description", [], "FEATURE")
      ).rejects.toThrow(GitHubSyncError);

      await expect(
        service.createGitHubIssue("Test Issue", "Test description", [], "FEATURE")
      ).rejects.toThrow("Project association returned empty item ID");
    });

    it("should fail when project association returns null", async () => {
      mockGitHubCLI = createMockGitHubCLI({
        addToProject: vi.fn().mockResolvedValue(null),
      });
      service = new GitHubSyncService(
        repos.issueRepository,
        mockGitHubCLI,
        repos.projectRepository,
        testProjectId
      );

      await expect(
        service.createGitHubIssue("Test Issue", "Test description", [], "FEATURE")
      ).rejects.toThrow("Project association returned empty item ID");
    });

    it("should succeed when no projectId is configured", async () => {
      // Update project to have no projectId
      repos.projectRepository.update(testProjectId, {
        githubSync: {
          enabled: true,
          // No projectId
        },
      });

      const result = await service.createGitHubIssue(
        "Test Issue",
        "Test description",
        [],
        "FEATURE"
      );

      expect(result.data.number).toBe(1);
      expect(result.syncState.projectItemId).toBeNull();
      expect(mockGitHubCLI.addToProject).not.toHaveBeenCalled();
    });

    it("should throw when GitHub sync is not enabled", async () => {
      // Disable GitHub sync
      repos.projectRepository.update(testProjectId, {
        githubSync: {
          enabled: false,
        },
      });

      await expect(
        service.createGitHubIssue("Test Issue", "Test description", [], "FEATURE")
      ).rejects.toThrow(GitHubSyncError);

      await expect(
        service.createGitHubIssue("Test Issue", "Test description", [], "FEATURE")
      ).rejects.toThrow("GitHub sync is not enabled");
    });

    it("should preserve original error cause when wrapping", async () => {
      const originalError = new Error("Network timeout");
      mockGitHubCLI = createMockGitHubCLI({
        addToProject: vi.fn().mockRejectedValue(originalError),
      });
      service = new GitHubSyncService(
        repos.issueRepository,
        mockGitHubCLI,
        repos.projectRepository,
        testProjectId
      );

      try {
        await service.createGitHubIssue("Test Issue", "Test description", [], "FEATURE");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubSyncError);
        expect((error as GitHubSyncError).cause).toBe(originalError);
      }
    });
  });

  describe("isEnabled", () => {
    it("should return true when sync is enabled", () => {
      expect(service.isEnabled()).toBe(true);
    });

    it("should return false when sync is disabled", () => {
      repos.projectRepository.update(testProjectId, {
        githubSync: {
          enabled: false,
        },
      });

      expect(service.isEnabled()).toBe(false);
    });

    it("should return false when no config exists", () => {
      repos.projectRepository.update(testProjectId, {
        githubSync: null,
      });

      expect(service.isEnabled()).toBe(false);
    });
  });
});
