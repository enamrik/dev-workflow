/**
 * Merge Service Tests
 *
 * Tests for MergeService which handles combining two issues into one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createRepositories,
  createTestIssue,
  createTestPlan,
  createTestTask,
} from "../../__tests__/helpers.js";
import { createTestDatabase } from "../../__tests__/setup.js";
import { MergeService, MergeValidationError } from "../merge-service.js";
import { VersioningService } from "../versioning-service.js";

describe("MergeService", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof createRepositories>;
  let mergeService: MergeService;
  let versioningService: VersioningService;
  let testProjectId: string;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);

    // Create a test project (GitHub sync disabled by default for most tests)
    const project = repos.projectRepository.create({
      name: "Test Project",
      gitRootHash: "abc123def",
      githubSync: null, // GitHub sync disabled
    });
    testProjectId = project.id;

    versioningService = new VersioningService(
      repos.issueRepository,
      repos.snapshotRepository,
      repos.planRepository,
      repos.taskRepository
    );

    mergeService = new MergeService(
      repos.issueRepository,
      repos.planRepository,
      repos.taskRepository,
      versioningService,
      repos.projectRepository,
      testProjectId
      // No githubCLI - GitHub sync disabled
    );
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("validation", () => {
    it("should throw if source issue not found", async () => {
      const target = createTestIssue(repos.issueRepository);

      await expect(
        mergeService.merge({
          sourceIssueNumber: 9999,
          targetIssueNumber: target.number,
          mode: "create_new",
          mergedBy: "test",
        })
      ).rejects.toThrow(MergeValidationError);
    });

    it("should throw if target issue not found", async () => {
      const source = createTestIssue(repos.issueRepository);

      await expect(
        mergeService.merge({
          sourceIssueNumber: source.number,
          targetIssueNumber: 9999,
          mode: "create_new",
          mergedBy: "test",
        })
      ).rejects.toThrow(MergeValidationError);
    });

    it("should throw if trying to merge issue with itself", async () => {
      const issue = createTestIssue(repos.issueRepository);

      await expect(
        mergeService.merge({
          sourceIssueNumber: issue.number,
          targetIssueNumber: issue.number,
          mode: "create_new",
          mergedBy: "test",
        })
      ).rejects.toThrow("Cannot merge an issue with itself");
    });

    it("should throw if source issue is CLOSED", async () => {
      const source = createTestIssue(repos.issueRepository, { status: "CLOSED" });
      const target = createTestIssue(repos.issueRepository);

      await expect(
        mergeService.merge({
          sourceIssueNumber: source.number,
          targetIssueNumber: target.number,
          mode: "create_new",
          mergedBy: "test",
        })
      ).rejects.toThrow(`Source issue #${source.number} is CLOSED and cannot be merged`);
    });

    it("should throw if target issue is CLOSED", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository, { status: "CLOSED" });

      await expect(
        mergeService.merge({
          sourceIssueNumber: source.number,
          targetIssueNumber: target.number,
          mode: "create_new",
          mergedBy: "test",
        })
      ).rejects.toThrow(`Target issue #${target.number} is CLOSED and cannot be merged`);
    });

    it("should resolve issues by ID", async () => {
      const source = createTestIssue(repos.issueRepository, { title: "Source" });
      const target = createTestIssue(repos.issueRepository, { title: "Target" });

      const result = await mergeService.merge({
        sourceIssueId: source.id,
        targetIssueId: target.id,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.sourceIssues).toHaveLength(2);
      expect(result.sourceIssues[0]?.title).toBe("Source");
      expect(result.sourceIssues[1]?.title).toBe("Target");
    });
  });

  describe("create_new mode", () => {
    it("should create a new issue combining both sources", async () => {
      const source = createTestIssue(repos.issueRepository, {
        title: "Feature A",
        description: "Description A",
      });
      const target = createTestIssue(repos.issueRepository, {
        title: "Feature B",
        description: "Description B",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.mode).toBe("create_new");
      expect(result.resultIssue.title).toContain("Feature A");
      expect(result.resultIssue.title).toContain("Feature B");
      expect(result.resultIssue.description).toContain("Description A");
      expect(result.resultIssue.description).toContain("Description B");
      expect(result.resultIssue.status).toBe("OPEN");
    });

    it("should use custom title when provided", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        newTitle: "Custom Merged Title",
        mergedBy: "test",
      });

      expect(result.resultIssue.title).toBe("Custom Merged Title");
    });

    it("should use custom description when provided", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        newDescription: "Custom description",
        mergedBy: "test",
      });

      expect(result.resultIssue.description).toBe("Custom description");
    });

    it("should combine acceptance criteria without duplicates", async () => {
      const source = createTestIssue(repos.issueRepository, {
        acceptanceCriteria: ["Criterion A", "Common criterion"],
      });
      const target = createTestIssue(repos.issueRepository, {
        acceptanceCriteria: ["Criterion B", "Common criterion"],
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.resultIssue.acceptanceCriteria).toContain("Criterion A");
      expect(result.resultIssue.acceptanceCriteria).toContain("Criterion B");
      // Should not have duplicate
      const commonCount = result.resultIssue.acceptanceCriteria.filter(
        (c: string) => c === "Common criterion"
      ).length;
      expect(commonCount).toBe(1);
    });

    it("should use higher priority", async () => {
      const source = createTestIssue(repos.issueRepository, { priority: "LOW" });
      const target = createTestIssue(repos.issueRepository, { priority: "HIGH" });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.resultIssue.priority).toBe("HIGH");
    });

    it("should not modify source issues", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);

      mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      // Source issues should still exist unchanged
      const sourceAfter = repos.issueRepository.findByNumber(source.number);
      const targetAfter = repos.issueRepository.findByNumber(target.number);

      expect(sourceAfter).not.toBeNull();
      expect(targetAfter).not.toBeNull();
      expect(sourceAfter?.isDeleted).not.toBe(true);
      expect(targetAfter?.isDeleted).not.toBe(true);
    });
  });

  describe("create_new mode with plans", () => {
    it("should create combined plan when both issues have plans", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      createTestPlan(repos.planRepository, source.id, {
        summary: "Source plan summary",
        approach: "Source approach",
      });
      createTestPlan(repos.planRepository, target.id, {
        summary: "Target plan summary",
        approach: "Target approach",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.resultPlan).toBeDefined();
      expect(result.resultPlan?.summary).toContain("Source plan summary");
      expect(result.resultPlan?.summary).toContain("Target plan summary");
      expect(result.resultPlan?.approach).toContain("Source approach");
      expect(result.resultPlan?.approach).toContain("Target approach");
    });

    it("should copy tasks from both plans", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id);
      const targetPlan = createTestPlan(repos.planRepository, target.id);

      createTestTask(repos.taskRepository, sourcePlan.id, { title: "Source Task 1" });
      createTestTask(repos.taskRepository, sourcePlan.id, { title: "Source Task 2" });
      createTestTask(repos.taskRepository, targetPlan.id, { title: "Target Task 1" });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.resultTasks).toHaveLength(3);
      const titles = result.resultTasks.map((t) => t.title);
      expect(titles.some((t) => t.includes("Source Task 1"))).toBe(true);
      expect(titles.some((t) => t.includes("Source Task 2"))).toBe(true);
      expect(titles.some((t) => t.includes("Target Task 1"))).toBe(true);
    });

    it("should preserve COMPLETED task status", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id);

      createTestTask(repos.taskRepository, sourcePlan.id, {
        title: "Completed Task",
        status: "COMPLETED",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      const completedTask = result.resultTasks.find((t) => t.title.includes("Completed Task"));
      expect(completedTask?.status).toBe("COMPLETED");
    });

    it("should preserve IN_PROGRESS task status", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id);

      createTestTask(repos.taskRepository, sourcePlan.id, {
        title: "In Progress Task",
        status: "IN_PROGRESS",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      const inProgressTask = result.resultTasks.find((t) => t.title.includes("In Progress Task"));
      expect(inProgressTask?.status).toBe("IN_PROGRESS");
    });

    it("should convert READY tasks to BACKLOG", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id);

      createTestTask(repos.taskRepository, sourcePlan.id, {
        title: "Ready Task",
        status: "READY",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      const readyTask = result.resultTasks.find((t) => t.title.includes("Ready Task"));
      expect(readyTask?.status).toBe("BACKLOG");
    });

    it("should use higher complexity from plans", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      // Create plans (assigned to variables for clarity, but only return value matters)
      createTestPlan(repos.planRepository, source.id, {
        estimatedComplexity: "LOW",
      });
      createTestPlan(repos.planRepository, target.id, {
        estimatedComplexity: "HIGH",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.resultPlan?.estimatedComplexity).toBe("HIGH");
    });
  });

  describe("create_new mode without plans", () => {
    it("should work when neither issue has a plan", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.resultIssue).toBeDefined();
      expect(result.resultPlan).toBeUndefined();
      expect(result.resultTasks).toHaveLength(0);
    });

    it("should create plan when only source has a plan", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id);
      createTestTask(repos.taskRepository, sourcePlan.id, { title: "Source Task" });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.resultPlan).toBeDefined();
      expect(result.resultTasks).toHaveLength(1);
    });

    it("should create plan when only target has a plan", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const targetPlan = createTestPlan(repos.planRepository, target.id);
      createTestTask(repos.taskRepository, targetPlan.id, { title: "Target Task" });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.resultPlan).toBeDefined();
      expect(result.resultTasks).toHaveLength(1);
    });
  });

  describe("merge_into mode", () => {
    it("should update target issue description", async () => {
      const source = createTestIssue(repos.issueRepository, {
        title: "Source Feature",
        description: "Source description",
      });
      const target = createTestIssue(repos.issueRepository, {
        title: "Target Feature",
        description: "Target description",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "merge_into",
        mergedBy: "test",
      });

      expect(result.mode).toBe("merge_into");
      expect(result.resultIssue.id).toBe(target.id);
      expect(result.resultIssue.description).toContain("Target description");
      expect(result.resultIssue.description).toContain("Source description");
      expect(result.resultIssue.description).toContain(`#${source.number}`);
    });

    it("should soft-delete source issue", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);

      mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "merge_into",
        mergedBy: "test",
      });

      // Source should be soft-deleted
      const sourceAfter = repos.issueRepository.findByNumber(source.number);
      expect(sourceAfter?.isDeleted).toBe(true);
    });

    it("should combine acceptance criteria", async () => {
      const source = createTestIssue(repos.issueRepository, {
        acceptanceCriteria: ["Source criterion"],
      });
      const target = createTestIssue(repos.issueRepository, {
        acceptanceCriteria: ["Target criterion"],
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "merge_into",
        mergedBy: "test",
      });

      expect(result.resultIssue.acceptanceCriteria).toContain("Target criterion");
      expect(result.resultIssue.acceptanceCriteria).toContain("Source criterion");
    });
  });

  describe("merge_into mode with plans", () => {
    it("should add source tasks to existing target plan", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id);
      const targetPlan = createTestPlan(repos.planRepository, target.id);

      createTestTask(repos.taskRepository, sourcePlan.id, { title: "Source Task" });
      createTestTask(repos.taskRepository, targetPlan.id, { title: "Target Task" });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "merge_into",
        mergedBy: "test",
      });

      expect(result.resultPlan?.id).toBe(targetPlan.id);
      expect(result.resultTasks).toHaveLength(2);
      expect(result.resultTasks.some((t) => t.title === "Target Task")).toBe(true);
      expect(result.resultTasks.some((t) => t.title.includes("Source Task"))).toBe(true);
    });

    it("should create new plan on target when only source has plan", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id, {
        summary: "Source summary",
        approach: "Source approach",
      });
      createTestTask(repos.taskRepository, sourcePlan.id, { title: "Source Task" });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "merge_into",
        mergedBy: "test",
      });

      expect(result.resultPlan).toBeDefined();
      expect(result.resultPlan?.issueId).toBe(target.id);
      expect(result.resultPlan?.summary).toBe("Source summary");
      expect(result.resultTasks).toHaveLength(1);
    });

    it("should update target plan approach with source approach", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      createTestPlan(repos.planRepository, source.id, {
        approach: "Source approach details",
      });
      createTestPlan(repos.planRepository, target.id, {
        approach: "Target approach details",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "merge_into",
        mergedBy: "test",
      });

      expect(result.resultPlan?.approach).toContain("Target approach details");
      expect(result.resultPlan?.approach).toContain("Source approach details");
      expect(result.resultPlan?.approach).toContain(`#${source.number}`);
    });

    it("should work when only target has plan", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const targetPlan = createTestPlan(repos.planRepository, target.id);
      createTestTask(repos.taskRepository, targetPlan.id, { title: "Target Task" });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "merge_into",
        mergedBy: "test",
      });

      expect(result.resultPlan?.id).toBe(targetPlan.id);
      expect(result.resultTasks).toHaveLength(1);
      expect(result.resultTasks[0]?.title).toBe("Target Task");
    });
  });

  describe("warnings", () => {
    it("should warn about IN_PROGRESS tasks in source", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id);
      createTestTask(repos.taskRepository, sourcePlan.id, {
        title: "Active Task",
        status: "IN_PROGRESS",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.type).toBe("in_progress_task");
      expect(result.warnings[0]?.taskTitle).toBe("Active Task");
      expect(result.warnings[0]?.issueNumber).toBe(source.number);
    });

    it("should warn about IN_PROGRESS tasks in target", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const targetPlan = createTestPlan(repos.planRepository, target.id);
      createTestTask(repos.taskRepository, targetPlan.id, {
        title: "Active Task",
        status: "IN_PROGRESS",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.issueNumber).toBe(target.number);
    });

    it("should warn about PR_REVIEW tasks", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id);
      createTestTask(repos.taskRepository, sourcePlan.id, {
        title: "PR Task",
        status: "PR_REVIEW",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.type).toBe("pr_review_task");
    });

    it("should collect warnings from both issues", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id);
      const targetPlan = createTestPlan(repos.planRepository, target.id);

      createTestTask(repos.taskRepository, sourcePlan.id, {
        title: "Source Active",
        status: "IN_PROGRESS",
      });
      createTestTask(repos.taskRepository, targetPlan.id, {
        title: "Target Active",
        status: "IN_PROGRESS",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.warnings).toHaveLength(2);
    });

    it("should not warn about COMPLETED tasks", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id);
      createTestTask(repos.taskRepository, sourcePlan.id, {
        title: "Done Task",
        status: "COMPLETED",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.warnings).toHaveLength(0);
    });

    it("should not warn about BACKLOG tasks", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id);
      createTestTask(repos.taskRepository, sourcePlan.id, {
        title: "Backlog Task",
        status: "BACKLOG",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("task description annotation", () => {
    it("should annotate copied task descriptions with source issue number", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id);
      createTestTask(repos.taskRepository, sourcePlan.id, {
        title: "Test Task",
        description: "Original description",
      });

      const result = await mergeService.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      const copiedTask = result.resultTasks.find((t) => t.title === "Test Task");
      expect(copiedTask?.description).toContain(`#${source.number}`);
      expect(copiedTask?.description).toContain("Original description");
    });
  });

  describe("GitHub sync integration", () => {
    let mockGitHubCLI: {
      commentOnIssue: ReturnType<typeof vi.fn>;
      closeIssueWithComment: ReturnType<typeof vi.fn>;
      closeIssue: ReturnType<typeof vi.fn>;
    };
    let mergeServiceWithGitHub: MergeService;

    beforeEach(() => {
      // Update the project to enable GitHub sync
      repos.projectRepository.update(testProjectId, {
        githubSync: {
          enabled: true,
          projectId: "PVT_test",
          labels: undefined,
          columnMapping: undefined,
        },
      });

      // Create mock GitHub CLI
      mockGitHubCLI = {
        commentOnIssue: vi.fn().mockResolvedValue(undefined),
        closeIssueWithComment: vi.fn().mockResolvedValue(undefined),
        closeIssue: vi.fn().mockResolvedValue(undefined),
      };

      // Create MergeService with GitHub CLI
      mergeServiceWithGitHub = new MergeService(
        repos.issueRepository,
        repos.planRepository,
        repos.taskRepository,
        versioningService,
        repos.projectRepository,
        testProjectId,
        mockGitHubCLI as unknown as import("../../infrastructure/github/github-cli.js").GitHubCLI
      );
    });

    it("should comment on source GitHub issue in create_new mode", async () => {
      const source = createTestIssue(repos.issueRepository, { title: "Source Issue" });
      const target = createTestIssue(repos.issueRepository, { title: "Target Issue" });

      // Add GitHub sync state to source
      repos.issueRepository.update(source.id, {
        githubSync: {
          githubIssueNumber: 10,
          githubUrl: "https://github.com/test/repo/issues/10",
          githubNodeId: "I_test_10",
          syncStatus: "SYNCED",
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: null,
          projectItemId: null,
        },
      });

      const result = await mergeServiceWithGitHub.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(mockGitHubCLI.commentOnIssue).toHaveBeenCalledWith(
        10,
        expect.stringContaining("combined with another issue")
      );
      expect(result.resultIssue).toBeDefined();
    });

    it("should close source GitHub issue with comment in merge_into mode", async () => {
      const source = createTestIssue(repos.issueRepository, { title: "Source Issue" });
      const target = createTestIssue(repos.issueRepository, { title: "Target Issue" });

      // Add GitHub sync state to source
      repos.issueRepository.update(source.id, {
        githubSync: {
          githubIssueNumber: 20,
          githubUrl: "https://github.com/test/repo/issues/20",
          githubNodeId: "I_test_20",
          syncStatus: "SYNCED",
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: null,
          projectItemId: null,
        },
      });

      await mergeServiceWithGitHub.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "merge_into",
        mergedBy: "test",
      });

      expect(mockGitHubCLI.closeIssueWithComment).toHaveBeenCalledWith(
        20,
        expect.stringContaining("merged into")
      );
    });

    it("should comment on target GitHub issue in merge_into mode", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);

      // Add GitHub sync state to target
      repos.issueRepository.update(target.id, {
        githubSync: {
          githubIssueNumber: 30,
          githubUrl: "https://github.com/test/repo/issues/30",
          githubNodeId: "I_test_30",
          syncStatus: "SYNCED",
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: null,
          projectItemId: null,
        },
      });

      await mergeServiceWithGitHub.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "merge_into",
        mergedBy: "test",
      });

      expect(mockGitHubCLI.commentOnIssue).toHaveBeenCalledWith(
        30,
        expect.stringContaining("Merged:")
      );
    });

    it("should handle mixed sync states gracefully", async () => {
      const source = createTestIssue(repos.issueRepository, { title: "Synced Source" });
      const target = createTestIssue(repos.issueRepository, { title: "Not Synced Target" });

      // Only source has GitHub sync
      repos.issueRepository.update(source.id, {
        githubSync: {
          githubIssueNumber: 40,
          githubUrl: "https://github.com/test/repo/issues/40",
          githubNodeId: "I_test_40",
          syncStatus: "SYNCED",
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: null,
          projectItemId: null,
        },
      });
      // Target has no githubSync - should proceed without error

      const result = await mergeServiceWithGitHub.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      // Source gets commented on
      expect(mockGitHubCLI.commentOnIssue).toHaveBeenCalledWith(
        40,
        expect.stringContaining("combined")
      );
      // Target is not synced, so no call for target
      expect(mockGitHubCLI.commentOnIssue).toHaveBeenCalledTimes(1);
      expect(result.resultIssue).toBeDefined();
    });

    it("should preserve task GitHub links when copying", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);
      const sourcePlan = createTestPlan(repos.planRepository, source.id);

      // Create a task with GitHub sync state
      const taskWithGitHub = createTestTask(repos.taskRepository, sourcePlan.id, {
        title: "Task with GitHub",
      });
      repos.taskRepository.updateGitHubSync(taskWithGitHub.id, {
        githubIssueNumber: 100,
        githubUrl: "https://github.com/test/repo/issues/100",
        githubNodeId: "I_test_100",
        syncStatus: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        projectItemId: null,
      });

      const result = await mergeServiceWithGitHub.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      // Find the copied task
      const copiedTask = result.resultTasks.find((t) => t.title.includes("Task with GitHub"));
      expect(copiedTask?.githubSync?.githubIssueNumber).toBe(100);
      expect(copiedTask?.githubSync?.githubUrl).toBe("https://github.com/test/repo/issues/100");
    });

    it("should not fail if GitHub API calls fail", async () => {
      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);

      // Add GitHub sync state to source
      repos.issueRepository.update(source.id, {
        githubSync: {
          githubIssueNumber: 50,
          githubUrl: "https://github.com/test/repo/issues/50",
          githubNodeId: "I_test_50",
          syncStatus: "SYNCED",
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: null,
          projectItemId: null,
        },
      });

      // Make GitHub API call fail
      mockGitHubCLI.commentOnIssue.mockRejectedValue(new Error("GitHub API error"));

      // Should NOT throw - GitHub sync is best-effort
      const result = await mergeServiceWithGitHub.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      expect(result.resultIssue).toBeDefined();
      expect(mockGitHubCLI.commentOnIssue).toHaveBeenCalled();
    });

    it("should not call GitHub when sync is disabled", async () => {
      // Disable GitHub sync
      repos.projectRepository.update(testProjectId, {
        githubSync: {
          enabled: false,
          projectId: undefined,
          labels: undefined,
          columnMapping: undefined,
        },
      });

      const source = createTestIssue(repos.issueRepository);
      const target = createTestIssue(repos.issueRepository);

      // Add GitHub sync state to source
      repos.issueRepository.update(source.id, {
        githubSync: {
          githubIssueNumber: 60,
          githubUrl: "https://github.com/test/repo/issues/60",
          githubNodeId: "I_test_60",
          syncStatus: "SYNCED",
          lastSyncedAt: new Date().toISOString(),
          lastSyncError: null,
          projectItemId: null,
        },
      });

      await mergeServiceWithGitHub.merge({
        sourceIssueNumber: source.number,
        targetIssueNumber: target.number,
        mode: "create_new",
        mergedBy: "test",
      });

      // No GitHub calls when sync is disabled
      expect(mockGitHubCLI.commentOnIssue).not.toHaveBeenCalled();
      expect(mockGitHubCLI.closeIssueWithComment).not.toHaveBeenCalled();
    });
  });
});
