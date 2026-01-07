/**
 * Repository Provider Compatibility Tests
 *
 * These tests verify that repositories work correctly with databases
 * created via DataSourceFactory, ensuring the abstraction layer functions
 * as expected.
 *
 * Architecture Note:
 * SQLite and PostgreSQL Drizzle APIs are fundamentally incompatible:
 * - SQLite uses synchronous methods: .get(), .all(), .run()
 * - PostgreSQL uses async methods with different signatures
 *
 * Therefore, repositories must be provider-specific. The abstraction we
 * provide is at the DataSource level (SqliteDataSource, NeonDataSource),
 * not at the repository level. Each DataSource provides a properly typed
 * Drizzle database instance for use with provider-specific repositories.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { DataSourceFactory } from "../data-source-factory.js";
import { SqliteIssueRepository } from "../../repositories/issue-repository.js";
import { SqlitePlanRepository } from "../../repositories/plan-repository.js";
import { SqliteTaskRepository } from "../../repositories/task-repository.js";
import { SqliteProjectRepository } from "../../repositories/project-repository.js";
import { SqliteMilestoneRepository } from "../../repositories/milestone-repository.js";

// Migrations path: from src/infrastructure/database/__tests__/ up 4 levels to drizzle/
const MIGRATIONS_FOLDER = join(__dirname, "../../../../drizzle");

describe("Repository Provider Compatibility", () => {
  let testDbPath: string;
  let dataSource: Awaited<ReturnType<typeof DataSourceFactory.createSqlite>> | null = null;
  const TEST_PROJECT_ID = "test-project-compat";

  beforeEach(() => {
    // Create a unique temp directory for each test
    const testDir = join(tmpdir(), "dev-workflow-compat-test", `test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");
  });

  afterEach(() => {
    // Close data source
    if (dataSource) {
      dataSource.close();
      dataSource = null;
    }

    // Clean up files
    const testDir = join(testDbPath, "..");
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("SqliteDataSource from DataSourceFactory", () => {
    it("should create a working database via factory", async () => {
      dataSource = await DataSourceFactory.createSqlite(testDbPath);
      migrate(dataSource.getDb(), { migrationsFolder: MIGRATIONS_FOLDER });

      expect(dataSource).toBeDefined();
      expect(dataSource.providerId).toBe("sqlite");
      expect(dataSource.getDb()).toBeDefined();
    });

    it("should work with SqliteIssueRepository", async () => {
      dataSource = await DataSourceFactory.createSqlite(testDbPath);
      migrate(dataSource.getDb(), { migrationsFolder: MIGRATIONS_FOLDER });
      const issueRepo = new SqliteIssueRepository(dataSource.getDb(), TEST_PROJECT_ID);

      // Create an issue
      const issue = issueRepo.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "OPEN",
        acceptanceCriteria: ["Criterion 1"],
        createdBy: "test",
      });

      expect(issue.id).toBeDefined();
      expect(issue.title).toBe("Test Issue");
      expect(issue.number).toBe(1);

      // Retrieve the issue
      const found = issueRepo.findById(issue.id);
      expect(found).toBeDefined();
      expect(found?.title).toBe("Test Issue");
    });

    it("should work with SqlitePlanRepository", async () => {
      dataSource = await DataSourceFactory.createSqlite(testDbPath);
      migrate(dataSource.getDb(), { migrationsFolder: MIGRATIONS_FOLDER });
      const issueRepo = new SqliteIssueRepository(dataSource.getDb(), TEST_PROJECT_ID);
      const planRepo = new SqlitePlanRepository(dataSource.getDb());

      // Create an issue first
      const issue = issueRepo.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "OPEN",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      // Create a plan
      const plan = planRepo.create({
        issueId: issue.id,
        summary: "Test plan summary",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      expect(plan.id).toBeDefined();
      expect(plan.summary).toBe("Test plan summary");

      // Retrieve the plan
      const found = planRepo.findByIssueId(issue.id);
      expect(found).toBeDefined();
      expect(found?.summary).toBe("Test plan summary");
    });

    it("should work with SqliteTaskRepository", async () => {
      dataSource = await DataSourceFactory.createSqlite(testDbPath);
      migrate(dataSource.getDb(), { migrationsFolder: MIGRATIONS_FOLDER });
      const issueRepo = new SqliteIssueRepository(dataSource.getDb(), TEST_PROJECT_ID);
      const planRepo = new SqlitePlanRepository(dataSource.getDb());
      const taskRepo = new SqliteTaskRepository(dataSource.getDb());

      // Create issue and plan first
      const issue = issueRepo.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "OPEN",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      const plan = planRepo.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "LOW",
        generatedBy: "test",
      });

      // Create a task
      const task = taskRepo.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Test Task",
        description: "Test task description",
        status: "BACKLOG",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      expect(task.id).toBeDefined();
      expect(task.title).toBe("Test Task");

      // Retrieve the task
      const found = taskRepo.findById(task.id);
      expect(found).toBeDefined();
      expect(found?.title).toBe("Test Task");
    });

    it("should work with SqliteProjectRepository", async () => {
      dataSource = await DataSourceFactory.createSqlite(testDbPath);
      migrate(dataSource.getDb(), { migrationsFolder: MIGRATIONS_FOLDER });
      const projectRepo = new SqliteProjectRepository(dataSource.getDb());

      // Create a project
      const project = await projectRepo.create({
        gitRootHash: "abc123def456",
        name: "Test Project",
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe("Test Project");
      expect(project.slug).toBe("test-project-abc123");

      // Retrieve the project
      const found = await projectRepo.findById(project.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe("Test Project");
    });

    it("should work with SqliteMilestoneRepository", async () => {
      dataSource = await DataSourceFactory.createSqlite(testDbPath);
      migrate(dataSource.getDb(), { migrationsFolder: MIGRATIONS_FOLDER });
      const milestoneRepo = new SqliteMilestoneRepository(dataSource.getDb(), TEST_PROJECT_ID);

      // Create a milestone
      const milestone = milestoneRepo.create({
        title: "M1",
        description: "Test milestone",
        startDate: "2025-01-01",
        endDate: "2025-03-31",
        status: "PLANNED",
      });

      expect(milestone.id).toBeDefined();
      expect(milestone.title).toBe("M1");
      expect(milestone.number).toBe(1);

      // Retrieve the milestone
      const found = milestoneRepo.findById(milestone.id);
      expect(found).toBeDefined();
      expect(found?.title).toBe("M1");
    });

    it("should support full issue lifecycle with factory-created database", async () => {
      dataSource = await DataSourceFactory.createSqlite(testDbPath);
      migrate(dataSource.getDb(), { migrationsFolder: MIGRATIONS_FOLDER });
      const issueRepo = new SqliteIssueRepository(dataSource.getDb(), TEST_PROJECT_ID);
      const planRepo = new SqlitePlanRepository(dataSource.getDb());
      const taskRepo = new SqliteTaskRepository(dataSource.getDb());

      // Create issue
      const issue = issueRepo.create({
        title: "Feature: User Authentication",
        description: "Implement OAuth2 login",
        type: "FEATURE",
        priority: "HIGH",
        status: "OPEN",
        acceptanceCriteria: ["Users can log in via OAuth2"],
        createdBy: "test",
      });

      // Create plan
      const plan = planRepo.create({
        issueId: issue.id,
        summary: "Implement OAuth2 flow",
        approach: "Use passport.js with Google provider",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      // Create tasks
      const task1 = taskRepo.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Set up passport.js",
        description: "Install and configure passport",
        status: "BACKLOG",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      taskRepo.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Implement callback handler",
        description: "Handle OAuth callback",
        status: "BACKLOG",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Verify relationships
      const foundPlan = planRepo.findByIssueId(issue.id);
      expect(foundPlan).toBeDefined();

      const tasks = taskRepo.findByPlanId(plan.id);
      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.title)).toContain("Set up passport.js");
      expect(tasks.map((t) => t.title)).toContain("Implement callback handler");

      // Update task status
      taskRepo.updateStatus(task1.id, "IN_PROGRESS", "test-session", "Starting work");
      const updatedTask = taskRepo.findById(task1.id);
      expect(updatedTask?.status).toBe("IN_PROGRESS");
    });
  });

  describe("DataSourceFactory provider detection", () => {
    it("should detect sqlite for file paths", () => {
      expect(DataSourceFactory.isRemote("/path/to/db.sqlite")).toBe(false);
      expect(DataSourceFactory.isRemote("./relative/path.db")).toBe(false);
      expect(DataSourceFactory.isRemote("workflow.db")).toBe(false);
    });

    it("should detect neon for postgresql URLs", () => {
      expect(DataSourceFactory.isRemote("postgresql://user:pass@host/db")).toBe(true);
      expect(DataSourceFactory.isRemote("postgres://user:pass@host/db")).toBe(true);
    });
  });
});
