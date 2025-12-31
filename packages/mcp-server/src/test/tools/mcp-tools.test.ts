/**
 * MCP Tool Integration Tests
 *
 * Tests MCP tool handlers by calling them directly (no AI involved).
 * Verifies that tool calls produce expected database state changes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import { createRepositories, createServices } from "../helpers.js";
import {
  SqliteIssueRepository,
  SqlitePlanRepository,
  SqliteTaskRepository,
  VersioningService,
  PlanningService,
  TaskManagementService,
  type IssueType,
  type IssuePriority,
  type IssueStatus,
  type TaskStatus,
  type PlanComplexity,
  type SnapshotType,
} from "@dev-workflow/core";

/**
 * Simulates MCP tool call results
 */
interface ToolResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Simulate create_issue tool
 */
function createIssueTool(
  issueRepository: SqliteIssueRepository,
  params: {
    title: string;
    description: string;
    type?: IssueType;
    priority?: IssuePriority;
    acceptanceCriteria?: string[];
  }
): ToolResult {
  const issue = issueRepository.create({
    title: params.title,
    description: params.description,
    type: params.type ?? "FEATURE",
    priority: params.priority ?? "MEDIUM",
    status: "OPEN",
    acceptanceCriteria: params.acceptanceCriteria ?? [],
    createdBy: "test",
  });

  return {
    success: true,
    issue: {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      type: issue.type,
      priority: issue.priority,
    },
  };
}

/**
 * Simulate get_issue tool
 */
function getIssueTool(
  issueRepository: SqliteIssueRepository,
  params: { id?: string; number?: number }
): ToolResult {
  const issue = params.id
    ? issueRepository.findById(params.id)
    : issueRepository.findByNumber(params.number!);

  if (!issue) {
    return { success: false, error: "Issue not found" };
  }

  return { success: true, issue };
}

/**
 * Simulate list_issues tool
 */
function listIssuesTool(
  issueRepository: SqliteIssueRepository,
  params: { status?: IssueStatus; type?: IssueType }
): ToolResult {
  const issues = issueRepository.findMany({
    status: params.status,
    type: params.type,
  });

  return { success: true, issues };
}

/**
 * Simulate generate_plan tool
 */
async function generatePlanTool(
  planningService: PlanningService,
  issueRepository: SqliteIssueRepository,
  params: {
    issueId?: string;
    issueNumber?: number;
    summary: string;
    approach: string;
    tasks: Array<{
      title: string;
      description: string;
      acceptanceCriteria: string[];
      estimatedMinutes?: number;
    }>;
    estimatedComplexity: PlanComplexity;
    preserveExistingTasks?: boolean;
  }
): Promise<ToolResult> {
  let resolvedIssueId = params.issueId;
  if (!resolvedIssueId && params.issueNumber) {
    const issue = issueRepository.findByNumber(params.issueNumber);
    if (!issue) {
      return { success: false, error: `Issue not found: #${params.issueNumber}` };
    }
    resolvedIssueId = issue.id;
  }

  const result = await planningService.generatePlan({
    issueId: resolvedIssueId!,
    summary: params.summary,
    approach: params.approach,
    tasks: params.tasks,
    estimatedComplexity: params.estimatedComplexity,
    generatedBy: "test",
    preserveExistingTasks: params.preserveExistingTasks ?? true,
  });

  return { success: true, ...result };
}

/**
 * Simulate update_task_status tool
 */
