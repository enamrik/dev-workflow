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
import { TaskGitHubSyncService } from "../task-github-sync-service.js";
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
});
