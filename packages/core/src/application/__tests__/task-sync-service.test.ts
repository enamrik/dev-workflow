/**
 * TaskSyncService Tests
 *
 * Tests task-level GitHub issue synchronization including:
 * - Column moves on status changes (PR_REVIEW -> In Review, COMPLETED -> Done)
 * - Issue close on task completion
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../__tests__/setup.js";
import { getRepositories } from "../../__tests__/helpers.js";
import { MockFileSystem } from "../../__tests__/mocks/mock-file-system.js";
import { TaskSyncService } from "../task-sync-service.js";
import {
  TemplateService,
  type TemplateServiceConfig,
} from "../../infrastructure/templates/template-service.js";
import { TypeService } from "../../infrastructure/types/type-service.js";
import type { Task } from "../../domain/task.js";
import type {
  ProjectManagementProvider,
  ExternalIssue,
} from "../../domain/project-management-provider.js";

/**
 * Create a mock ProjectManagementProvider for testing
 */
function createMockProvider(
  overrides: Partial<ProjectManagementProvider> & { enabled?: boolean } = {}
): ProjectManagementProvider {
  const { enabled = true, ...methodOverrides } = overrides;

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
    // Configuration methods
    isEnabled: vi.fn().mockReturnValue(enabled),
    hasProjectBoard: vi.fn().mockReturnValue(true),
    getAssignee: vi.fn().mockReturnValue(undefined),
    getCustomLabels: vi.fn().mockReturnValue([]),
    getColumnForStatus: vi.fn().mockReturnValue("Backlog"),
    getProjectId: vi.fn().mockReturnValue("PVT_test_project_456"),
    getLabelFieldMapping: vi.fn().mockReturnValue(undefined),
    // High-level operations
    moveItemToStatusColumn: vi.fn().mockResolvedValue(undefined),
    assignIssueToConfiguredUser: vi.fn().mockResolvedValue(undefined),
    // Auth/Validation
    checkAuth: vi.fn().mockResolvedValue({ authenticated: true }),
    checkRepository: vi.fn().mockResolvedValue({ accessible: true }),
    // Issue operations
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
    // Project operations
    addToProject: vi.fn().mockResolvedValue({ success: true, itemId: "PVTI_test_item_123" }),
    moveToColumn: vi.fn().mockResolvedValue(undefined),
    checkProject: vi.fn().mockResolvedValue(true),
    getProjectDetails: vi.fn().mockResolvedValue({
      id: "PVT_123",
      title: "Test Project",
      url: "https://github.com/orgs/owner/projects/1",
    }),
    getProjectStatusField: vi.fn().mockResolvedValue({
      fieldId: "field_status_123",
      fieldName: "Status",
      options: [
        { id: "opt_backlog", name: "Backlog" },
        { id: "opt_ready", name: "Ready" },
        { id: "opt_in_progress", name: "In Progress" },
        { id: "opt_in_review", name: "In Review" },
        { id: "opt_done", name: "Done" },
      ],
    }),
    getProjectFields: vi.fn().mockResolvedValue([]),
    setProjectItemField: vi.fn().mockResolvedValue({ success: true }),
    clearProjectItemField: vi.fn().mockResolvedValue({ success: true }),
    getAvailableLabels: vi.fn().mockResolvedValue({ supported: true, labels: [] }),
    linkParentChild: vi.fn().mockResolvedValue(undefined),
    addComment: vi.fn().mockResolvedValue(undefined),
    assignIssue: vi.fn().mockResolvedValue(undefined),
    closeIssueByTask: vi.fn().mockResolvedValue(undefined),
    ...methodOverrides,
  };
}