function updateTaskStatusTool(
  taskRepository: SqliteTaskRepository,
  params: { taskId: string; status: TaskStatus; notes?: string }
): ToolResult {
  try {
    const updatedTask = taskRepository.updateStatus(
      params.taskId,
      params.status,
      "test",
      params.notes
    );
    return { success: true, task: updatedTask };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Simulate add_manual_task tool
 */
function addManualTaskTool(
  taskManagementService: TaskManagementService,
  params: {
    issueNumber: number;
    title: string;
    description: string;
    acceptanceCriteria?: string[];
    estimatedMinutes?: number;
    insertAfterTaskId?: string;
  }
): ToolResult {
  try {
    const task = taskManagementService.addManualTask(params);
    return { success: true, task };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Simulate delete_task tool
 */
function deleteTaskTool(
  taskManagementService: TaskManagementService,
  params: { taskId: string }
): ToolResult {
  try {
    const task = taskManagementService.deleteTask(params.taskId, "test");
    return { success: true, task };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Simulate view_snapshot tool
 */
function viewSnapshotTool(
  versioningService: VersioningService,
  params: { issueNumber: number; version: number }
): ToolResult {
  try {
    const snapshotData = versioningService.viewSnapshot(
      params.issueNumber,
      params.version
    );
    return { success: true, ...snapshotData };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Simulate revert_to_snapshot tool
 */
function revertToSnapshotTool(
  versioningService: VersioningService,
  params: { issueNumber: number; version: number; notes?: string }
): ToolResult {
  try {
    const result = versioningService.revertToSnapshot(
      params.issueNumber,
      params.version,
      "test",
      params.notes
    );
    return { success: true, ...result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

describe("MCP Tool: create_issue", () => {
  let testDb: TestDatabase;
  let issueRepository: SqliteIssueRepository;

  beforeEach(() => {
    testDb = createTestDatabase();
    const repos = createRepositories(testDb.db);
    issueRepository = repos.issueRepository;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should create issue with minimal parameters", () => {
    const result = createIssueTool(issueRepository, {
      title: "Test Issue",
      description: "Test description",
    });

    expect(result.success).toBe(true);
    expect(result.issue).toBeDefined();

    const issue = result.issue as { id: string; number: number; title: string };
    expect(issue.title).toBe("Test Issue");
    expect(issue.number).toBe(1);

    // Verify in database
    const dbIssue = issueRepository.findByNumber(1);
    expect(dbIssue).toBeDefined();
    expect(dbIssue?.title).toBe("Test Issue");
  });

  it("should create issue with all parameters", () => {
    const result = createIssueTool(issueRepository, {
      title: "Full Issue",
      description: "Full description",
      type: "BUG",
      priority: "HIGH",
      acceptanceCriteria: ["AC1", "AC2"],
    });

    expect(result.success).toBe(true);

    const issue = result.issue as { id: string; type: string; priority: string };
    expect(issue.type).toBe("BUG");
    expect(issue.priority).toBe("HIGH");

    // Verify in database
    const dbIssue = issueRepository.findByNumber(1);
    expect(dbIssue?.acceptanceCriteria).toEqual(["AC1", "AC2"]);
  });

  it("should auto-increment issue numbers", () => {
    createIssueTool(issueRepository, {
      title: "Issue 1",
      description: "Desc 1",
    });
    createIssueTool(issueRepository, {
      title: "Issue 2",
      description: "Desc 2",
    });
    const result = createIssueTool(issueRepository, {
      title: "Issue 3",
      description: "Desc 3",
    });

    const issue = result.issue as { number: number };
    expect(issue.number).toBe(3);
  });
});

describe("MCP Tool: get_issue", () => {
  let testDb: TestDatabase;
  let issueRepository: SqliteIssueRepository;

  beforeEach(() => {
    testDb = createTestDatabase();
    const repos = createRepositories(testDb.db);
    issueRepository = repos.issueRepository;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should get issue by number", () => {
    createIssueTool(issueRepository, {
      title: "Test Issue",
      description: "Test description",
    });

    const result = getIssueTool(issueRepository, { number: 1 });

    expect(result.success).toBe(true);
    const issue = result.issue as { title: string };
    expect(issue.title).toBe("Test Issue");
  });

  it("should get issue by id", () => {
    const createResult = createIssueTool(issueRepository, {
      title: "Test Issue",
      description: "Test description",
    });
    const createdIssue = createResult.issue as { id: string };

    const result = getIssueTool(issueRepository, { id: createdIssue.id });

    expect(result.success).toBe(true);
  });

  it("should return error for non-existent issue", () => {
    const result = getIssueTool(issueRepository, { number: 99999 });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Issue not found");
  });
});

describe("MCP Tool: generate_plan", () => {
  let testDb: TestDatabase;
  let issueRepository: SqliteIssueRepository;
  let planRepository: SqlitePlanRepository;
  let taskRepository: SqliteTaskRepository;
  let planningService: PlanningService;

  beforeEach(() => {
    testDb = createTestDatabase();
    const repos = createRepositories(testDb.db);
    issueRepository = repos.issueRepository;
    planRepository = repos.planRepository;
    taskRepository = repos.taskRepository;
    const services = createServices(repos);
    planningService = services.planningService;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should generate plan with tasks", async () => {
    // Create an issue first
    createIssueTool(issueRepository, {
      title: "Test Issue",
      description: "Test description",
    });

    const result = await generatePlanTool(planningService, issueRepository, {
      issueNumber: 1,
      summary: "Test plan summary",
      approach: "Test approach",
      tasks: [
        { title: "Task 1", description: "Desc 1", acceptanceCriteria: [] },
        { title: "Task 2", description: "Desc 2", acceptanceCriteria: [] },
        { title: "Task 3", description: "Desc 3", acceptanceCriteria: [] },
      ],
      estimatedComplexity: "MEDIUM",
    });

    expect(result.success).toBe(true);

    // Verify plan in database
    const issue = issueRepository.findByNumber(1);
    const plan = planRepository.findByIssueId(issue!.id);
    expect(plan).toBeDefined();
    expect(plan?.summary).toBe("Test plan summary");

    // Verify tasks in database
    const tasks = taskRepository.findByPlanId(plan!.id);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]?.title).toBe("Task 1");
    expect(tasks[0]?.status).toBe("PENDING");
  });

  it("should return error for non-existent issue", async () => {
    const result = await generatePlanTool(planningService, issueRepository, {
      issueNumber: 99999,
      summary: "Test",
      approach: "Test",
      tasks: [{ title: "Task", description: "Desc", acceptanceCriteria: [] }],
      estimatedComplexity: "LOW",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Issue not found");
  });
});

describe("MCP Tool: update_task_status", () => {
  let testDb: TestDatabase;
  let issueRepository: SqliteIssueRepository;
  let taskRepository: SqliteTaskRepository;
  let planRepository: SqlitePlanRepository;
  let planningService: PlanningService;

  beforeEach(() => {
    testDb = createTestDatabase();
    const repos = createRepositories(testDb.db);
    issueRepository = repos.issueRepository;
    taskRepository = repos.taskRepository;
    planRepository = repos.planRepository;
    const services = createServices(repos);
    planningService = services.planningService;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should update task status to IN_PROGRESS", async () => {
    // Setup: create issue with plan and tasks
    createIssueTool(issueRepository, {
      title: "Test Issue",
      description: "Test description",
    });
    await generatePlanTool(planningService, issueRepository, {
      issueNumber: 1,
      summary: "Test",
      approach: "Test",
      tasks: [{ title: "Task 1", description: "Desc 1", acceptanceCriteria: [] }],
      estimatedComplexity: "LOW",
    });

    const issue = issueRepository.findByNumber(1);
    const plan = planRepository.findByIssueId(issue!.id);
    const tasks = taskRepository.findByPlanId(plan!.id);
    const taskId = tasks[0]!.id;

    // Update status
    const result = updateTaskStatusTool(taskRepository, {
      taskId,
      status: "IN_PROGRESS",
    });

    expect(result.success).toBe(true);

    // Verify in database
    const updatedTask = taskRepository.findById(taskId);
    expect(updatedTask?.status).toBe("IN_PROGRESS");
    expect(updatedTask?.startedAt).toBeDefined();
  });

  it("should update task status to COMPLETED", async () => {
    // Setup
    createIssueTool(issueRepository, {
      title: "Test Issue",
      description: "Test description",
    });
    await generatePlanTool(planningService, issueRepository, {
      issueNumber: 1,
      summary: "Test",
      approach: "Test",
      tasks: [{ title: "Task 1", description: "Desc 1", acceptanceCriteria: [] }],
      estimatedComplexity: "LOW",
    });

    const issue = issueRepository.findByNumber(1);
    const plan = planRepository.findByIssueId(issue!.id);
    const tasks = taskRepository.findByPlanId(plan!.id);
    const taskId = tasks[0]!.id;

    // Update to IN_PROGRESS then COMPLETED
    updateTaskStatusTool(taskRepository, { taskId, status: "IN_PROGRESS" });
    const result = updateTaskStatusTool(taskRepository, {
      taskId,
      status: "COMPLETED",
    });

    expect(result.success).toBe(true);

    // Verify in database
    const updatedTask = taskRepository.findById(taskId);
    expect(updatedTask?.status).toBe("COMPLETED");
    expect(updatedTask?.completedAt).toBeDefined();
  });
});

describe("MCP Tool: add_manual_task", () => {
  let testDb: TestDatabase;
  let issueRepository: SqliteIssueRepository;
  let taskRepository: SqliteTaskRepository;
  let planRepository: SqlitePlanRepository;
  let planningService: PlanningService;
  let taskManagementService: TaskManagementService;

  beforeEach(() => {
    testDb = createTestDatabase();
    const repos = createRepositories(testDb.db);
    issueRepository = repos.issueRepository;
    taskRepository = repos.taskRepository;
    planRepository = repos.planRepository;
    const services = createServices(repos);
    planningService = services.planningService;
    taskManagementService = services.taskManagementService;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should add manual task to existing plan", async () => {
    // Setup: create issue with plan
    createIssueTool(issueRepository, {
      title: "Test Issue",
      description: "Test description",
    });
    await generatePlanTool(planningService, issueRepository, {
      issueNumber: 1,
      summary: "Test",
      approach: "Test",
      tasks: [{ title: "Generated Task", description: "Generated desc", acceptanceCriteria: [] }],
      estimatedComplexity: "LOW",
    });

    // Add manual task
    const result = addManualTaskTool(taskManagementService, {
      issueNumber: 1,
      title: "Manual Task",
      description: "Added manually by user",
    });

    expect(result.success).toBe(true);

    // Verify task has source="manual"
    const task = result.task as { id: string; source: string };
    expect(task.source).toBe("manual");

    // Verify in database
    const issue = issueRepository.findByNumber(1);
    const plan = planRepository.findByIssueId(issue!.id);
    const tasks = taskRepository.findByPlanId(plan!.id);
    expect(tasks).toHaveLength(2);

    const manualTask = tasks.find((t) => t.source === "manual");
    expect(manualTask).toBeDefined();
    expect(manualTask?.title).toBe("Manual Task");
  });
});

describe("MCP Tool: delete_task", () => {
  let testDb: TestDatabase;
  let issueRepository: SqliteIssueRepository;
  let taskRepository: SqliteTaskRepository;
  let planRepository: SqlitePlanRepository;
  let planningService: PlanningService;
  let taskManagementService: TaskManagementService;

  beforeEach(() => {
    testDb = createTestDatabase();
    const repos = createRepositories(testDb.db);
    issueRepository = repos.issueRepository;
    taskRepository = repos.taskRepository;
    planRepository = repos.planRepository;
    const services = createServices(repos);
    planningService = services.planningService;
    taskManagementService = services.taskManagementService;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should soft delete a PENDING task", async () => {
    // Setup
    createIssueTool(issueRepository, {
      title: "Test Issue",
      description: "Test description",
    });
    await generatePlanTool(planningService, issueRepository, {
      issueNumber: 1,
      summary: "Test",
      approach: "Test",
      tasks: [{ title: "Task to Delete", description: "Will be deleted", acceptanceCriteria: [] }],
      estimatedComplexity: "LOW",
    });

    const issue = issueRepository.findByNumber(1);
    const plan = planRepository.findByIssueId(issue!.id);
    const tasks = taskRepository.findByPlanId(plan!.id);
    const taskId = tasks[0]!.id;

    // Delete task
    const result = deleteTaskTool(taskManagementService, { taskId });

    expect(result.success).toBe(true);

    // Verify soft delete
    const deletedTask = result.task as { isDeleted: boolean; deletedAt: string };
    expect(deletedTask.isDeleted).toBe(true);
    expect(deletedTask.deletedAt).toBeDefined();

    // Task should not appear in findByPlanId (excludes deleted)
    const remainingTasks = taskRepository.findByPlanId(plan!.id);
    expect(remainingTasks).toHaveLength(0);
  });

  it("should not delete IN_PROGRESS task", async () => {
    // Setup
    createIssueTool(issueRepository, {
      title: "Test Issue",
      description: "Test description",
    });
    await generatePlanTool(planningService, issueRepository, {
      issueNumber: 1,
      summary: "Test",
      approach: "Test",
      tasks: [{ title: "In Progress Task", description: "Working on it", acceptanceCriteria: [] }],
      estimatedComplexity: "LOW",
    });

    const issue = issueRepository.findByNumber(1);
    const plan = planRepository.findByIssueId(issue!.id);
    const tasks = taskRepository.findByPlanId(plan!.id);
    const taskId = tasks[0]!.id;

    // Start the task
    taskRepository.updateStatus(taskId, "IN_PROGRESS", "test");

    // Try to delete
    const result = deleteTaskTool(taskManagementService, { taskId });

    expect(result.success).toBe(false);
    expect(result.error).toContain("PENDING");
  });
});

describe("MCP Tool: view_snapshot", () => {
  let testDb: TestDatabase;
  let issueRepository: SqliteIssueRepository;
  let versioningService: VersioningService;

  beforeEach(() => {
    testDb = createTestDatabase();
    const repos = createRepositories(testDb.db);
    issueRepository = repos.issueRepository;
    const services = createServices(repos);
    versioningService = services.versioningService;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should view historical snapshot", () => {
    // Setup: create issue, update it to create snapshots
    createIssueTool(issueRepository, {
      title: "Original Title",
      description: "Original description",
    });

    const issue = issueRepository.findByNumber(1);

    // Create a snapshot (version 1) with original state
    const snapshotType: SnapshotType = "PLAN_REGENERATION";
    versioningService.createSnapshot(
      issue!.number,
      snapshotType,
      "test"
    );

    // Update the issue
    issueRepository.update(issue!.id, { title: "Updated Title" });

    // Create another snapshot (version 2)
    const updateSnapshotType: SnapshotType = "ISSUE_UPDATE";
    versioningService.createSnapshot(
      issue!.number,
      updateSnapshotType,
      "test"
    );

    // View version 1
    const result = viewSnapshotTool(versioningService, {
      issueNumber: 1,
      version: 1,
    });

    expect(result.success).toBe(true);
    const issueState = result.issue as { title: string };
    expect(issueState.title).toBe("Original Title");
  });

  it("should return error for non-existent version", () => {
    createIssueTool(issueRepository, {
      title: "Test Issue",
      description: "Test description",
    });

    const result = viewSnapshotTool(versioningService, {
      issueNumber: 1,
      version: 99,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

describe("MCP Tool: revert_to_snapshot", () => {
  let testDb: TestDatabase;
  let issueRepository: SqliteIssueRepository;
  let versioningService: VersioningService;

  beforeEach(() => {
    testDb = createTestDatabase();
    const repos = createRepositories(testDb.db);
    issueRepository = repos.issueRepository;
    const services = createServices(repos);
    versioningService = services.versioningService;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should revert issue to previous snapshot", () => {
    // Setup
    createIssueTool(issueRepository, {
      title: "Original Title",
      description: "Original description",
    });

    const issue = issueRepository.findByNumber(1);

    // Create snapshot v1
    const snapshotType: SnapshotType = "PLAN_REGENERATION";
    versioningService.createSnapshot(issue!.number, snapshotType, "test");

    // Update issue
    issueRepository.update(issue!.id, { title: "Changed Title" });

    // Verify current state is changed
    const currentIssue = issueRepository.findByNumber(1);
    expect(currentIssue?.title).toBe("Changed Title");

    // Revert to v1
    const result = revertToSnapshotTool(versioningService, {
      issueNumber: 1,
      version: 1,
      notes: "Reverting to original",
    });

    expect(result.success).toBe(true);

    // Verify issue reverted
    const revertedIssue = issueRepository.findByNumber(1);
    expect(revertedIssue?.title).toBe("Original Title");
  });
});

describe("MCP Tool: list_issues", () => {
  let testDb: TestDatabase;
  let issueRepository: SqliteIssueRepository;

  beforeEach(() => {
    testDb = createTestDatabase();
    const repos = createRepositories(testDb.db);
    issueRepository = repos.issueRepository;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should list all issues", () => {
    createIssueTool(issueRepository, { title: "Issue 1", description: "Desc 1" });
    createIssueTool(issueRepository, { title: "Issue 2", description: "Desc 2" });
    createIssueTool(issueRepository, { title: "Issue 3", description: "Desc 3" });

    const result = listIssuesTool(issueRepository, {});

    expect(result.success).toBe(true);
    const issues = result.issues as unknown[];
    expect(issues).toHaveLength(3);
  });

  it("should filter issues by status", () => {
    createIssueTool(issueRepository, { title: "Open Issue", description: "Open" });
    const createResult = createIssueTool(issueRepository, {
      title: "Closed Issue",
      description: "Closed",
    });
    const closedIssue = createResult.issue as { id: string };
    issueRepository.update(closedIssue.id, { status: "CLOSED" });

    const result = listIssuesTool(issueRepository, { status: "OPEN" });

    expect(result.success).toBe(true);
    const issues = result.issues as Array<{ title: string }>;
    expect(issues).toHaveLength(1);
    expect(issues[0]?.title).toBe("Open Issue");
  });

  it("should filter issues by type", () => {
    createIssueTool(issueRepository, {
      title: "Feature",
      description: "Feature desc",
      type: "FEATURE",
    });
    createIssueTool(issueRepository, {
      title: "Bug",
      description: "Bug desc",
      type: "BUG",
    });

    const result = listIssuesTool(issueRepository, { type: "BUG" });

    expect(result.success).toBe(true);
    const issues = result.issues as Array<{ title: string }>;
    expect(issues).toHaveLength(1);
    expect(issues[0]?.title).toBe("Bug");
  });
});
