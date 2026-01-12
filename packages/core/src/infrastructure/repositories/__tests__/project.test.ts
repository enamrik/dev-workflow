import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/setup.js";
import {
  getRepositories,
  createTestIssue,
  createTestPlan,
  createTestTask,
  createClientForProject,
} from "../../../__tests__/helpers.js";
import type { GitHubIssueSyncConfig } from "../../database/schema.js";

describe("SqliteProjectRepository", () => {
  let testDb: ReturnType<typeof createTestDatabase>;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("create", () => {
    it("should create a project with all fields", async () => {
      const project = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      expect(project.id).toBeDefined();
      expect(project.gitRootHash).toBe("abc123def456");
      expect(project.name).toBe("test-project");
      expect(project.slug).toBe("test-project-abc123");
      expect(project.githubSync).toBeNull();
      expect(project.isArchived).toBe(false);
      expect(project.archivedAt).toBeNull();
      expect(project.createdAt).toBeDefined();
      expect(project.updatedAt).toBeDefined();
    });

    it("should generate a URL-safe slug from name and hash", async () => {
      const project = await testDb.source.projects.create({
        gitRootHash: "b9bccf123456",
        name: "Dev Workflow",
      });

      // Slug should be lowercased, spaces replaced with dashes
      expect(project.slug).toBe("dev-workflow-b9bccf");
    });

    it("should handle special characters in project name for slug", async () => {
      const project = await testDb.source.projects.create({
        gitRootHash: "xyz789abc123",
        name: "My.Project_Name",
      });

      // Special characters replaced with dashes
      expect(project.slug).toBe("my-project-name-xyz789");
    });

    it("should create a project with GitHub sync config", async () => {
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

      const project = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
        githubSync,
      });

      expect(project.githubSync).toEqual(githubSync);
    });

    it("should enforce unique gitRootHash", async () => {
      await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "project-1",
      });

      await expect(
        testDb.source.projects.create({
          gitRootHash: "abc123def456", // Same hash
          name: "project-2",
        })
      ).rejects.toThrow();
    });
  });

  describe("findById", () => {
    it("should find a project by ID", async () => {
      const created = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      const found = await testDb.source.projects.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe(created.name);
    });

    it("should return null for non-existent ID", async () => {
      const found = await testDb.source.projects.findById("non-existent-id");
      expect(found).toBeNull();
    });
  });

  describe("findByGitRootHash", () => {
    it("should find a project by git root hash", async () => {
      await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      const found = await testDb.source.projects.findByGitRootHash("abc123def456");

      expect(found).toBeDefined();
      expect(found?.gitRootHash).toBe("abc123def456");
    });

    it("should return null for non-existent hash", async () => {
      const found = await testDb.source.projects.findByGitRootHash("non-existent-hash");
      expect(found).toBeNull();
    });
  });

  describe("findBySlug", () => {
    it("should find a project by slug", async () => {
      const created = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      const found = await testDb.source.projects.findBySlug("test-project-abc123");

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.slug).toBe("test-project-abc123");
    });

    it("should return null for non-existent slug", async () => {
      const found = await testDb.source.projects.findBySlug("non-existent-slug");
      expect(found).toBeNull();
    });
  });

  describe("findAll", () => {
    it("should return empty array when no projects exist", async () => {
      const projects = await testDb.source.projects.findAll();
      expect(projects).toHaveLength(0);
    });

    it("should return all non-archived projects by default", async () => {
      await testDb.source.projects.create({
        gitRootHash: "hash1",
        name: "project-1",
      });

      const project2 = await testDb.source.projects.create({
        gitRootHash: "hash2",
        name: "project-2",
      });

      // Archive one project
      await testDb.source.projects.archive(project2.id);

      // Default: excludes archived
      const projects = await testDb.source.projects.findAll();
      expect(projects).toHaveLength(1);
      expect(projects[0]?.name).toBe("project-1");
    });

    it("should return all projects including archived when includeArchived=true", async () => {
      await testDb.source.projects.create({
        gitRootHash: "hash1",
        name: "project-1",
      });

      const project2 = await testDb.source.projects.create({
        gitRootHash: "hash2",
        name: "project-2",
      });

      // Archive one project
      await testDb.source.projects.archive(project2.id);

      // includeArchived=true: includes all
      const projects = await testDb.source.projects.findAll(true);
      expect(projects).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("should update project name", async () => {
      const created = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "old-name",
      });

      const updated = await testDb.source.projects.update(created.id, {
        name: "new-name",
      });

      expect(updated.name).toBe("new-name");
      expect(updated.gitRootHash).toBe("abc123def456"); // Should not change
    });

    it("should update GitHub sync config", async () => {
      const created = await testDb.source.projects.create({
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

      const updated = await testDb.source.projects.update(created.id, { githubSync });

      expect(updated.githubSync).toEqual(githubSync);
    });

    it("should clear GitHub sync config", async () => {
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

      const created = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
        githubSync,
      });

      const updated = await testDb.source.projects.update(created.id, { githubSync: null });

      expect(updated.githubSync).toBeNull();
    });

    it("should preserve unchanged fields", async () => {
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

      const created = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
        githubSync,
      });

      const updated = await testDb.source.projects.update(created.id, {
        name: "new-name",
      });

      expect(updated.githubSync).toEqual(githubSync); // Preserved
    });
  });

  describe("delete", () => {
    it("should delete a project", async () => {
      const created = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      await testDb.source.projects.delete(created.id);

      const found = await testDb.source.projects.findById(created.id);
      expect(found).toBeNull();
    });
  });

  describe("archive", () => {
    it("should archive a project", async () => {
      const created = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      expect(created.isArchived).toBe(false);

      const archived = await testDb.source.projects.archive(created.id);

      expect(archived.isArchived).toBe(true);
      expect(archived.archivedAt).toBeDefined();
      expect(archived.id).toBe(created.id);
    });

    it("should update updatedAt when archiving", async () => {
      const created = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      const archived = await testDb.source.projects.archive(created.id);

      // Verify updatedAt is set and is >= createdAt (may be same millisecond)
      expect(archived.updatedAt).toBeDefined();
      expect(new Date(archived.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(created.updatedAt).getTime()
      );
    });
  });

  describe("unarchive", () => {
    it("should unarchive a project", async () => {
      const created = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      const archived = await testDb.source.projects.archive(created.id);
      expect(archived.isArchived).toBe(true);

      const unarchived = await testDb.source.projects.unarchive(created.id);

      expect(unarchived.isArchived).toBe(false);
      expect(unarchived.archivedAt).toBeNull();
    });

    it("should update updatedAt when unarchiving", async () => {
      const created = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      const archived = await testDb.source.projects.archive(created.id);
      const unarchived = await testDb.source.projects.unarchive(created.id);

      // Verify updatedAt is set and is >= archivedAt (may be same millisecond)
      expect(unarchived.updatedAt).toBeDefined();
      expect(new Date(unarchived.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(archived.updatedAt).getTime()
      );
    });
  });

  describe("hardDelete", () => {
    it("should delete a project and all its data", async () => {
      // Create a project first
      const project = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      // Create a client scoped to this project's ID
      const projectClient = createClientForProject(testDb, project.id);
      const projectRepos = getRepositories(projectClient);

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
      await testDb.source.projects.hardDelete(project.id);

      // Verify project is gone
      expect(await testDb.source.projects.findById(project.id)).toBeNull();

      // Verify issues are gone (and by cascade, plans and tasks)
      expect(projectRepos.issueRepository.findById(issue.id)).toBeNull();
    });

    it("should delete milestones associated with the project", async () => {
      // Create a project first
      const project = await testDb.source.projects.create({
        gitRootHash: "abc123def456",
        name: "test-project",
      });

      // Create a client scoped to this project's ID
      const projectClient = createClientForProject(testDb, project.id);
      const projectRepos = getRepositories(projectClient);

      // Create a milestone (scoped to project)
      const milestone = projectRepos.milestoneRepository.create({
        title: "M1",
        description: "Test milestone",
        startDate: "2025-01-01",
        endDate: "2025-03-31",
        status: "PLANNED",
      });

      // Hard delete the project
      await testDb.source.projects.hardDelete(project.id);

      // Verify milestone is gone
      expect(projectRepos.milestoneRepository.findById(milestone.id)).toBeNull();
    });
  });
});
