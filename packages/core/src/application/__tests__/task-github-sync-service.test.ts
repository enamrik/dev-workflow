/**
 * TaskGitHubSyncService Tests
 *
 * Tests task-level GitHub issue synchronization including:
 * - Column moves on status changes (PR_REVIEW -> In Review, COMPLETED -> Done)
 * - Issue close on task completion
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../__tests__/setup.js";
import { createRepositories } from "../../__tests__/helpers.js";
import { MockGitHubCLI } from "../../__tests__/mocks/mock-github-cli.js";
import { MockFileSystem } from "../../__tests__/mocks/mock-file-system.js";
import { TaskGitHubSyncService } from "../task-github-sync-service.js";
import {
  TemplateService,
  type TemplateServiceConfig,
} from "../../infrastructure/templates/template-service.js";
import type { Task } from "../../domain/task.js";

describe("TaskGitHubSyncService", () => {
  let testDb: TestDatabase;
  let repos: ReturnType<typeof createRepositories>;
  let mockGitHubCLI: MockGitHubCLI;
  let testProjectId: string;
  let service: TaskGitHubSyncService;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);
    mockGitHubCLI = new MockGitHubCLI();

    // Create a project with GitHub sync enabled (including projectId for column moves)
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

    service = new TaskGitHubSyncService(
      repos.taskRepository,
      repos.issueRepository,
      repos.planRepository,
      mockGitHubCLI,
      repos.projectRepository,
      testProjectId
    );
  });

  describe("syncTaskStatus", () => {
    let testTask: Task;

    beforeEach(() => {
      // Create issue and plan
      const issue = repos.issueRepository.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "OPEN",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      // Create task with GitHub sync (including projectItemId)
      testTask = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Test Task",
        description: "Test description",
        status: "IN_PROGRESS",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Set up GitHub sync with projectItemId
      repos.taskRepository.updateGitHubSync(testTask.id, {
        githubIssueNumber: 42,
        githubUrl: "https://github.com/test/repo/issues/42",
        githubNodeId: "I_test_42",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: "PVTI_test_item_123",
      });
    });

    it("should move to Ready column when status changes to READY", async () => {
      // Act
      await service.syncTaskStatus(testTask.id, "READY");

      // Assert - verify the run method was called to update the project item field
      const runCalls = mockGitHubCLI.getCallsTo("run");

      // Should have 2 calls: 1 to get project fields, 1 to update the field
      expect(runCalls.length).toBeGreaterThanOrEqual(2);

      // Find the update mutation call
      const updateCall = runCalls.find((call) => {
        const args = call.args[0] as string[];
        return args.some((arg) => arg.includes("updateProjectV2ItemFieldValue"));
      });

      expect(updateCall).toBeDefined();

      // Verify the call includes the correct item ID
      const updateArgs = updateCall!.args[0] as string[];
      expect(updateArgs.some((arg) => arg.includes("PVTI_test_item_123"))).toBe(true);

      // Verify the call includes the "Ready" option ID
      expect(updateArgs.some((arg) => arg.includes("opt_ready"))).toBe(true);
    });

    it("should move to In Review column when status changes to PR_REVIEW", async () => {
      // Act
      await service.syncTaskStatus(testTask.id, "PR_REVIEW");

      // Assert - verify the run method was called to update the project item field
      const runCalls = mockGitHubCLI.getCallsTo("run");

      // Should have 2 calls: 1 to get project fields, 1 to update the field
      expect(runCalls.length).toBeGreaterThanOrEqual(2);

      // Find the update mutation call
      const updateCall = runCalls.find((call) => {
        const args = call.args[0] as string[];
        return args.some((arg) => arg.includes("updateProjectV2ItemFieldValue"));
      });

      expect(updateCall).toBeDefined();

      // Verify the call includes the correct item ID
      const updateArgs = updateCall!.args[0] as string[];
      expect(updateArgs.some((arg) => arg.includes("PVTI_test_item_123"))).toBe(true);

      // Verify the call includes the "In Review" option ID
      expect(updateArgs.some((arg) => arg.includes("opt_in_review"))).toBe(true);
    });

    it("should move to Done column and close issue when status changes to COMPLETED", async () => {
      // Act
      await service.syncTaskStatus(testTask.id, "COMPLETED");

      // Assert - verify closeIssue was called
      const closeIssueCalls = mockGitHubCLI.getCallsTo("closeIssue");
      expect(closeIssueCalls).toHaveLength(1);
      expect(closeIssueCalls[0].args[0]).toBe(42);

      // Assert - verify the run method was called to update the project item field
      const runCalls = mockGitHubCLI.getCallsTo("run");

      // Find the update mutation call
      const updateCall = runCalls.find((call) => {
        const args = call.args[0] as string[];
        return args.some((arg) => arg.includes("updateProjectV2ItemFieldValue"));
      });

      expect(updateCall).toBeDefined();

      // Verify the call includes the "Done" option ID
      const updateArgs = updateCall!.args[0] as string[];
      expect(updateArgs.some((arg) => arg.includes("opt_done"))).toBe(true);
    });

    it("should update lastSyncedAt after successful sync", async () => {
      // Arrange
      const beforeSync = new Date();

      // Act
      await service.syncTaskStatus(testTask.id, "PR_REVIEW");

      // Assert
      const updatedTask = repos.taskRepository.findById(testTask.id);
      expect(updatedTask?.githubSync?.lastSyncedAt).toBeDefined();

      const syncedAt = new Date(updatedTask!.githubSync!.lastSyncedAt!);
      expect(syncedAt.getTime()).toBeGreaterThanOrEqual(beforeSync.getTime());
    });

    it("should not call moveToColumn if projectItemId is not set", async () => {
      // Arrange - clear projectItemId
      repos.taskRepository.updateGitHubSync(testTask.id, {
        githubIssueNumber: 42,
        githubUrl: "https://github.com/test/repo/issues/42",
        githubNodeId: "I_test_42",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: null,
      });

      // Act
      await service.syncTaskStatus(testTask.id, "PR_REVIEW");

      // Assert - should NOT have any updateProjectV2ItemFieldValue calls
      const runCalls = mockGitHubCLI.getCallsTo("run");
      const updateCall = runCalls.find((call) => {
        const args = call.args[0] as string[];
        return args.some((arg) => arg.includes("updateProjectV2ItemFieldValue"));
      });

      expect(updateCall).toBeUndefined();
    });

    it("should not call moveToColumn if project has no projectId configured", async () => {
      // Arrange - update project to have no projectId
      repos.projectRepository.update(testProjectId, {
        githubSync: {
          enabled: true,
          // No projectId!
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

      // Act
      await service.syncTaskStatus(testTask.id, "PR_REVIEW");

      // Assert - should NOT have any updateProjectV2ItemFieldValue calls
      const runCalls = mockGitHubCLI.getCallsTo("run");
      const updateCall = runCalls.find((call) => {
        const args = call.args[0] as string[];
        return args.some((arg) => arg.includes("updateProjectV2ItemFieldValue"));
      });

      expect(updateCall).toBeUndefined();
    });

    it("should record error in lastSyncError if column move fails", async () => {
      // Arrange - configure mock to fail on run
      mockGitHubCLI.setConfig({
        errors: {
          run: new Error("GraphQL mutation failed"),
        },
      });

      // Act
      await service.syncTaskStatus(testTask.id, "PR_REVIEW");

      // Assert
      const updatedTask = repos.taskRepository.findById(testTask.id);
      expect(updatedTask?.githubSync?.lastSyncError).toContain(
        "Failed to move project item to In Review"
      );
    });
  });

  describe("custom column mapping", () => {
    let testTask: Task;

    beforeEach(() => {
      // Create issue and plan
      const issue = repos.issueRepository.create({
        title: "Test Issue for Mapping",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "OPEN",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      testTask = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Test Task for Mapping",
        description: "Test description",
        status: "IN_PROGRESS",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      repos.taskRepository.updateGitHubSync(testTask.id, {
        githubIssueNumber: 99,
        githubUrl: "https://github.com/test/repo/issues/99",
        githubNodeId: "I_test_99",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: "PVTI_test_item_mapping",
      });
    });

    it("should use custom column mapping when configured", async () => {
      // Arrange - configure custom column mapping with a custom column name
      // Configure mock to include the custom column in available options
      mockGitHubCLI.setConfig({
        projectStatusField: {
          fieldId: "PVTSSF_test_status",
          options: [
            { id: "opt_backlog", name: "Backlog" },
            { id: "opt_ready", name: "Ready" },
            { id: "opt_in_progress", name: "In Progress" },
            { id: "opt_code_review", name: "Code Review" }, // Custom name
            { id: "opt_done", name: "Done" },
          ],
        },
      });

      repos.projectRepository.update(testProjectId, {
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
          columnMapping: {
            PR_REVIEW: "Code Review", // Custom column name instead of default "In Review"
          },
        },
      });

      // Act
      await service.syncTaskStatus(testTask.id, "PR_REVIEW");

      // Assert
      const runCalls = mockGitHubCLI.getCallsTo("run");
      const updateCall = runCalls.find((call) => {
        const args = call.args[0] as string[];
        return args.some((arg) => arg.includes("updateProjectV2ItemFieldValue"));
      });

      expect(updateCall).toBeDefined();
      const updateArgs = updateCall!.args[0] as string[];
      // Should use the custom "Code Review" option ID
      expect(updateArgs.some((arg) => arg.includes("opt_code_review"))).toBe(true);
    });

    it("should use default mapping for unmapped statuses when custom mapping is partial", async () => {
      // Arrange - configure partial custom column mapping
      repos.projectRepository.update(testProjectId, {
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
          columnMapping: {
            PR_REVIEW: "Code Review", // Only PR_REVIEW is customized
            // IN_PROGRESS, BACKLOG, READY, etc. use defaults
          },
        },
      });

      // Act - sync to IN_PROGRESS which uses default mapping
      await service.syncTaskStatus(testTask.id, "READY");

      // Assert
      const runCalls = mockGitHubCLI.getCallsTo("run");
      const updateCall = runCalls.find((call) => {
        const args = call.args[0] as string[];
        return args.some((arg) => arg.includes("updateProjectV2ItemFieldValue"));
      });

      expect(updateCall).toBeDefined();
      const updateArgs = updateCall!.args[0] as string[];
      // Should use the default "Ready" option ID (not customized)
      expect(updateArgs.some((arg) => arg.includes("opt_ready"))).toBe(true);
    });

    it("should record error if custom column name does not exist in project", async () => {
      // Arrange - configure custom column mapping with non-existent column
      repos.projectRepository.update(testProjectId, {
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
          columnMapping: {
            PR_REVIEW: "NonExistent Column", // This doesn't exist in mock options
          },
        },
      });

      // Act
      await service.syncTaskStatus(testTask.id, "PR_REVIEW");

      // Assert - should record error about missing column
      const updatedTask = repos.taskRepository.findById(testTask.id);
      expect(updatedTask?.githubSync?.lastSyncError).toContain(
        'Could not find "NonExistent Column" option'
      );
    });
  });

  describe("activatePlannedTasks for imported issues", () => {
    it("should link single task directly to parent GitHub issue for imported issues with 1 task", async () => {
      // Arrange - create an imported issue with 1 task
      const issue = repos.issueRepository.create({
        title: "Imported Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "PLANNED",
        acceptanceCriteria: [],
        createdBy: "test",
        sourceGitHubIssueNumber: 42, // This marks it as imported
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Single Task",
        description: "Only one task",
        status: "PLANNED",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Set up the parent GitHub issue in the mock
      mockGitHubCLI.setIssues([
        {
          number: 42,
          url: "https://github.com/test/repo/issues/42",
          nodeId: "I_parent_42",
          title: "Parent Issue",
          body: "Parent body",
          state: "OPEN",
          labels: [],
        },
      ]);

      // Act
      const result = await service.activatePlannedTasks(issue.id);

      // Assert
      expect(result.success).toBe(true);
      expect(result.tasksActivated).toHaveLength(1);
      expect(result.tasksActivated[0].githubIssueNumber).toBe(42); // Linked to parent

      // Verify NO new issue was created (only getIssue was called)
      const createIssueCalls = mockGitHubCLI.getCallsTo("createIssue");
      expect(createIssueCalls).toHaveLength(0);

      // Verify getIssue was called to fetch parent
      const getIssueCalls = mockGitHubCLI.getCallsTo("getIssue");
      expect(getIssueCalls.some((c) => c.args[0] === 42)).toBe(true);
    });

    it("should create sub-issues for imported issues with multiple tasks", async () => {
      // Arrange - create an imported issue with 2 tasks
      const issue = repos.issueRepository.create({
        title: "Imported Issue with Multiple Tasks",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "PLANNED",
        acceptanceCriteria: [],
        createdBy: "test",
        sourceGitHubIssueNumber: 100, // This marks it as imported
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Task 1",
        description: "First task",
        status: "PLANNED",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Task 2",
        description: "Second task",
        status: "PLANNED",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Set up the parent GitHub issue in the mock
      mockGitHubCLI.setIssues([
        {
          number: 100,
          url: "https://github.com/test/repo/issues/100",
          nodeId: "I_parent_100",
          title: "Parent Issue",
          body: "Parent body",
          state: "OPEN",
          labels: [],
        },
      ]);

      // Act
      const result = await service.activatePlannedTasks(issue.id);

      // Assert
      expect(result.success).toBe(true);
      expect(result.tasksActivated).toHaveLength(2);

      // Verify new issues were created (2 sub-issues)
      const createIssueCalls = mockGitHubCLI.getCallsTo("createIssue");
      expect(createIssueCalls).toHaveLength(2);

      // Verify linkSubIssue was called for each task
      const linkSubIssueCalls = mockGitHubCLI.getCallsTo("linkSubIssue");
      expect(linkSubIssueCalls).toHaveLength(2);

      // Verify both calls link to parent issue 100
      for (const call of linkSubIssueCalls) {
        expect(call.args[0]).toBe(100); // Parent issue number
      }
    });

    it("should create regular GitHub issues for non-imported issues", async () => {
      // Arrange - create a normal (non-imported) issue
      const issue = repos.issueRepository.create({
        title: "Normal Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "PLANNED",
        acceptanceCriteria: [],
        createdBy: "test",
        // No sourceGitHubIssueNumber - this is a normal issue
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Task 1",
        description: "First task",
        status: "PLANNED",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Task 2",
        description: "Second task",
        status: "PLANNED",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Act
      const result = await service.activatePlannedTasks(issue.id);

      // Assert
      expect(result.success).toBe(true);
      expect(result.tasksActivated).toHaveLength(2);

      // Verify new issues were created (2 independent issues)
      const createIssueCalls = mockGitHubCLI.getCallsTo("createIssue");
      expect(createIssueCalls).toHaveLength(2);

      // Verify linkSubIssue was NOT called (no parent-child relationship)
      const linkSubIssueCalls = mockGitHubCLI.getCallsTo("linkSubIssue");
      expect(linkSubIssueCalls).toHaveLength(0);
    });
  });

  describe("syncIssue", () => {
    it("should verify already-synced tasks when GitHub issue exists", async () => {
      // Arrange - create issue with synced task
      const issue = repos.issueRepository.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "OPEN",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Already Synced Task",
        description: "This task is already synced",
        status: "BACKLOG",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Set up existing GitHub sync
      repos.taskRepository.updateGitHubSync(task.id, {
        githubIssueNumber: 50,
        githubUrl: "https://github.com/test/repo/issues/50",
        githubNodeId: "I_test_50",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: "PVTI_test_50",
      });

      // Set up mock to return the existing issue
      mockGitHubCLI.setIssues([
        {
          number: 50,
          url: "https://github.com/test/repo/issues/50",
          nodeId: "I_test_50",
          title: "Already Synced Task",
          body: "Body",
          state: "OPEN",
          labels: [],
        },
      ]);

      // Act
      const result = await service.syncIssue(issue.number);

      // Assert
      expect(result.success).toBe(true);
      expect(result.verified).toHaveLength(1);
      expect(result.verified[0].taskNumber).toBe(task.number);
      expect(result.verified[0].githubIssueNumber).toBe(50);
      expect(result.created).toHaveLength(0);
      expect(result.linked).toHaveLength(0);
    });

    it("should create missing GitHub issues for unsynced tasks", async () => {
      // Arrange - create issue with unsynced task
      const issue = repos.issueRepository.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "OPEN",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Unsynced Task",
        description: "This task has no GitHub issue",
        status: "BACKLOG",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // No GitHub issues set up in mock (empty search results)

      // Act
      const result = await service.syncIssue(issue.number);

      // Assert
      expect(result.success).toBe(true);
      expect(result.created).toHaveLength(1);
      expect(result.verified).toHaveLength(0);
      expect(result.linked).toHaveLength(0);

      // Verify createIssue was called
      const createCalls = mockGitHubCLI.getCallsTo("createIssue");
      expect(createCalls).toHaveLength(1);
    });

    it("should link existing GitHub issues found by title search", async () => {
      // Arrange - create issue with unsynced task
      const issue = repos.issueRepository.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "OPEN",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Task to Link",
        description: "This task should find an existing GitHub issue",
        status: "BACKLOG",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Set up mock to return matching search results
      mockGitHubCLI.setConfig({
        searchResults: [
          {
            number: 60,
            url: "https://github.com/test/repo/issues/60",
            nodeId: "I_test_60",
            title: "Task to Link",
            body: `Some content\n\n---\nTask ${issue.number}.1: Task to Link`,
            state: "OPEN",
            labels: [],
          },
        ],
      });

      // Act
      const result = await service.syncIssue(issue.number);

      // Assert
      expect(result.success).toBe(true);
      expect(result.linked).toHaveLength(1);
      expect(result.linked[0].githubIssueNumber).toBe(60);
      expect(result.created).toHaveLength(0);
      expect(result.verified).toHaveLength(0);

      // Verify createIssue was NOT called (we linked instead)
      const createCalls = mockGitHubCLI.getCallsTo("createIssue");
      expect(createCalls).toHaveLength(0);
    });

    it("should be idempotent - running twice produces same result", async () => {
      // Arrange - create issue with unsynced task
      const issue = repos.issueRepository.create({
        title: "Idempotent Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "OPEN",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Idempotent Task",
        description: "This task should only create one GitHub issue",
        status: "BACKLOG",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Act - first sync
      const result1 = await service.syncIssue(issue.number);

      // Reset mock call counts but keep the issues
      mockGitHubCLI.clearCalls();

      // Act - second sync
      const result2 = await service.syncIssue(issue.number);

      // Assert
      expect(result1.success).toBe(true);
      expect(result1.created).toHaveLength(1);

      expect(result2.success).toBe(true);
      expect(result2.verified).toHaveLength(1); // Now verified, not created
      expect(result2.created).toHaveLength(0);

      // Verify createIssue was NOT called on second run
      const createCalls = mockGitHubCLI.getCallsTo("createIssue");
      expect(createCalls).toHaveLength(0);
    });

    it("should skip PLANNED, COMPLETED, and ABANDONED tasks", async () => {
      // Arrange - create issue with tasks in various states
      const issue = repos.issueRepository.create({
        title: "Multi-Status Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "OPEN",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      // BACKLOG - should be synced
      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Backlog Task",
        description: "Should be synced",
        status: "BACKLOG",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // PLANNED - should be skipped
      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Planned Task",
        description: "Should be skipped",
        status: "PLANNED",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // COMPLETED - should be skipped
      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Completed Task",
        description: "Should be skipped",
        status: "COMPLETED",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // ABANDONED - should be skipped
      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Abandoned Task",
        description: "Should be skipped",
        status: "ABANDONED",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Act
      const result = await service.syncIssue(issue.number);

      // Assert
      expect(result.success).toBe(true);
      expect(result.tasksProcessed).toBe(1); // Only BACKLOG task
      expect(result.created).toHaveLength(1);

      // Verify only one GitHub issue was created
      const createCalls = mockGitHubCLI.getCallsTo("createIssue");
      expect(createCalls).toHaveLength(1);
    });

    it("should return error when GitHub sync is disabled", async () => {
      // Arrange - disable GitHub sync
      repos.projectRepository.update(testProjectId, {
        githubSync: {
          enabled: false,
        },
      });

      const issue = repos.issueRepository.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "OPEN",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      // Act
      const result = await service.syncIssue(issue.number);

      // Assert
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("not enabled");
    });

    it("should return error when issue not found", async () => {
      // Act
      const result = await service.syncIssue(9999);

      // Assert
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("not found");
    });

    it("should handle imported issues correctly for single task", async () => {
      // Arrange - create imported issue with 1 task
      const issue = repos.issueRepository.create({
        title: "Imported Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "OPEN",
        acceptanceCriteria: [],
        createdBy: "test",
        sourceGitHubIssueNumber: 70, // Imported from GitHub
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Single Task",
        description: "Only one task",
        status: "BACKLOG",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Set up parent issue in mock
      mockGitHubCLI.setIssues([
        {
          number: 70,
          url: "https://github.com/test/repo/issues/70",
          nodeId: "I_parent_70",
          title: "Parent Issue",
          body: "Parent body",
          state: "OPEN",
          labels: [],
        },
      ]);

      // Act
      const result = await service.syncIssue(issue.number);

      // Assert
      expect(result.success).toBe(true);
      expect(result.created).toHaveLength(1);
      expect(result.created[0].githubIssueNumber).toBe(70); // Linked to parent

      // Verify NO new issue was created
      const createCalls = mockGitHubCLI.getCallsTo("createIssue");
      expect(createCalls).toHaveLength(0);
    });
  });

  describe("task templates", () => {
    it("should use task template body when templateService is provided", async () => {
      // Arrange - create a template service with a FEATURE template
      const mockFs = new MockFileSystem();
      mockFs.addFile(
        "/global/templates/tasks/feature.md",
        `---
type: FEATURE
priority: MEDIUM
labels: []
---

## Description

{{description}}

## Acceptance Criteria

{{acceptanceCriteria}}

## Parent Issue

{{parentIssueLink}}`
      );

      const templateConfig: TemplateServiceConfig = {
        localIssueTemplatesPath: "/local/templates/issues",
        localTaskTemplatesPath: "/local/templates/tasks",
        globalIssueTemplatesPath: "/global/templates/issues",
        globalTaskTemplatesPath: "/global/templates/tasks",
      };

      const templateService = new TemplateService(mockFs, templateConfig);

      // Create service WITH template service
      const serviceWithTemplates = new TaskGitHubSyncService(
        repos.taskRepository,
        repos.issueRepository,
        repos.planRepository,
        mockGitHubCLI,
        repos.projectRepository,
        testProjectId,
        templateService
      );

      // Create issue and plan
      const issue = repos.issueRepository.create({
        title: "Template Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "PLANNED",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Task with Template",
        description: "This is the task description.",
        status: "PLANNED",
        type: "FEATURE", // Match the template type
        source: "generated",
        acceptanceCriteria: ["Criterion 1", "Criterion 2"],
        isDeleted: false,
      });

      // Act
      const result = await serviceWithTemplates.activatePlannedTasks(issue.id);

      // Assert
      expect(result.success).toBe(true);

      // Verify the body was created using the template
      const createIssueCalls = mockGitHubCLI.getCallsTo("createIssue");
      expect(createIssueCalls).toHaveLength(1);

      const body = createIssueCalls[0].args[1] as string;

      // Check template sections are present
      expect(body).toContain("## Description");
      expect(body).toContain("This is the task description.");
      expect(body).toContain("## Acceptance Criteria");
      expect(body).toContain("- [ ] Criterion 1");
      expect(body).toContain("- [ ] Criterion 2");
      expect(body).toContain("## Parent Issue");
      expect(body).toContain("dev-workflow issue #1: Template Test Issue");

      // Check footer is appended
      expect(body).toContain("---");
      expect(body).toContain("Task 1.1: Task with Template");
    });

    it("should fall back to default format when no template is found", async () => {
      // Arrange - create a template service with no templates
      const mockFs = new MockFileSystem();
      mockFs.addDirectory("/local/templates/tasks");
      mockFs.addDirectory("/global/templates/tasks");

      const templateConfig: TemplateServiceConfig = {
        localIssueTemplatesPath: "/local/templates/issues",
        localTaskTemplatesPath: "/local/templates/tasks",
        globalIssueTemplatesPath: "/global/templates/issues",
        globalTaskTemplatesPath: "/global/templates/tasks",
      };

      const templateService = new TemplateService(mockFs, templateConfig);

      // Create service WITH template service (but no matching templates)
      const serviceWithTemplates = new TaskGitHubSyncService(
        repos.taskRepository,
        repos.issueRepository,
        repos.planRepository,
        mockGitHubCLI,
        repos.projectRepository,
        testProjectId,
        templateService
      );

      // Create issue and plan
      const issue = repos.issueRepository.create({
        title: "No Template Test",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "PLANNED",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Task without Template",
        description: "Fallback description.",
        status: "PLANNED",
        type: "FEATURE",
        source: "generated",
        acceptanceCriteria: ["Fallback criterion"],
        isDeleted: false,
      });

      // Act
      const result = await serviceWithTemplates.activatePlannedTasks(issue.id);

      // Assert
      expect(result.success).toBe(true);

      // Verify the body was created using fallback format
      const createIssueCalls = mockGitHubCLI.getCallsTo("createIssue");
      expect(createIssueCalls).toHaveLength(1);

      const body = createIssueCalls[0].args[1] as string;

      // Check fallback format
      expect(body).toContain("Fallback description.");
      expect(body).toContain("## Acceptance Criteria");
      expect(body).toContain("- [ ] Fallback criterion");
      expect(body).toContain("---");
      expect(body).toContain("Task 1.1: Task without Template");
    });

    it("should work without templateService (backward compatible)", async () => {
      // Arrange - use the default service without templateService
      // Create issue and plan
      const issue = repos.issueRepository.create({
        title: "Backward Compatible Test",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "PLANNED",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Task without Template Service",
        description: "Works without templates.",
        status: "PLANNED",
        type: "FEATURE",
        source: "generated",
        acceptanceCriteria: ["Works correctly"],
        isDeleted: false,
      });

      // Act - use the default service (no templateService)
      const result = await service.activatePlannedTasks(issue.id);

      // Assert
      expect(result.success).toBe(true);

      // Verify the body was created using fallback format
      const createIssueCalls = mockGitHubCLI.getCallsTo("createIssue");
      expect(createIssueCalls).toHaveLength(1);

      const body = createIssueCalls[0].args[1] as string;

      // Check fallback format
      expect(body).toContain("Works without templates.");
      expect(body).toContain("## Acceptance Criteria");
      expect(body).toContain("- [ ] Works correctly");
    });
  });
});
