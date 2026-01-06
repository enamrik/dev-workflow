import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDatabase } from "../../__tests__/setup.js";
import { createRepositories } from "../../__tests__/helpers.js";
import { ProjectService, ProjectError, type GitOperations } from "../project-service.js";
import type { GitHubIssueSyncConfig } from "../../infrastructure/database/schema.js";

/**
 * Mock GitOperations for testing
 */
function createMockGitOperations(overrides: Partial<GitOperations> = {}): GitOperations {
  return {
    getInitialCommitHash: vi.fn().mockResolvedValue("abc123def456"),
    isGitRepository: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("ProjectService", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof createRepositories>;
  let mockGitOps: GitOperations;
  let service: ProjectService;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);
    mockGitOps = createMockGitOperations();
    service = new ProjectService(repos.projectRepository, mockGitOps);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("getOrCreateProject", () => {
    it("should create a new project for a new repository", async () => {
      const project = await service.getOrCreateProject("/path/to/my-project");

      expect(project.id).toBeDefined();
      expect(project.gitRootHash).toBe("abc123def456");
      expect(project.name).toBe("my-project"); // Derived from path
      expect(project.githubSync).toBeNull();
      // Note: gitRoot is NOT stored in database - it's computed from cwd when needed
    });

    it("should return existing project for known repository", async () => {
      // First call creates the project
      const created = await service.getOrCreateProject("/path/to/project");

      // Second call should return same project
      const found = await service.getOrCreateProject("/path/to/project");

      expect(found.id).toBe(created.id);
      expect(found.gitRootHash).toBe(created.gitRootHash);
    });

    it("should return same project when called from different paths (same gitRootHash)", async () => {
      // Create project at original location
      const original = await service.getOrCreateProject("/original/path");

      // Same repo accessed from different path - should return same project
      // (gitRoot is computed from cwd, not stored in database)
      const found = await service.getOrCreateProject("/new/path");

      expect(found.id).toBe(original.id);
      expect(found.gitRootHash).toBe(original.gitRootHash); // Same identity
    });

    it("should throw ProjectError for non-git directory", async () => {
      mockGitOps = createMockGitOperations({
        isGitRepository: vi.fn().mockResolvedValue(false),
      });
      service = new ProjectService(repos.projectRepository, mockGitOps);

      await expect(service.getOrCreateProject("/not/a/repo")).rejects.toThrow(ProjectError);
      await expect(service.getOrCreateProject("/not/a/repo")).rejects.toThrow(
        "Not a git repository"
      );
    });

    it("should throw ProjectError when git command fails", async () => {
      mockGitOps = createMockGitOperations({
        getInitialCommitHash: vi.fn().mockRejectedValue(new Error("Git error")),
      });
      service = new ProjectService(repos.projectRepository, mockGitOps);

      await expect(service.getOrCreateProject("/path/to/repo")).rejects.toThrow();
    });

    it("should differentiate between different repositories", async () => {
      // First repo
      mockGitOps = createMockGitOperations({
        getInitialCommitHash: vi.fn().mockResolvedValue("hash-repo-1"),
      });
      service = new ProjectService(repos.projectRepository, mockGitOps);
      const project1 = await service.getOrCreateProject("/path/to/repo1");

      // Second repo (different hash)
      mockGitOps = createMockGitOperations({
        getInitialCommitHash: vi.fn().mockResolvedValue("hash-repo-2"),
      });
      service = new ProjectService(repos.projectRepository, mockGitOps);
      const project2 = await service.getOrCreateProject("/path/to/repo2");

      expect(project1.id).not.toBe(project2.id);
      expect(project1.gitRootHash).toBe("hash-repo-1");
      expect(project2.gitRootHash).toBe("hash-repo-2");
    });
  });

  describe("findById", () => {
    it("should find a project by ID", async () => {
      const created = await service.getOrCreateProject("/path/to/project");

      const found = service.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });

    it("should return null for non-existent ID", () => {
      const found = service.findById("non-existent-id");
      expect(found).toBeNull();
    });
  });

  describe("findByGitRootHash", () => {
    it("should find a project by git root hash", async () => {
      await service.getOrCreateProject("/path/to/project");

      const found = service.findByGitRootHash("abc123def456");

      expect(found).toBeDefined();
      expect(found?.gitRootHash).toBe("abc123def456");
    });

    it("should return null for non-existent hash", () => {
      const found = service.findByGitRootHash("non-existent-hash");
      expect(found).toBeNull();
    });
  });

  describe("findAll", () => {
    it("should return all projects", async () => {
      // Create first project
      mockGitOps = createMockGitOperations({
        getInitialCommitHash: vi.fn().mockResolvedValue("hash1"),
      });
      service = new ProjectService(repos.projectRepository, mockGitOps);
      await service.getOrCreateProject("/path/to/project1");

      // Create second project
      mockGitOps = createMockGitOperations({
        getInitialCommitHash: vi.fn().mockResolvedValue("hash2"),
      });
      service = new ProjectService(repos.projectRepository, mockGitOps);
      await service.getOrCreateProject("/path/to/project2");

      const projects = service.findAll();
      expect(projects).toHaveLength(2);
    });
  });

  describe("updateGitHubSync", () => {
    it("should update GitHub sync configuration", async () => {
      const project = await service.getOrCreateProject("/path/to/project");

      const githubSync: GitHubIssueSyncConfig = {
        enabled: true,
        labels: {
          typeLabels: {
            FEATURE: "feature",
            BUG: "bug",
            ENHANCEMENT: "enhancement",
            TASK: "task",
          },
        },
      };

      const updated = service.updateGitHubSync(project.id, githubSync);

      expect(updated.githubSync).toEqual(githubSync);
    });

    it("should clear GitHub sync configuration", async () => {
      const project = await service.getOrCreateProject("/path/to/project");

      // Enable first
      service.updateGitHubSync(project.id, {
        enabled: true,
        labels: {
          typeLabels: {
            FEATURE: "feature",
            BUG: "bug",
            ENHANCEMENT: "enhancement",
            TASK: "task",
          },
        },
      });

      // Then disable
      const updated = service.updateGitHubSync(project.id, null);

      expect(updated.githubSync).toBeNull();
    });

    it("should throw ProjectError for non-existent project", () => {
      expect(() => service.updateGitHubSync("non-existent", { enabled: true })).toThrow(
        ProjectError
      );
    });
  });

  describe("getGitHubSync", () => {
    it("should return GitHub sync config", async () => {
      const project = await service.getOrCreateProject("/path/to/project");

      const githubSync: GitHubIssueSyncConfig = {
        enabled: true,
        projectId: "PVT_123",
      };

      service.updateGitHubSync(project.id, githubSync);

      const config = service.getGitHubSync(project.id);
      expect(config).toEqual(githubSync);
    });

    it("should return null when not configured", async () => {
      const project = await service.getOrCreateProject("/path/to/project");

      const config = service.getGitHubSync(project.id);
      expect(config).toBeNull();
    });

    it("should throw ProjectError for non-existent project", () => {
      expect(() => service.getGitHubSync("non-existent")).toThrow(ProjectError);
    });
  });

  describe("isGitHubSyncEnabled", () => {
    it("should return true when enabled", async () => {
      const project = await service.getOrCreateProject("/path/to/project");

      service.updateGitHubSync(project.id, { enabled: true });

      expect(service.isGitHubSyncEnabled(project.id)).toBe(true);
    });

    it("should return false when disabled", async () => {
      const project = await service.getOrCreateProject("/path/to/project");

      service.updateGitHubSync(project.id, { enabled: false });

      expect(service.isGitHubSyncEnabled(project.id)).toBe(false);
    });

    it("should return false when not configured", async () => {
      const project = await service.getOrCreateProject("/path/to/project");

      expect(service.isGitHubSyncEnabled(project.id)).toBe(false);
    });
  });

  describe("update", () => {
    it("should update project properties", async () => {
      const project = await service.getOrCreateProject("/path/to/project");

      const updated = service.update(project.id, {
        name: "new-name",
      });

      expect(updated.name).toBe("new-name");
    });

    it("should throw ProjectError for non-existent project", () => {
      expect(() => service.update("non-existent", { name: "new-name" })).toThrow(ProjectError);
    });
  });
});
