import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/setup.js";
import { createRepositories, createTestIssue, createTestPlan, createTestTask } from "../../../__tests__/helpers.js";
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
      });

      expect(project.id).toBeDefined();
      expect(project.gitRootHash).toBe("abc123def456");
      expect(project.name).toBe("test-project");
      expect(project.githubSync).toBeNull();
      expect(project.isArchived).toBe(false);
      expect(project.archivedAt).toBeNull();
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
        githubSync,
      });

      expect(project.githubSync).toEqual(githubSync);
    });

    it("should enforce unique gitRootHash", () => {
      repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "project-1",
      });

      expect(() =>
        repos.projectRepository.create({
          gitRootHash: "abc123def456", // Same hash
          name: "project-2",
        })
      ).toThrow();
    });
  });

  describe("findById", () => {
    it("should find a project by ID", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
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
      repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      const found = repos.projectRepository.findByGitRootHash("abc123def456");

      expect(found).toBeDefined();
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

    it("should return all non-archived projects by default", () => {
      repos.projectRepository.create({
        gitRootHash: "hash1",
        name: "project-1",
      });

      const project2 = repos.projectRepository.create({
        gitRootHash: "hash2",
        name: "project-2",
      });

      // Archive one project
      repos.projectRepository.archive(project2.id);

      // Default: excludes archived
      const projects = repos.projectRepository.findAll();
      expect(projects).toHaveLength(1);
      expect(projects[0]?.name).toBe("project-1");
    });

    it("should return all projects including archived when includeArchived=true", () => {
      repos.projectRepository.create({
        gitRootHash: "hash1",
        name: "project-1",
      });

      const project2 = repos.projectRepository.create({
        gitRootHash: "hash2",
        name: "project-2",
      });

      // Archive one project
      repos.projectRepository.archive(project2.id);

      // includeArchived=true: includes all
      const projects = repos.projectRepository.findAll(true);
      expect(projects).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("should update project name", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "old-name",
      });

      const updated = repos.projectRepository.update(created.id, {
        name: "new-name",
      });

      expect(updated.name).toBe("new-name");
      expect(updated.gitRootHash).toBe("abc123def456"); // Should not change
    });

    it("should update GitHub sync config", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
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
        githubSync,
      });

      const updated = repos.projectRepository.update(created.id, { githubSync: null });

      expect(updated.githubSync).toBeNull();
    });

    it("should preserve unchanged fields", () => {
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
        githubSync,
      });

      const updated = repos.projectRepository.update(created.id, {
        name: "new-name",
      });

      expect(updated.githubSync).toEqual(githubSync); // Preserved
    });
  });

  describe("delete", () => {
    it("should delete a project", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      repos.projectRepository.delete(created.id);

      const found = repos.projectRepository.findById(created.id);
      expect(found).toBeNull();
    });
  });

  describe("archive", () => {
    it("should archive a project", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      expect(created.isArchived).toBe(false);

      const archived = repos.projectRepository.archive(created.id);

      expect(archived.isArchived).toBe(true);
      expect(archived.archivedAt).toBeDefined();
      expect(archived.id).toBe(created.id);
    });

    it("should update updatedAt when archiving", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      const archived = repos.projectRepository.archive(created.id);

      // Verify updatedAt is set and is >= createdAt (may be same millisecond)
      expect(archived.updatedAt).toBeDefined();
      expect(new Date(archived.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(created.updatedAt).getTime()
      );
    });
  });

  describe("unarchive", () => {
    it("should unarchive a project", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      const archived = repos.projectRepository.archive(created.id);
      expect(archived.isArchived).toBe(true);

      const unarchived = repos.projectRepository.unarchive(created.id);

      expect(unarchived.isArchived).toBe(false);
      expect(unarchived.archivedAt).toBeNull();
    });

    it("should update updatedAt when unarchiving", () => {
      const created = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      const archived = repos.projectRepository.archive(created.id);
      const unarchived = repos.projectRepository.unarchive(created.id);

      // Verify updatedAt is set and is >= archivedAt (may be same millisecond)
      expect(unarchived.updatedAt).toBeDefined();
      expect(new Date(unarchived.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(archived.updatedAt).getTime()
      );
    });
  });

  describe("hardDelete", () => {
    it("should delete a project and all its data", () => {
      // Create a project first
      const project = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      // Create repos scoped to this project's ID
      const projectRepos = createRepositories(testDb.db, project.id);

      // Create an issue using helper (scoped to project)
      const issue = createTestIssue(projectRepos.issueRepository, {
        title: "Test Issue",
        description: "Test description",
      });

      // Create a plan using helper
      const plan = createTestPlan(projectRepos.planRepository, issue.id, {
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "LOW",
      });

      // Create a task using helper
      createTestTask(projectRepos.taskRepository, plan.id, {
        title: "Test task",
        description: "Test task description",
      });

      // Verify data exists
      expect(projectRepos.issueRepository.findById(issue.id)).not.toBeNull();
      expect(projectRepos.planRepository.findByIssueId(issue.id)).not.toBeNull();

      // Hard delete the project
      repos.projectRepository.hardDelete(project.id);

      // Verify project is gone
      expect(repos.projectRepository.findById(project.id)).toBeNull();

      // Verify issues are gone (and by cascade, plans and tasks)
      expect(projectRepos.issueRepository.findById(issue.id)).toBeNull();
    });

    it("should delete milestones associated with the project", () => {
      // Create a project first
      const project = repos.projectRepository.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      // Create repos scoped to this project's ID
      const projectRepos = createRepositories(testDb.db, project.id);

      // Create a milestone (scoped to project)
      const milestone = projectRepos.milestoneRepository.create({
        title: "M1",
        description: "Test milestone",
        startDate: "2025-01-01",
        endDate: "2025-03-31",
        status: "PLANNED",
      });

      // Hard delete the project
      repos.projectRepository.hardDelete(project.id);

      // Verify milestone is gone
      expect(projectRepos.milestoneRepository.findById(milestone.id)).toBeNull();
    });
  });
});
