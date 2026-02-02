/**
 * MCP Tool Integration Tests
 *
 * Tests MCP tool handlers by calling them directly (no AI involved).
 * Verifies that tool calls produce expected database state changes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { createTestDatabase, type TestDatabase } from "../../test/setup.js";
import { createServices } from "../../test/helpers.js";
import {
  VersioningService,
  PlanningService,
  TaskManagementService,
  TaskSessionService,
  type DbClient,
  type IssueType,
  type IssuePriority,
  type IssueStatus,
  type TaskStatus,
  type PlanComplexity,
  type SnapshotType,
} from "@dev-workflow/tracking";

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
async function createIssueTool(
  client: DbClient,
  params: {
    title: string;
    description: string;
    type?: IssueType;
    priority?: IssuePriority;
    acceptanceCriteria?: string[];
  }
): Promise<ToolResult> {
  const issue = await Effect.runPromise(
    client.issues.create({
      title: params.title,
      description: params.description,
      type: params.type ?? "FEATURE",
      priority: params.priority ?? "MEDIUM",
      status: "OPEN",
      acceptanceCriteria: params.acceptanceCriteria ?? [],
      createdBy: "test",
    })
  );

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
async function getIssueTool(
  client: DbClient,
  params: { id?: string; number?: number }
): Promise<ToolResult> {
  const issue = params.id
    ? await Effect.runPromise(client.issues.findById(params.id))
    : await Effect.runPromise(client.issues.findByNumber(params.number!));

  if (!issue) {
    return { success: false, error: "Issue not found" };
  }

  return { success: true, issue };
}

/**
 * Simulate list_issues tool
 */
async function listIssuesTool(
  client: DbClient,
  params: { status?: IssueStatus; type?: IssueType }
): Promise<ToolResult> {
  const issues = await Effect.runPromise(
    client.issues.findMany({
      status: params.status,
      type: params.type,
    })
  );

  return { success: true, issues };
}

/**
 * Simulate generate_plan tool
 */
async function generatePlanTool(
  planningService: PlanningService,
  client: DbClient,
  params: {
    issueId?: string;
    issueNumber?: number;
    summary: string;
    approach: string;
    tasks: Array<{
      id: string;
      title: string;
      description: string;
      acceptanceCriteria: string[];
      estimatedMinutes?: number;
    }>;
    estimatedComplexity: PlanComplexity;
  }
): Promise<ToolResult> {
  let resolvedIssueId = params.issueId;
  if (!resolvedIssueId && params.issueNumber) {
    const issue = await Effect.runPromise(client.issues.findByNumber(params.issueNumber));
    if (!issue) {
      return { success: false, error: `Issue not found: #${params.issueNumber}` };
    }
    resolvedIssueId = issue.id;
  }

  const result = await Effect.runPromise(
    planningService.generatePlan({
      issueId: resolvedIssueId!,
      summary: params.summary,
      approach: params.approach,
      tasks: params.tasks,
      estimatedComplexity: params.estimatedComplexity,
      generatedBy: "test",
    })
  );

  return { success: true, ...result };
}

/**
 * Simulate update_task_status tool
 */
