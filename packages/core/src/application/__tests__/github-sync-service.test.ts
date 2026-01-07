import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDatabase } from "../../__tests__/setup.js";
import { createRepositories } from "../../__tests__/helpers.js";
import { GitHubSyncService, GitHubSyncError } from "../github-sync-service.js";
import type {
  ProjectManagementProvider,
  ExternalIssue,
} from "../../domain/project-management-provider.js";

/**
 * Create a mock ProjectManagementProvider for testing
 */
function createMockProvider(
  overrides: Partial<ProjectManagementProvider> = {}
): ProjectManagementProvider {
  const defaultIssue: ExternalIssue = {
    id: "1",
    numericId: 1,
    url: "https://github.com/owner/repo/issues/1",
    nodeId: "I_abc123",
    title: "Test Issue",
    body: "Test body",
    state: "OPEN",
    labels: [],
  };

  return {
    providerId: "github",
    displayName: "GitHub",
    checkAuth: vi.fn().mockResolvedValue({ authenticated: true }),
    checkRepository: vi.fn().mockResolvedValue({ accessible: true }),
    createIssue: vi.fn().mockResolvedValue(defaultIssue),
    updateIssue: vi.fn().mockResolvedValue({
      ...defaultIssue,
      title: "Updated Issue",
      body: "Updated body",
    }),
    closeIssue: vi.fn().mockResolvedValue(undefined),
    reopenIssue: vi.fn().mockResolvedValue(undefined),
    getIssue: vi.fn().mockResolvedValue(null),
    searchIssues: vi.fn().mockResolvedValue([]),
    ensureLabelsExist: vi.fn().mockResolvedValue(undefined),
    addToProject: vi.fn().mockResolvedValue({ success: true, itemId: "PVTI_project_item_123" }),
    moveToColumn: vi.fn().mockResolvedValue(undefined),
    checkProject: vi.fn().mockResolvedValue(true),
    getProjectDetails: vi.fn().mockResolvedValue({
      id: "PVT_123",
      title: "Test Project",
      url: "https://github.com/orgs/owner/projects/1",
    }),
    getProjectStatusField: vi.fn().mockResolvedValue(null),
    linkParentChild: vi.fn().mockResolvedValue(undefined),
    addComment: vi.fn().mockResolvedValue(undefined),
    assignIssue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof createRepositories>;
  let mockProvider: ProjectManagementProvider;
  let service: GitHubSyncService;
  let testProjectId: string;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);
    mockProvider = createMockProvider();

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
      mockProvider,
      repos.projectRepository,
      testProjectId
    );
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("createGitHubIssue", () => {
    it("should create an external issue and add to project successfully", async () => {
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
      expect(mockProvider.addToProject).toHaveBeenCalledWith("I_abc123", "PVT_test_project_456");
    });

    it("should fail when external issue creation fails", async () => {
      mockProvider = createMockProvider({
        createIssue: vi.fn().mockRejectedValue(new Error("GitHub API error")),
      });
      service = new GitHubSyncService(
        repos.issueRepository,
        mockProvider,
        repos.projectRepository,
        testProjectId
      );

      await expect(
        service.createGitHubIssue("Test Issue", "Test description", [], "FEATURE")
      ).rejects.toThrow("GitHub API error");
    });

    it("should fail when project association fails", async () => {
      mockProvider = createMockProvider({
        addToProject: vi.fn().mockRejectedValue(new Error("Project not found")),
      });
      service = new GitHubSyncService(
        repos.issueRepository,
        mockProvider,
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
      mockProvider = createMockProvider({
        addToProject: vi.fn().mockResolvedValue({ success: true, itemId: "" }), // Empty string
      });
      service = new GitHubSyncService(
        repos.issueRepository,
        mockProvider,
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

    it("should fail when project association returns unsuccessful result", async () => {
      mockProvider = createMockProvider({
        addToProject: vi.fn().mockResolvedValue({ success: false, error: "Failed" }),
      });
      service = new GitHubSyncService(
        repos.issueRepository,
        mockProvider,
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
      expect(mockProvider.addToProject).not.toHaveBeenCalled();
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
      mockProvider = createMockProvider({
        addToProject: vi.fn().mockRejectedValue(originalError),
      });
      service = new GitHubSyncService(
        repos.issueRepository,
        mockProvider,
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