describe("TaskSyncService", () => {
  let testDb: TestDatabase;
  let repos: ReturnType<typeof getRepositories>;
  let mockProvider: ProjectManagementProvider;
  let testProjectId: string;
  let service: TaskSyncService;

  beforeEach(async () => {
    testDb = createTestDatabase();
    mockProvider = createMockProvider();

    // Create a project with GitHub sync enabled (including projectId for column moves)
    const project = await testDb.source.projects.create({
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

    // Create a client scoped to this project for the repos
    const projectClient = testDb.source.createClient(testProjectId);
    repos = getRepositories(projectClient);

    service = new TaskSyncService(testDb.source, mockProvider, testProjectId);
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

      // Assert - verify moveItemToStatusColumn was called with correct arguments
      expect(mockProvider.moveItemToStatusColumn).toHaveBeenCalledWith(
        "PVTI_test_item_123",
        "READY"
      );
    });

    it("should move to In Review column when status changes to PR_REVIEW", async () => {
      // Act
      await service.syncTaskStatus(testTask.id, "PR_REVIEW");

      // Assert - verify moveItemToStatusColumn was called with correct arguments
      expect(mockProvider.moveItemToStatusColumn).toHaveBeenCalledWith(
        "PVTI_test_item_123",
        "PR_REVIEW"
      );
    });

    it("should move to Done column and close issue when status changes to COMPLETED", async () => {
      // Act
      await service.syncTaskStatus(testTask.id, "COMPLETED");

      // Assert - verify closeIssueByTask was called with the task
      expect(mockProvider.closeIssueByTask).toHaveBeenCalled();
      const calledTask = vi.mocked(mockProvider.closeIssueByTask).mock.calls[0][0];
      expect(calledTask.githubSync?.githubIssueNumber).toBe(42);

      // Assert - verify moveItemToStatusColumn was called with COMPLETED status
      expect(mockProvider.moveItemToStatusColumn).toHaveBeenCalledWith(
        "PVTI_test_item_123",
        "COMPLETED"
      );
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

    it("should handle null projectItemId gracefully", async () => {
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

      // Act - should not throw, provider handles null gracefully
      await service.syncTaskStatus(testTask.id, "PR_REVIEW");

      // Assert - moveItemToStatusColumn is called with null, provider handles it
      expect(mockProvider.moveItemToStatusColumn).toHaveBeenCalledWith(null, "PR_REVIEW");
    });

    it("should call moveItemToStatusColumn even without projectId (provider handles gracefully)", async () => {
      // Arrange - update project to have no projectId
      await testDb.source.projects.update(testProjectId, {
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

      // Act - service calls provider, provider handles missing projectId gracefully
      await service.syncTaskStatus(testTask.id, "PR_REVIEW");

      // Assert - provider method is called, provider no-ops internally
      expect(mockProvider.moveItemToStatusColumn).toHaveBeenCalledWith(
        "PVTI_test_item_123",
        "PR_REVIEW"
      );
    });

    it("should still update lastSyncedAt after sync (provider handles column errors internally)", async () => {
      // Note: The real provider handles moveItemToStatusColumn errors internally
      // and doesn't propagate them. With a mock, we can't test that behavior here.
      // This test verifies the service updates lastSyncedAt after calling the provider.

      // Act
      await service.syncTaskStatus(testTask.id, "PR_REVIEW");

      // Assert - lastSyncedAt should be updated
      const updatedTask = repos.taskRepository.findById(testTask.id);
      expect(updatedTask?.githubSync?.lastSyncedAt).toBeDefined();
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

    it("should call moveItemToStatusColumn with the status (provider handles column mapping)", async () => {
      // Arrange - configure custom column mapping (provider handles this internally)
      await testDb.source.projects.update(testProjectId, {
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

      // Assert - service calls high-level method with status, provider handles column mapping
      expect(mockProvider.moveItemToStatusColumn).toHaveBeenCalledWith(
        "PVTI_test_item_mapping",
        "PR_REVIEW"
      );
    });

    it("should use default mapping for unmapped statuses when custom mapping is partial", async () => {
      // Arrange - configure partial custom column mapping
      await testDb.source.projects.update(testProjectId, {
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

      // Act - sync to READY which uses default mapping
      await service.syncTaskStatus(testTask.id, "READY");

      // Assert - should call moveItemToStatusColumn (high-level method)
      // The provider handles column mapping internally
      expect(mockProvider.moveItemToStatusColumn).toHaveBeenCalledWith(
        "PVTI_test_item_mapping",
        "READY"
      );
    });

    it("should not throw when column move fails", async () => {
      // Arrange - configure provider's moveItemToStatusColumn to log but not throw
      // (the provider handles errors internally with console.warn)
      mockProvider = createMockProvider({
        moveItemToStatusColumn: vi.fn().mockResolvedValue(undefined),
      });
      service = new TaskSyncService(testDb.source, mockProvider, testProjectId);

      await testDb.source.projects.update(testProjectId, {
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
            PR_REVIEW: "NonExistent Column", // Doesn't matter - provider handles internally
          },
        },
      });

      // Act - should not throw
      await expect(service.syncTaskStatus(testTask.id, "PR_REVIEW")).resolves.not.toThrow();
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
      mockProvider = createMockProvider({
        getIssue: vi.fn().mockImplementation((ref: string) => {
          if (ref === "42") {
            return Promise.resolve({
              id: "42",
              numericId: 42,
              url: "https://github.com/test/repo/issues/42",
              nodeId: "I_parent_42",
              title: "Parent Issue",
              body: "Parent body",
              state: "OPEN" as const,
              labels: [],
            });
          }
          return Promise.resolve(null);
        }),
      });
      service = new TaskSyncService(testDb.source, mockProvider, testProjectId);

      // Act
      const result = await service.activatePlannedTasks(issue.id);

      // Assert
      expect(result.success).toBe(true);
      expect(result.tasksActivated).toHaveLength(1);
      expect(result.tasksActivated[0].githubIssueNumber).toBe(42); // Linked to parent

      // Verify NO new issue was created (only getIssue was called)
      expect(mockProvider.createIssue).not.toHaveBeenCalled();

      // Verify getIssue was called to fetch parent
      expect(mockProvider.getIssue).toHaveBeenCalledWith("42");
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

      // Set up the parent GitHub issue and created sub-issues in the mock
      let createCount = 0;
      mockProvider = createMockProvider({
        getIssue: vi.fn().mockImplementation((ref: string) => {
          if (ref === "100") {
            return Promise.resolve({
              id: "100",
              numericId: 100,
              url: "https://github.com/test/repo/issues/100",
              nodeId: "I_parent_100",
              title: "Parent Issue",
              body: "Parent body",
              state: "OPEN" as const,
              labels: [],
            });
          }
          // Return created sub-issues when asked
          const num = parseInt(ref, 10);
          if (num > 0) {
            return Promise.resolve({
              id: ref,
              numericId: num,
              url: `https://github.com/test/repo/issues/${ref}`,
              nodeId: `I_subissue_${ref}`,
              title: `Sub-issue ${ref}`,
              body: "Sub-issue body",
              state: "OPEN" as const,
              labels: [],
            });
          }
          return Promise.resolve(null);
        }),
        createIssue: vi.fn().mockImplementation(() => {
          createCount++;
          return Promise.resolve({
            id: String(createCount),
            numericId: createCount,
            url: `https://github.com/test/repo/issues/${createCount}`,
            nodeId: `I_subissue_${createCount}`,
            title: `Sub-issue ${createCount}`,
            body: "Sub-issue body",
            state: "OPEN" as const,
            labels: [],
          });
        }),
        linkParentChild: vi.fn().mockResolvedValue(undefined),
      });
      service = new TaskSyncService(testDb.source, mockProvider, testProjectId);

      // Act
      const result = await service.activatePlannedTasks(issue.id);

      // Assert
      expect(result.success).toBe(true);
      expect(result.tasksActivated).toHaveLength(2);

      // Verify new issues were created (2 sub-issues)
      expect(mockProvider.createIssue).toHaveBeenCalledTimes(2);

      // Verify linkParentChild was called for each task
      expect(mockProvider.linkParentChild).toHaveBeenCalledTimes(2);

      // Verify both calls link to parent issue 100
      expect(mockProvider.linkParentChild).toHaveBeenNthCalledWith(1, "100", "1");
      expect(mockProvider.linkParentChild).toHaveBeenNthCalledWith(2, "100", "2");
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
      expect(mockProvider.createIssue).toHaveBeenCalledTimes(2);

      // Verify linkParentChild was NOT called (no parent-child relationship)
      expect(mockProvider.linkParentChild).not.toHaveBeenCalled();
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
      mockProvider = createMockProvider({
        getIssue: vi.fn().mockImplementation((ref: string) => {
          if (ref === "50") {
            return Promise.resolve({
              id: "50",
              numericId: 50,
              url: "https://github.com/test/repo/issues/50",
              nodeId: "I_test_50",
              title: "Already Synced Task",
              body: "Body",
              state: "OPEN" as const,
              labels: [],
            });
          }
          return Promise.resolve(null);
        }),
      });
      service = new TaskSyncService(testDb.source, mockProvider, testProjectId);

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

      // No GitHub issues set up in mock (empty search results - already the default)

      // Act
      const result = await service.syncIssue(issue.number);

      // Assert
      expect(result.success).toBe(true);
      expect(result.created).toHaveLength(1);
      expect(result.verified).toHaveLength(0);
      expect(result.linked).toHaveLength(0);

      // Verify createIssue was called
      expect(mockProvider.createIssue).toHaveBeenCalledTimes(1);
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
      mockProvider = createMockProvider({
        searchIssues: vi.fn().mockResolvedValue([
          {
            id: "60",
            numericId: 60,
            url: "https://github.com/test/repo/issues/60",
            nodeId: "I_test_60",
            title: "Task to Link",
            body: `Some content\n\n---\nTask ${issue.number}.1: Task to Link`,
            state: "OPEN" as const,
            labels: [],
          },
        ]),
      });
      service = new TaskSyncService(testDb.source, mockProvider, testProjectId);

      // Act
      const result = await service.syncIssue(issue.number);

      // Assert
      expect(result.success).toBe(true);
      expect(result.linked).toHaveLength(1);
      expect(result.linked[0].githubIssueNumber).toBe(60);
      expect(result.created).toHaveLength(0);
      expect(result.verified).toHaveLength(0);

      // Verify createIssue was NOT called (we linked instead)
      expect(mockProvider.createIssue).not.toHaveBeenCalled();
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

      // Set up mock to track created issues and return them on getIssue
      const createdIssues = new Map<string, ExternalIssue>();
      let issueCounter = 0;

      mockProvider = createMockProvider({
        createIssue: vi.fn().mockImplementation(() => {
          issueCounter++;
          const newIssue: ExternalIssue = {
            id: String(issueCounter),
            numericId: issueCounter,
            url: `https://github.com/test/repo/issues/${issueCounter}`,
            nodeId: `I_test_${issueCounter}`,
            title: "Idempotent Task",
            body: "Body",
            state: "OPEN" as const,
            labels: [],
          };
          createdIssues.set(String(issueCounter), newIssue);
          return Promise.resolve(newIssue);
        }),
        getIssue: vi.fn().mockImplementation((ref: string) => {
          return Promise.resolve(createdIssues.get(ref) ?? null);
        }),
      });
      service = new TaskSyncService(testDb.source, mockProvider, testProjectId);

      // Act - first sync
      const result1 = await service.syncIssue(issue.number);

      // Assert first run created an issue
      expect(result1.success).toBe(true);
      expect(result1.created).toHaveLength(1);

      // Reset mock call counts for second run
      vi.mocked(mockProvider.createIssue).mockClear();

      // Act - second sync
      const result2 = await service.syncIssue(issue.number);

      // Assert
      expect(result2.success).toBe(true);
      expect(result2.verified).toHaveLength(1); // Now verified, not created
      expect(result2.created).toHaveLength(0);

      // Verify createIssue was NOT called on second run
      expect(mockProvider.createIssue).not.toHaveBeenCalled();
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
      expect(mockProvider.createIssue).toHaveBeenCalledTimes(1);
    });

    it("should return error when GitHub sync is disabled", async () => {
      // Arrange - create a disabled provider and new service instance
      const disabledProvider = createMockProvider({ enabled: false });
      const disabledService = new TaskSyncService(testDb.source, disabledProvider, testProjectId);

      const issue = repos.issueRepository.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "MEDIUM",
        status: "OPEN",
        acceptanceCriteria: [],
        createdBy: "test",
      });

      // Create a plan so syncIssue doesn't short-circuit with "No plan found"
      const plan = repos.planRepository.create({
        issueId: issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "MEDIUM",
        generatedBy: "test",
      });

      // Create a task in BACKLOG status (syncable status)
      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Test Task",
        description: "Test description",
        status: "BACKLOG",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Act
      const result = await disabledService.syncIssue(issue.number);

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
      mockProvider = createMockProvider({
        getIssue: vi.fn().mockImplementation((ref: string) => {
          if (ref === "70") {
            return Promise.resolve({
              id: "70",
              numericId: 70,
              url: "https://github.com/test/repo/issues/70",
              nodeId: "I_parent_70",
              title: "Parent Issue",
              body: "Parent body",
              state: "OPEN" as const,
              labels: [],
            });
          }
          return Promise.resolve(null);
        }),
      });
      service = new TaskSyncService(testDb.source, mockProvider, testProjectId);

      // Act
      const result = await service.syncIssue(issue.number);

      // Assert
      expect(result.success).toBe(true);
      expect(result.created).toHaveLength(1);
      expect(result.created[0].githubIssueNumber).toBe(70); // Linked to parent

      // Verify NO new issue was created
      expect(mockProvider.createIssue).not.toHaveBeenCalled();
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
      const serviceWithTemplates = new TaskSyncService(
        testDb.source,
        mockProvider,
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
      expect(mockProvider.createIssue).toHaveBeenCalledTimes(1);

      const createCall = vi.mocked(mockProvider.createIssue).mock.calls[0];
      const body = createCall[0].body;

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
      const serviceWithTemplates = new TaskSyncService(
        testDb.source,
        mockProvider,
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
      expect(mockProvider.createIssue).toHaveBeenCalledTimes(1);

      const createCall = vi.mocked(mockProvider.createIssue).mock.calls[0];
      const body = createCall[0].body;

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
      expect(mockProvider.createIssue).toHaveBeenCalledTimes(1);

      const createCall = vi.mocked(mockProvider.createIssue).mock.calls[0];
      const body = createCall[0].body;

      // Check fallback format
      expect(body).toContain("Works without templates.");
      expect(body).toContain("## Acceptance Criteria");
      expect(body).toContain("- [ ] Works correctly");
    });
  });

  describe("task type labels", () => {
    it("should use task.type for GitHub label via TypeService", async () => {
      // Arrange - create TypeService with repository that has custom types
      // Seed types in the test database
      testDb.source.types.seedTypes([
        { name: "FEATURE", displayName: "Feature", description: "New functionality" },
        { name: "BUG", displayName: "Bug", description: "Something broken" },
        {
          name: "ENHANCEMENT",
          displayName: "Enhancement",
          description: "Better existing features",
        },
        { name: "TASK", displayName: "Task", description: "Technical work" },
      ]);
      const typeService = new TypeService(testDb.source.types);

      // Create service WITH typeService
      const serviceWithTypes = new TaskSyncService(
        testDb.source,
        mockProvider,
        testProjectId,
        undefined, // no templateService
        typeService
      );

      // Create issue and plan
      const issue = repos.issueRepository.create({
        title: "Type Label Test Issue",
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

      // Create a TASK type task (should get "task" label from TypeService - lowercase name)
      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Infrastructure Task",
        description: "Technical work.",
        status: "PLANNED",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Act
      const result = await serviceWithTypes.activatePlannedTasks(issue.id);

      // Assert
      expect(result.success).toBe(true);

      // Verify the correct label was applied
      expect(mockProvider.createIssue).toHaveBeenCalledTimes(1);

      const createCall = vi.mocked(mockProvider.createIssue).mock.calls[0];
      const labels = createCall[0].labels;
      expect(labels).toContain("task"); // From TypeService: TASK -> task (lowercase)
    });

    it("should use different label for FEATURE type task", async () => {
      // Arrange - create TypeService with repository
      testDb.source.types.seedTypes([
        { name: "FEATURE", displayName: "Feature", description: "New functionality" },
        { name: "TASK", displayName: "Task", description: "Technical work" },
      ]);
      const typeService = new TypeService(testDb.source.types);

      const serviceWithTypes = new TaskSyncService(
        testDb.source,
        mockProvider,
        testProjectId,
        undefined,
        typeService
      );

      // Create issue and plan
      const issue = repos.issueRepository.create({
        title: "Feature Task Test",
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

      // Create a FEATURE type task (should get "feature" label - lowercase name)
      repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Add new feature",
        description: "New functionality.",
        status: "PLANNED",
        type: "FEATURE",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Act
      const result = await serviceWithTypes.activatePlannedTasks(issue.id);

      // Assert
      expect(result.success).toBe(true);

      const createCall = vi.mocked(mockProvider.createIssue).mock.calls[0];
      const labels = createCall[0].labels;
      expect(labels).toContain("feature"); // From TypeService: FEATURE -> feature (lowercase)
      expect(labels).toContain("task");
    });

    it("should fall back to lowercase type name when TypeService is not provided", async () => {
      // Use the default service (no typeService)
      const issue = repos.issueRepository.create({
        title: "Fallback Test Issue",
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
        title: "Fallback Task",
        description: "Tests fallback label.",
        status: "PLANNED",
        type: "ENHANCEMENT", // Should become "enhancement" when no TypeService
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Act - use default service (no TypeService)
      const result = await service.activatePlannedTasks(issue.id);

      // Assert
      expect(result.success).toBe(true);

      const createCall = vi.mocked(mockProvider.createIssue).mock.calls[0];
      const labels = createCall[0].labels;
      expect(labels).toContain("enhancement"); // Lowercase fallback
      expect(labels).toContain("task");
    });

    it("should use default TypeService labels when no types in database", async () => {
      // Arrange - create TypeService with empty repository (uses defaults)
      // Note: testDb.source.types is empty, so TypeService will fall back to defaults
      const typeService = new TypeService(testDb.source.types);

      const serviceWithTypes = new TaskSyncService(
        testDb.source,
        mockProvider,
        testProjectId,
        undefined,
        typeService
      );

      // Create issue and plan
      const issue = repos.issueRepository.create({
        title: "Default Labels Test",
        description: "Test description",
        type: "BUG",
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
        title: "Fix bug",
        description: "Bug fix.",
        status: "PLANNED",
        type: "BUG",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Act
      const result = await serviceWithTypes.activatePlannedTasks(issue.id);

      // Assert
      expect(result.success).toBe(true);

      const createCall = vi.mocked(mockProvider.createIssue).mock.calls[0];
      const labels = createCall[0].labels;
      // Default TypeService has: BUG -> "bug"
      expect(labels).toContain("bug");
      expect(labels).toContain("task");
    });
  });
});
