import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "../../__tests__/setup.js";
import {
  createRepositories,
  createTestIssue,
  createTestPlan,
  createTestTask,
} from "../../__tests__/helpers.js";
import { DependencyService } from "../dependency-service.js";

describe("DependencyService", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof createRepositories>;
  let dependencyService: DependencyService;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);
    dependencyService = new DependencyService(repos.taskRepository);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("areDependenciesSatisfied", () => {
    it("should return true for task with no dependencies", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      const task = createTestTask(repos.taskRepository, plan.id, {
        title: "Task with no deps",
        status: "READY",
      });

      const result = dependencyService.areDependenciesSatisfied(task);

      expect(result).toBe(true);
    });

    it("should return true when all dependencies are COMPLETED", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      // Create dependency task and complete it
      const depTask = createTestTask(repos.taskRepository, plan.id, {
        title: "Dependency Task",
        status: "BACKLOG",
      });
      repos.taskRepository.updateStatus(depTask.id, "IN_PROGRESS");
      repos.taskRepository.updateStatus(depTask.id, "COMPLETED");

      // Create dependent task with dependency
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Dependent Task",
        description: "Task that depends on another",
        status: "READY",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        dependsOn: [depTask.id],
      });

      const result = dependencyService.areDependenciesSatisfied(task);

      expect(result).toBe(true);
    });

    it("should return true when all dependencies are ABANDONED", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      // Create dependency task and abandon it
      const depTask = createTestTask(repos.taskRepository, plan.id, {
        title: "Dependency Task",
        status: "BACKLOG",
      });
      repos.taskRepository.updateStatus(depTask.id, "ABANDONED");

      // Create dependent task with dependency
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Dependent Task",
        description: "Task that depends on another",
        status: "READY",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        dependsOn: [depTask.id],
      });

      const result = dependencyService.areDependenciesSatisfied(task);

      expect(result).toBe(true);
    });

    it("should return false when dependency is IN_PROGRESS", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      // Create dependency task in progress
      const depTask = createTestTask(repos.taskRepository, plan.id, {
        title: "Dependency Task",
        status: "BACKLOG",
      });
      repos.taskRepository.updateStatus(depTask.id, "IN_PROGRESS");

      // Create dependent task with dependency
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Dependent Task",
        description: "Task that depends on another",
        status: "READY",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        dependsOn: [depTask.id],
      });

      const result = dependencyService.areDependenciesSatisfied(task);

      expect(result).toBe(false);
    });

    it("should return false when dependency is BACKLOG", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      // Create dependency task in backlog
      const depTask = createTestTask(repos.taskRepository, plan.id, {
        title: "Dependency Task",
        status: "BACKLOG",
      });

      // Create dependent task with dependency
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Dependent Task",
        description: "Task that depends on another",
        status: "READY",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        dependsOn: [depTask.id],
      });

      const result = dependencyService.areDependenciesSatisfied(task);

      expect(result).toBe(false);
    });

    it("should return false when dependency is READY", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      // Create dependency task that is ready
      const depTask = createTestTask(repos.taskRepository, plan.id, {
        title: "Dependency Task",
        status: "READY",
      });

      // Create dependent task with dependency
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Dependent Task",
        description: "Task that depends on another",
        status: "READY",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        dependsOn: [depTask.id],
      });

      const result = dependencyService.areDependenciesSatisfied(task);

      expect(result).toBe(false);
    });

    it("should return true when mixed COMPLETED and ABANDONED dependencies", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      // Create completed dependency
      const completedDep = createTestTask(repos.taskRepository, plan.id, {
        title: "Completed Dependency",
        status: "BACKLOG",
      });
      repos.taskRepository.updateStatus(completedDep.id, "IN_PROGRESS");
      repos.taskRepository.updateStatus(completedDep.id, "COMPLETED");

      // Create abandoned dependency
      const abandonedDep = createTestTask(repos.taskRepository, plan.id, {
        title: "Abandoned Dependency",
        status: "BACKLOG",
      });
      repos.taskRepository.updateStatus(abandonedDep.id, "ABANDONED");

      // Create dependent task with both dependencies
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Dependent Task",
        description: "Task that depends on two others",
        status: "READY",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        dependsOn: [completedDep.id, abandonedDep.id],
      });

      const result = dependencyService.areDependenciesSatisfied(task);

      expect(result).toBe(true);
    });

    it("should return false when one of multiple dependencies is not satisfied", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      // Create completed dependency
      const completedDep = createTestTask(repos.taskRepository, plan.id, {
        title: "Completed Dependency",
        status: "BACKLOG",
      });
      repos.taskRepository.updateStatus(completedDep.id, "IN_PROGRESS");
      repos.taskRepository.updateStatus(completedDep.id, "COMPLETED");

      // Create in-progress dependency
      const inProgressDep = createTestTask(repos.taskRepository, plan.id, {
        title: "In Progress Dependency",
        status: "BACKLOG",
      });
      repos.taskRepository.updateStatus(inProgressDep.id, "IN_PROGRESS");

      // Create dependent task with both dependencies
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Dependent Task",
        description: "Task that depends on two others",
        status: "READY",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        dependsOn: [completedDep.id, inProgressDep.id],
      });

      const result = dependencyService.areDependenciesSatisfied(task);

      expect(result).toBe(false);
    });
  });

  describe("getBlockingDependencies", () => {
    it("should return empty array for task with no dependencies", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);
      const task = createTestTask(repos.taskRepository, plan.id, {
        title: "Task with no deps",
        status: "READY",
      });

      const blocking = dependencyService.getBlockingDependencies(task);

      expect(blocking).toEqual([]);
    });

    it("should return empty array when all dependencies are satisfied", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      // Create completed dependency
      const depTask = createTestTask(repos.taskRepository, plan.id, {
        title: "Dependency Task",
        status: "BACKLOG",
      });
      repos.taskRepository.updateStatus(depTask.id, "IN_PROGRESS");
      repos.taskRepository.updateStatus(depTask.id, "COMPLETED");

      // Create dependent task
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Dependent Task",
        description: "Task that depends on another",
        status: "READY",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        dependsOn: [depTask.id],
      });

      const blocking = dependencyService.getBlockingDependencies(task);

      expect(blocking).toEqual([]);
    });

    it("should return blocking dependencies", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      // Create in-progress dependency
      const depTask = createTestTask(repos.taskRepository, plan.id, {
        title: "Dependency Task",
        status: "BACKLOG",
      });
      repos.taskRepository.updateStatus(depTask.id, "IN_PROGRESS");

      // Create dependent task
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Dependent Task",
        description: "Task that depends on another",
        status: "READY",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        dependsOn: [depTask.id],
      });

      const blocking = dependencyService.getBlockingDependencies(task);

      expect(blocking).toHaveLength(1);
      expect(blocking[0]!.id).toBe(depTask.id);
    });

    it("should only return blocking dependencies, not satisfied ones", () => {
      const issue = createTestIssue(repos.issueRepository);
      const plan = createTestPlan(repos.planRepository, issue.id);

      // Create completed dependency
      const completedDep = createTestTask(repos.taskRepository, plan.id, {
        title: "Completed Dependency",
        status: "BACKLOG",
      });
      repos.taskRepository.updateStatus(completedDep.id, "IN_PROGRESS");
      repos.taskRepository.updateStatus(completedDep.id, "COMPLETED");

      // Create in-progress dependency
      const inProgressDep = createTestTask(repos.taskRepository, plan.id, {
        title: "In Progress Dependency",
        status: "BACKLOG",
      });
      repos.taskRepository.updateStatus(inProgressDep.id, "IN_PROGRESS");

      // Create dependent task with both dependencies
      const task = repos.taskRepository.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Dependent Task",
        description: "Task that depends on two others",
        status: "READY",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
        dependsOn: [completedDep.id, inProgressDep.id],
      });

      const blocking = dependencyService.getBlockingDependencies(task);

      expect(blocking).toHaveLength(1);
      expect(blocking[0]!.id).toBe(inProgressDep.id);
    });
  });
});
