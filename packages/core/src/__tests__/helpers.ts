/**
 * Test Helpers
 *
 * Utility functions for testing repositories, services, and MCP tools.
 */

import type {
  IssueRepository,
  Issue,
  IssueType,
  IssuePriority,
  IssueStatus,
} from "../domain/issue.js";
import type { PlanRepository, Plan, PlanComplexity } from "../domain/plan.js";
import type { TaskRepository, Task, TaskStatus, TaskSource } from "../domain/task.js";
import type { DbClient } from "../domain/db-client.js";
import type { DbSource } from "../domain/db-source.js";
import type { DrizzleDb } from "../domain/drizzle-db.js";
import type { TestDatabase } from "./setup.js";
import { DrizzleDbClient } from "../infrastructure/database/drizzle-db-client.js";
import { VersioningService } from "../application/versioning-service.js";
import { PlanningService } from "../application/planning-service.js";
import { TaskManagementService } from "../application/task-management-service.js";

/**
 * Create a DbClient scoped to a specific project from a test database
 *
 * Use this when you need to test with a different project ID than the
 * default one created by createTestDatabase().
 *
 * @param testDb - Test database from createTestDatabase()
 * @param projectId - Project ID to scope the new client to
 */
export function createClientForProject(testDb: TestDatabase, projectId: string): DbClient {
  const drizzleDb = testDb.db as unknown as DrizzleDb;
  return new DrizzleDbClient(drizzleDb, projectId);
}

/**
 * Get project-scoped repositories from a DbClient
 */
export function getRepositories(client: DbClient) {
  return {
    issueRepository: client.issues,
    planRepository: client.plans,
    taskRepository: client.tasks,
    snapshotRepository: client.snapshots,
    milestoneRepository: client.milestones,
    workerRepository: client.workers,
    dispatchQueueRepository: client.dispatchQueue,
    executionLogRepository: client.executionLogs,
  };
}

/**
 * Get global repositories from a DbSource
 */
export function getSourceRepositories(source: DbSource) {
  return {
    projectRepository: source.projects,
    typeRepository: source.types,
    globalSettingsRepository: source.globalSettings,
  };
}

/**
 * Create all services from a DbClient
 */
export function createServices(client: DbClient) {
  const versioningService = new VersioningService(client);
  const planningService = new PlanningService(client, versioningService);
  const taskManagementService = new TaskManagementService(client);

  return {
    versioningService,
    planningService,
    taskManagementService,
  };
}

/**
 * Factory for creating test issues
 */
export function createTestIssue(
  repo: IssueRepository,
  overrides: Partial<{
    title: string;
    description: string;
    type: IssueType;
    priority: IssuePriority;
    status: IssueStatus;
    acceptanceCriteria: string[];
  }> = {}
): Issue {
  return repo.create({
    title: overrides.title ?? "Test Issue",
    description: overrides.description ?? "Test description",
    type: overrides.type ?? "FEATURE",
    priority: overrides.priority ?? "MEDIUM",
    status: overrides.status ?? "OPEN",
    acceptanceCriteria: overrides.acceptanceCriteria ?? [],
    createdBy: "test",
  });
}

/**
 * Factory for creating test plans
 */
export function createTestPlan(
  repo: PlanRepository,
  issueId: string,
  overrides: Partial<{
    summary: string;
    approach: string;
    estimatedComplexity: PlanComplexity;
    generatedBy: string;
  }> = {}
): Plan {
  return repo.create({
    issueId,
    summary: overrides.summary ?? "Test plan summary",
    approach: overrides.approach ?? "Test approach",
    estimatedComplexity: overrides.estimatedComplexity ?? "MEDIUM",
    generatedBy: overrides.generatedBy ?? "test",
  });
}

/**
 * Factory for creating test tasks
 */
export function createTestTask(
  repo: TaskRepository,
  planId: string,
  overrides: Partial<{
    title: string;
    description: string;
    status: TaskStatus;
    type: IssueType;
    source: TaskSource;
    acceptanceCriteria: string[];
    estimatedMinutes: number;
  }> = {}
): Task {
  return repo.create({
    id: crypto.randomUUID(),
    planId,
    title: overrides.title ?? "Test Task",
    description: overrides.description ?? "Test task description",
    status: overrides.status ?? "BACKLOG",
    type: overrides.type ?? "TASK",
    source: overrides.source ?? "generated",
    acceptanceCriteria: overrides.acceptanceCriteria ?? [],
    estimatedMinutes: overrides.estimatedMinutes,
    isDeleted: false,
  });
}

/**
 * Transition a task through the valid state machine to COMPLETED
 *
 * Task transitions must follow the valid path:
 * BACKLOG/READY -> IN_PROGRESS -> COMPLETED
 */
export function completeTask(
  repo: TaskRepository,
  taskId: string,
  sessionId: string = "test-session",
  notes: string = "Completed"
): Task {
  const task = repo.findById(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  // Transition through valid states based on current status
  if (task.status === "BACKLOG" || task.status === "READY") {
    repo.updateStatus(taskId, "IN_PROGRESS", sessionId, "Started");
  }

  if (task.status === "IN_PROGRESS" || repo.findById(taskId)?.status === "IN_PROGRESS") {
    return repo.updateStatus(taskId, "COMPLETED", sessionId, notes);
  }

  // Already completed or in another state
  const currentTask = repo.findById(taskId);
  if (!currentTask) {
    throw new Error(`Task not found after update: ${taskId}`);
  }
  return currentTask;
}

/**
 * Create a full test scenario with issue, plan, and tasks
 */
export function createTestScenario(
  client: DbClient,
  options: {
    taskCount?: number;
    manualTaskCount?: number;
  } = {}
): {
  issue: Issue;
  plan: Plan;
  tasks: Task[];
  manualTasks: Task[];
} {
  const { taskCount = 3, manualTaskCount = 0 } = options;

  // Create issue
  const issue = createTestIssue(client.issues);

  // Create plan
  const plan = createTestPlan(client.plans, issue.id);

  // Create generated tasks
  const tasks: Task[] = [];
  for (let i = 0; i < taskCount; i++) {
    tasks.push(
      createTestTask(client.tasks, plan.id, {
        title: `Task ${i + 1}`,
        description: `Description for task ${i + 1}`,
        source: "generated",
      })
    );
  }

  // Create manual tasks
  const manualTasks: Task[] = [];
  for (let i = 0; i < manualTaskCount; i++) {
    manualTasks.push(
      createTestTask(client.tasks, plan.id, {
        title: `Manual Task ${i + 1}`,
        description: `Description for manual task ${i + 1}`,
        source: "manual",
      })
    );
  }

  return { issue, plan, tasks, manualTasks };
}