async function updateTaskStatusTool(
  client: DbClient,
  params: { taskId: string; status: TaskStatus; notes?: string }
): Promise<ToolResult> {
  try {
    const updatedTask = await Effect.runPromise(
      client.tasks.updateStatus(params.taskId, params.status, "test", params.notes)
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
 * Simulate delete_task tool
 */
async function deleteTaskTool(
  taskManagementService: TaskManagementService,
  params: { taskId: string }
): Promise<ToolResult> {
  try {
    const task = await Effect.runPromise(taskManagementService.deleteTask(params.taskId, "test"));
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
async function viewSnapshotTool(
  versioningService: VersioningService,
  params: { issueNumber: number; version: number }
): Promise<ToolResult> {
  try {
    const snapshotData = await Effect.runPromise(
      versioningService.viewSnapshot(params.issueNumber, params.version)
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
async function revertToSnapshotTool(
  versioningService: VersioningService,
  params: { issueNumber: number; version: number; notes?: string }
): Promise<ToolResult> {
  try {
    const result = await Effect.runPromise(
      versioningService.revertToSnapshot(params.issueNumber, params.version, "test", params.notes)
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

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should create issue with minimal parameters", async () => {
    const result = await createIssueTool(testDb.client, {
      title: "Test Issue",
      description: "Test description",
    });

    expect(result.success).toBe(true);
    expect(result.issue).toBeDefined();

    const issue = result.issue as { id: string; number: number; title: string };
    expect(issue.title).toBe("Test Issue");
    expect(issue.number).toBe(1);

    // Verify in database
    const dbIssue = await Effect.runPromise(testDb.client.issues.findByNumber(1));
    expect(dbIssue).toBeDefined();
    expect(dbIssue?.title).toBe("Test Issue");
  });

  it("should create issue with all parameters", async () => {
    const result = await createIssueTool(testDb.client, {
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
    const dbIssue = await Effect.runPromise(testDb.client.issues.findByNumber(1));
    expect(dbIssue?.acceptanceCriteria).toEqual(["AC1", "AC2"]);
  });

  it("should auto-increment issue numbers", async () => {
    await createIssueTool(testDb.client, {
      title: "Issue 1",
      description: "Desc 1",
    });
    await createIssueTool(testDb.client, {
      title: "Issue 2",
      description: "Desc 2",
    });
    const result = await createIssueTool(testDb.client, {
      title: "Issue 3",
      description: "Desc 3",
    });

    const issue = result.issue as { number: number };
    expect(issue.number).toBe(3);
  });
});

describe("MCP Tool: get_issue", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should get issue by number", async () => {
    await createIssueTool(testDb.client, {
      title: "Test Issue",
      description: "Test description",
    });

    const result = await getIssueTool(testDb.client, { number: 1 });

    expect(result.success).toBe(true);
    const issue = result.issue as { title: string };
    expect(issue.title).toBe("Test Issue");
  });

  it("should get issue by id", async () => {
    const createResult = await createIssueTool(testDb.client, {
      title: "Test Issue",
      description: "Test description",
    });
    const createdIssue = createResult.issue as { id: string };

    const result = await getIssueTool(testDb.client, { id: createdIssue.id });

    expect(result.success).toBe(true);
  });

  it("should return error for non-existent issue", async () => {
    const result = await getIssueTool(testDb.client, { number: 99999 });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Issue not found");
  });
});

describe("MCP Tool: generate_plan", () => {
  let testDb: TestDatabase;
  let planningService: PlanningService;

  beforeEach(() => {
    testDb = createTestDatabase();
    const services = createServices(testDb.client);
    planningService = services.planningService;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should generate plan with tasks", async () => {
    // Create an issue first
    await createIssueTool(testDb.client, {
      title: "Test Issue",
      description: "Test description",
    });

    const result = await generatePlanTool(planningService, testDb.client, {
      issueNumber: 1,
      summary: "Test plan summary",
      approach: "Test approach",
      tasks: [
        { id: crypto.randomUUID(), title: "Task 1", description: "Desc 1", acceptanceCriteria: [] },
        { id: crypto.randomUUID(), title: "Task 2", description: "Desc 2", acceptanceCriteria: [] },
        { id: crypto.randomUUID(), title: "Task 3", description: "Desc 3", acceptanceCriteria: [] },
      ],
      estimatedComplexity: "MEDIUM",
    });

    expect(result.success).toBe(true);

    // Verify plan in database
    const issue = await Effect.runPromise(testDb.client.issues.findByNumber(1));
    const plan = await Effect.runPromise(testDb.client.plans.findByIssueId(issue!.id));
    expect(plan).toBeDefined();
    expect(plan?.summary).toBe("Test plan summary");

    // Verify tasks in database (tasks start in PLANNED until issue is activated)
    const tasks = await Effect.runPromise(testDb.client.tasks.findByPlanId(plan!.id));
    expect(tasks).toHaveLength(3);
    expect(tasks[0]?.title).toBe("Task 1");
    expect(tasks[0]?.status).toBe("PLANNED");
  });

  it("should return error for non-existent issue", async () => {
    const result = await generatePlanTool(planningService, testDb.client, {
      issueNumber: 99999,
      summary: "Test",
      approach: "Test",
      tasks: [
        { id: crypto.randomUUID(), title: "Task", description: "Desc", acceptanceCriteria: [] },
      ],
      estimatedComplexity: "LOW",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Issue not found");
  });
});

describe("MCP Tool: update_task_status", () => {
  let testDb: TestDatabase;
  let planningService: PlanningService;

  beforeEach(() => {
    testDb = createTestDatabase();
    const services = createServices(testDb.client);
    planningService = services.planningService;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should update task status to IN_PROGRESS", async () => {
    // Setup: create issue with plan and tasks
    await createIssueTool(testDb.client, {
      title: "Test Issue",
      description: "Test description",
    });
    await generatePlanTool(planningService, testDb.client, {
      issueNumber: 1,
      summary: "Test",
      approach: "Test",
      tasks: [
        { id: crypto.randomUUID(), title: "Task 1", description: "Desc 1", acceptanceCriteria: [] },
      ],
      estimatedComplexity: "LOW",
    });

    const issue = await Effect.runPromise(testDb.client.issues.findByNumber(1));
    const plan = await Effect.runPromise(testDb.client.plans.findByIssueId(issue!.id));
    const tasks = await Effect.runPromise(testDb.client.tasks.findByPlanId(plan!.id));
    const taskId = tasks[0]!.id;

    // Tasks start in PLANNED, move to BACKLOG first to simulate activation
    await Effect.runPromise(testDb.client.tasks.updateStatus(taskId, "BACKLOG"));

    // Update status
    const result = await updateTaskStatusTool(testDb.client, {
      taskId,
      status: "IN_PROGRESS",
    });

    expect(result.success).toBe(true);

    // Verify in database
    const updatedTask = await Effect.runPromise(testDb.client.tasks.findById(taskId));
    expect(updatedTask?.status).toBe("IN_PROGRESS");
    expect(updatedTask?.startedAt).toBeDefined();
  });

  it("should update task status to COMPLETED", async () => {
    // Setup
    await createIssueTool(testDb.client, {
      title: "Test Issue",
      description: "Test description",
    });
    await generatePlanTool(planningService, testDb.client, {
      issueNumber: 1,
      summary: "Test",
      approach: "Test",
      tasks: [
        { id: crypto.randomUUID(), title: "Task 1", description: "Desc 1", acceptanceCriteria: [] },
      ],
      estimatedComplexity: "LOW",
    });

    const issue = await Effect.runPromise(testDb.client.issues.findByNumber(1));
    const plan = await Effect.runPromise(testDb.client.plans.findByIssueId(issue!.id));
    const tasks = await Effect.runPromise(testDb.client.tasks.findByPlanId(plan!.id));
    const taskId = tasks[0]!.id;

    // Tasks start in PLANNED, move through BACKLOG to IN_PROGRESS
    await Effect.runPromise(testDb.client.tasks.updateStatus(taskId, "BACKLOG"));
    await updateTaskStatusTool(testDb.client, { taskId, status: "IN_PROGRESS" });
    const result = await updateTaskStatusTool(testDb.client, {
      taskId,
      status: "COMPLETED",
    });

    expect(result.success).toBe(true);

    // Verify in database
    const updatedTask = await Effect.runPromise(testDb.client.tasks.findById(taskId));
    expect(updatedTask?.status).toBe("COMPLETED");
    expect(updatedTask?.completedAt).toBeDefined();
  });
});

describe("MCP Tool: delete_task", () => {
  let testDb: TestDatabase;
  let planningService: PlanningService;
  let taskManagementService: TaskManagementService;

  beforeEach(() => {
    testDb = createTestDatabase();
    const services = createServices(testDb.client);
    planningService = services.planningService;
    taskManagementService = services.taskManagementService;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should soft delete a PLANNED task", async () => {
    // Setup: Create issue with plan and task (tasks start in PLANNED status)
    await createIssueTool(testDb.client, {
      title: "Test Issue",
      description: "Test description",
    });
    await generatePlanTool(planningService, testDb.client, {
      issueNumber: 1,
      summary: "Test",
      approach: "Test",
      tasks: [
        {
          id: crypto.randomUUID(),
          title: "Task to Delete",
          description: "Will be deleted",
          acceptanceCriteria: [],
        },
      ],
      estimatedComplexity: "LOW",
    });

    const issue = await Effect.runPromise(testDb.client.issues.findByNumber(1));
    const plan = await Effect.runPromise(testDb.client.plans.findByIssueId(issue!.id));
    const tasks = await Effect.runPromise(testDb.client.tasks.findByPlanId(plan!.id));
    const taskId = tasks[0]!.id;

    // Tasks start in PLANNED status - they can be deleted in this state
    expect(tasks[0]!.status).toBe("PLANNED");

    // Delete task
    const result = await deleteTaskTool(taskManagementService, { taskId });

    expect(result.success).toBe(true);

    // Verify soft delete
    const deletedTask = result.task as { isDeleted: boolean; deletedAt: string };
    expect(deletedTask.isDeleted).toBe(true);
    expect(deletedTask.deletedAt).toBeDefined();

    // Task should not appear in findByPlanId (excludes deleted)
    const remainingTasks = await Effect.runPromise(testDb.client.tasks.findByPlanId(plan!.id));
    expect(remainingTasks).toHaveLength(0);
  });

  it("should not delete BACKLOG task (immutable after plan activation)", async () => {
    // Setup
    await createIssueTool(testDb.client, {
      title: "Test Issue",
      description: "Test description",
    });
    await generatePlanTool(planningService, testDb.client, {
      issueNumber: 1,
      summary: "Test",
      approach: "Test",
      tasks: [
        {
          id: crypto.randomUUID(),
          title: "BACKLOG Task",
          description: "Cannot be deleted after activation",
          acceptanceCriteria: [],
        },
      ],
      estimatedComplexity: "LOW",
    });

    const issue = await Effect.runPromise(testDb.client.issues.findByNumber(1));
    const plan = await Effect.runPromise(testDb.client.plans.findByIssueId(issue!.id));
    const tasks = await Effect.runPromise(testDb.client.tasks.findByPlanId(plan!.id));
    const taskId = tasks[0]!.id;

    // Simulate plan activation: move task from PLANNED to BACKLOG
    await Effect.runPromise(testDb.client.tasks.updateStatus(taskId, "BACKLOG"));

    // Try to delete - should fail because task is past PLANNED status
    const result = await deleteTaskTool(taskManagementService, { taskId });

    expect(result.success).toBe(false);
    expect(result.error).toContain("PLANNED status");
    expect(result.error).toContain("abandon_task");
  });

  it("should not delete IN_PROGRESS task", async () => {
    // Setup
    await createIssueTool(testDb.client, {
      title: "Test Issue",
      description: "Test description",
    });
    await generatePlanTool(planningService, testDb.client, {
      issueNumber: 1,
      summary: "Test",
      approach: "Test",
      tasks: [
        {
          id: crypto.randomUUID(),
          title: "In Progress Task",
          description: "Working on it",
          acceptanceCriteria: [],
        },
      ],
      estimatedComplexity: "LOW",
    });

    const issue = await Effect.runPromise(testDb.client.issues.findByNumber(1));
    const plan = await Effect.runPromise(testDb.client.plans.findByIssueId(issue!.id));
    const tasks = await Effect.runPromise(testDb.client.tasks.findByPlanId(plan!.id));
    const taskId = tasks[0]!.id;

    // Tasks start in PLANNED, move through BACKLOG to IN_PROGRESS
    await Effect.runPromise(testDb.client.tasks.updateStatus(taskId, "BACKLOG"));
    await Effect.runPromise(testDb.client.tasks.updateStatus(taskId, "IN_PROGRESS", "test"));

    // Try to delete
    const result = await deleteTaskTool(taskManagementService, { taskId });

    expect(result.success).toBe(false);
    expect(result.error).toContain("PLANNED status");
    expect(result.error).toContain("abandon_task");
  });
});

describe("MCP Tool: view_snapshot", () => {
  let testDb: TestDatabase;
  let versioningService: VersioningService;

  beforeEach(() => {
    testDb = createTestDatabase();
    const services = createServices(testDb.client);
    versioningService = services.versioningService;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should view historical snapshot", async () => {
    // Setup: create issue, update it to create snapshots
    await createIssueTool(testDb.client, {
      title: "Original Title",
      description: "Original description",
    });

    const issue = await Effect.runPromise(testDb.client.issues.findByNumber(1));

    // Create a snapshot (version 1) with original state
    const snapshotType: SnapshotType = "PLAN_REGENERATION";
    await Effect.runPromise(versioningService.createSnapshot(issue!.number, snapshotType, "test"));

    // Update the issue
    await Effect.runPromise(testDb.client.issues.update(issue!.id, { title: "Updated Title" }));

    // Create another snapshot (version 2)
    const updateSnapshotType: SnapshotType = "ISSUE_UPDATE";
    await Effect.runPromise(
      versioningService.createSnapshot(issue!.number, updateSnapshotType, "test")
    );

    // View version 1
    const result = await viewSnapshotTool(versioningService, {
      issueNumber: 1,
      version: 1,
    });

    expect(result.success).toBe(true);
    const issueState = result.issue as { title: string };
    expect(issueState.title).toBe("Original Title");
  });

  it("should return error for non-existent version", async () => {
    await createIssueTool(testDb.client, {
      title: "Test Issue",
      description: "Test description",
    });

    const result = await viewSnapshotTool(versioningService, {
      issueNumber: 1,
      version: 99,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

describe("MCP Tool: revert_to_snapshot", () => {
  let testDb: TestDatabase;
  let versioningService: VersioningService;

  beforeEach(() => {
    testDb = createTestDatabase();
    const services = createServices(testDb.client);
    versioningService = services.versioningService;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should revert issue to previous snapshot", async () => {
    // Setup
    await createIssueTool(testDb.client, {
      title: "Original Title",
      description: "Original description",
    });

    const issue = await Effect.runPromise(testDb.client.issues.findByNumber(1));

    // Create snapshot v1
    const snapshotType: SnapshotType = "PLAN_REGENERATION";
    await Effect.runPromise(versioningService.createSnapshot(issue!.number, snapshotType, "test"));

    // Update issue
    await Effect.runPromise(testDb.client.issues.update(issue!.id, { title: "Changed Title" }));

    // Verify current state is changed
    const currentIssue = await Effect.runPromise(testDb.client.issues.findByNumber(1));
    expect(currentIssue?.title).toBe("Changed Title");

    // Revert to v1
    const result = await revertToSnapshotTool(versioningService, {
      issueNumber: 1,
      version: 1,
      notes: "Reverting to original",
    });

    expect(result.success).toBe(true);

    // Verify issue reverted
    const revertedIssue = await Effect.runPromise(testDb.client.issues.findByNumber(1));
    expect(revertedIssue?.title).toBe("Original Title");
  });
});

describe("MCP Tool: list_issues", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should list all issues", async () => {
    await createIssueTool(testDb.client, { title: "Issue 1", description: "Desc 1" });
    await createIssueTool(testDb.client, { title: "Issue 2", description: "Desc 2" });
    await createIssueTool(testDb.client, { title: "Issue 3", description: "Desc 3" });

    const result = await listIssuesTool(testDb.client, {});

    expect(result.success).toBe(true);
    const issues = result.issues as unknown[];
    expect(issues).toHaveLength(3);
  });

  it("should filter issues by status", async () => {
    await createIssueTool(testDb.client, { title: "Open Issue", description: "Open" });
    const createResult = await createIssueTool(testDb.client, {
      title: "Closed Issue",
      description: "Closed",
    });
    const closedIssue = createResult.issue as { id: string };
    await Effect.runPromise(testDb.client.issues.update(closedIssue.id, { status: "CLOSED" }));

    const result = await listIssuesTool(testDb.client, { status: "OPEN" });

    expect(result.success).toBe(true);
    const issues = result.issues as Array<{ title: string }>;
    expect(issues).toHaveLength(1);
    expect(issues[0]?.title).toBe("Open Issue");
  });

  it("should filter issues by type", async () => {
    await createIssueTool(testDb.client, {
      title: "Feature",
      description: "Feature desc",
      type: "FEATURE",
    });
    await createIssueTool(testDb.client, {
      title: "Bug",
      description: "Bug desc",
      type: "BUG",
    });

    const result = await listIssuesTool(testDb.client, { type: "BUG" });

    expect(result.success).toBe(true);
    const issues = result.issues as Array<{ title: string }>;
    expect(issues).toHaveLength(1);
    expect(issues[0]?.title).toBe("Bug");
  });
});

describe("MCP Tool: list_available_tasks", () => {
  let testDb: TestDatabase;
  let planningService: PlanningService;
  let taskSessionService: TaskSessionService;

  beforeEach(() => {
    testDb = createTestDatabase();
    const services = createServices(testDb.client);
    planningService = services.planningService;
    taskSessionService = new TaskSessionService(testDb.client);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should return BACKLOG/READY tasks from OPEN issues", async () => {
    // Create an open issue with a plan and task
    await createIssueTool(testDb.client, {
      title: "Open Issue",
      description: "This issue is open",
    });
    await generatePlanTool(planningService, testDb.client, {
      issueNumber: 1,
      summary: "Test plan",
      approach: "Test approach",
      tasks: [
        { id: crypto.randomUUID(), title: "Task 1", description: "Desc", acceptanceCriteria: [] },
      ],
      estimatedComplexity: "LOW",
    });

    const issue = await Effect.runPromise(testDb.client.issues.findByNumber(1));
    const plan = await Effect.runPromise(testDb.client.plans.findByIssueId(issue!.id));
    const tasks = await Effect.runPromise(testDb.client.tasks.findByPlanId(plan!.id));
    const task = tasks[0]!;

    // Tasks are created in PLANNED status, move to BACKLOG to simulate activation
    await Effect.runPromise(testDb.client.tasks.updateStatus(task.id, "BACKLOG"));

    // Check task availability
    const isAvailable = await Effect.runPromise(taskSessionService.isTaskAvailable(task.id));

    expect(isAvailable).toBe(true);
  });

  it("should NOT return tasks from CLOSED issues", async () => {
    // Create an issue with a plan and task
    await createIssueTool(testDb.client, {
      title: "Will Be Closed",
      description: "This issue will be closed",
    });
    await generatePlanTool(planningService, testDb.client, {
      issueNumber: 1,
      summary: "Test plan",
      approach: "Test approach",
      tasks: [
        { id: crypto.randomUUID(), title: "Task 1", description: "Desc", acceptanceCriteria: [] },
      ],
      estimatedComplexity: "LOW",
    });

    const issue = await Effect.runPromise(testDb.client.issues.findByNumber(1));
    const plan = await Effect.runPromise(testDb.client.plans.findByIssueId(issue!.id));
    const tasks = await Effect.runPromise(testDb.client.tasks.findByPlanId(plan!.id));
    const task = tasks[0]!;

    // Tasks are created in PLANNED status, move to BACKLOG to simulate activation
    await Effect.runPromise(testDb.client.tasks.updateStatus(task.id, "BACKLOG"));

    // Close the issue (task remains BACKLOG)
    await Effect.runPromise(testDb.client.issues.update(issue!.id, { status: "CLOSED" }));

    // Check task availability - should be false because issue is closed
    const isAvailable = await Effect.runPromise(taskSessionService.isTaskAvailable(task.id));

    expect(isAvailable).toBe(false);
  });

  it("should return tasks from reopened issues", async () => {
    // Create an issue, close it, then reopen it
    await createIssueTool(testDb.client, {
      title: "Reopened Issue",
      description: "This issue was reopened",
    });
    await generatePlanTool(planningService, testDb.client, {
      issueNumber: 1,
      summary: "Test plan",
      approach: "Test approach",
      tasks: [
        { id: crypto.randomUUID(), title: "Task 1", description: "Desc", acceptanceCriteria: [] },
      ],
      estimatedComplexity: "LOW",
    });

    const issue = await Effect.runPromise(testDb.client.issues.findByNumber(1));
    const plan = await Effect.runPromise(testDb.client.plans.findByIssueId(issue!.id));
    const tasks = await Effect.runPromise(testDb.client.tasks.findByPlanId(plan!.id));
    const task = tasks[0]!;

    // Tasks are created in PLANNED status, move to BACKLOG to simulate activation
    await Effect.runPromise(testDb.client.tasks.updateStatus(task.id, "BACKLOG"));

    // Close the issue
    await Effect.runPromise(testDb.client.issues.update(issue!.id, { status: "CLOSED" }));
    expect(await Effect.runPromise(taskSessionService.isTaskAvailable(task.id))).toBe(false);

    // Reopen the issue
    await Effect.runPromise(testDb.client.issues.update(issue!.id, { status: "OPEN" }));
    expect(await Effect.runPromise(taskSessionService.isTaskAvailable(task.id))).toBe(true);
  });
});

/**
 * Simulate delete_issue tool
 *
 * Simplified version that only does the status check and soft delete.
 * The real handler also handles GitHub sync and worktree cleanup.
 */
async function deleteIssueTool(
  client: DbClient,
  params: { issueNumber: number }
): Promise<ToolResult> {
  const issue = await Effect.runPromise(client.issues.findByNumber(params.issueNumber));
  if (!issue) {
    return { success: false, error: `Issue not found: #${params.issueNumber}` };
  }

  // Only allow deletion of PLANNED issues (matches handleDeleteIssue behavior)
  if (issue.status !== "PLANNED") {
    return {
      success: false,
      error:
        `Cannot delete issue #${issue.number} with status ${issue.status}. ` +
        `Issues can only be deleted while in PLANNED status. ` +
        `Use close_issue instead to close the issue.`,
    };
  }

  try {
    const deleted = await Effect.runPromise(client.issues.delete(issue.id, "test"));
    return { success: true, issue: deleted };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

describe("MCP Tool: delete_issue", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("should soft delete a PLANNED issue", async () => {
    // Create a PLANNED issue
    const createResult = await Effect.runPromise(
      testDb.client.issues.create({
        title: "Planned Issue",
        description: "This issue is still being planned",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "PLANNED",
        acceptanceCriteria: [],
        createdBy: "test",
      })
    );

    // Delete the issue
    const result = await deleteIssueTool(testDb.client, { issueNumber: createResult.number });

    expect(result.success).toBe(true);
    const deleted = result.issue as { isDeleted: boolean; deletedAt: string };
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.deletedAt).toBeDefined();
  });

  it("should not delete OPEN issue (immutable after planning phase)", async () => {
    // Create an issue in OPEN status
    await createIssueTool(testDb.client, {
      title: "Open Issue",
      description: "This issue is open for work",
    });

    // Try to delete - should fail because issue is past PLANNED status
    const result = await deleteIssueTool(testDb.client, { issueNumber: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toContain("PLANNED status");
    expect(result.error).toContain("close_issue");
  });

  it("should not delete IN_PROGRESS issue", async () => {
    // Create an issue and set to IN_PROGRESS
    const createResult = await createIssueTool(testDb.client, {
      title: "In Progress Issue",
      description: "Work is underway",
    });
    const issue = createResult.issue as { id: string };
    await Effect.runPromise(testDb.client.issues.update(issue.id, { status: "IN_PROGRESS" }));

    // Try to delete - should fail
    const result = await deleteIssueTool(testDb.client, { issueNumber: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toContain("PLANNED status");
    expect(result.error).toContain("close_issue");
  });

  it("should not delete CLOSED issue", async () => {
    // Create an issue and close it
    const createResult = await createIssueTool(testDb.client, {
      title: "Closed Issue",
      description: "This issue was completed",
    });
    const issue = createResult.issue as { id: string };
    await Effect.runPromise(testDb.client.issues.update(issue.id, { status: "CLOSED" }));

    // Try to delete - should fail
    const result = await deleteIssueTool(testDb.client, { issueNumber: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toContain("PLANNED status");
    expect(result.error).toContain("close_issue");
  });
});
