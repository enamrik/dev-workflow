import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/setup.js";
import { createRepositories } from "../../../__tests__/helpers.js";
import type { GitHubIssueSyncConfig } from "../../database/schema.js";

describe("SqliteProjectRepository", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof createRepositories>;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("create", () => {
    it("should create a project with all fields", () => {
      const project = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
        gitRoot: "/path/to/project",
      });

      expect(project.id).toBeDefined();
      expect(project.gitRootHash).toBe("abc123def456");
      expect(project.name).toBe("test-project");
      expect(project.gitRoot).toBe("/path/to/project");
      expect(project.githubSync).toBeNull();
      expect(project.createdAt).toBeDefined();
      expect(project.updatedAt).toBeDefined();
    });

    it("should create a project with GitHub sync config", () => {
      const githubSync: GitHubIssueSyncConfig = {
        enabled: true,
        projectId: "PVT_kwDO123",
        labels: {
          typeLabels: {
            FEATURE: "feature",
            BUG: "bug",
            ENHANCEMENT: "enhancement",
            TASK: "task",
          },
        },
      };

      const project = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
        gitRoot: "/path/to/project",
        githubSync,
      });

      expect(project.githubSync).toEqual(githubSync);
    });

    it("should enforce unique gitRootHash", () => {
      repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "project-1",
        gitRoot: "/path/to/project-1",
      });

      expect(() =>
        repos.projectRepository.create({
          gitRootHash: "abc123def456", // Same hash
          name: "project-2",
          gitRoot: "/path/to/project-2",
        })
      ).toThrow();
    });
  });

  describe("findById", () => {
    it("should find a project by ID", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
        gitRoot: "/path/to/project",
      });

      const found = repos.projectRepository.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe(created.name);
    });

    it("should return null for non-existent ID", () => {
      const found = repos.projectRepository.findById("non-existent-id");
      expect(found).toBeNull();
    });
  });

  describe("findByGitRootHash", () => {
    it("should find a project by git root hash", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
        gitRoot: "/path/to/project",
      });

      const found = repos.projectRepository.findByGitRootHash("abc123def456");

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.gitRootHash).toBe("abc123def456");
    });

    it("should return null for non-existent hash", () => {
      const found = repos.projectRepository.findByGitRootHash("non-existent-hash");
      expect(found).toBeNull();
    });
  });

  describe("findAll", () => {
    it("should return empty array when no projects exist", () => {
      const projects = repos.projectRepository.findAll();
      expect(projects).toHaveLength(0);
    });

    it("should return all projects", () => {
      repos.projectRepository.create({
        gitRootHash: "hash1",
        name: "project-1",
        gitRoot: "/path/to/project-1",
      });

      repos.projectRepository.create({
        gitRootHash: "hash2",
        name: "project-2",
        gitRoot: "/path/to/project-2",
      });

      const projects = repos.projectRepository.findAll();
      expect(projects).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("should update project fields", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "old-name",
        gitRoot: "/old/path",
      });

      const updated = repos.projectRepository.update(created.id, {
        name: "new-name",
        gitRoot: "/new/path",
      });

      expect(updated.name).toBe("new-name");
      expect(updated.gitRoot).toBe("/new/path");
      expect(updated.gitRootHash).toBe("abc123def456"); // Should not change
    });

    it("should update GitHub sync config", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
        gitRoot: "/path/to/project",
      });

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

      const updated = repos.projectRepository.update(created.id, { githubSync });

      expect(updated.githubSync).toEqual(githubSync);
    });

    it("should clear GitHub sync config", () => {
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

      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
        gitRoot: "/path/to/project",
        githubSync,
      });

      const updated = repos.projectRepository.update(created.id, { githubSync: null });

      expect(updated.githubSync).toBeNull();
    });

    it("should preserve unchanged fields", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
        gitRoot: "/path/to/project",
      });

      const updated = repos.projectRepository.update(created.id, {
        name: "new-name",
      });

      expect(updated.gitRoot).toBe("/path/to/project"); // Preserved
    });
  });

  describe("delete", () => {
    it("should delete a project", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
        gitRoot: "/path/to/project",
      });

      repos.projectRepository.delete(created.id);

      const found = repos.projectRepository.findById(created.id);
      expect(found).toBeNull();
    });
  });
});
