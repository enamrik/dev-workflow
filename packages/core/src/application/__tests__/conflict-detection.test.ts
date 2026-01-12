import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../__tests__/setup.js";
import {
  createTestIssue,
  createTestPlan,
  createTestTask,
  completeTask,
} from "../../__tests__/helpers.js";
import { ConflictDetectionService } from "../conflict-detection-service.js";
import { taskExecutionLogs } from "../../infrastructure/database/schema.js";

describe("ConflictDetectionService", () => {
  let testDb: TestDatabase;
  let conflictService: ConflictDetectionService;
  let planId: string;

  beforeEach(() => {
    testDb = createTestDatabase();

    // Create issue and plan
    const issue = createTestIssue(testDb.client.issues);
    const plan = createTestPlan(testDb.client.plans, issue.id);
    planId = plan.id;

    // Create conflict detection service
    conflictService = new ConflictDetectionService(testDb.client);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("detectConflicts", () => {
    it("should return no conflicts when no prior tasks are completed", () => {
      // Create two tasks, both BACKLOG
      createTestTask(testDb.client.tasks, planId, { title: "Task 1" });
      const task2 = createTestTask(testDb.client.tasks, planId, { title: "Task 2" });

      // Task 1 is still BACKLOG, so no conflicts
      const result = conflictService.detectConflicts(task2.id);

      expect(result.hasConflicts).toBe(false);
      expect(result.warnings).toHaveLength(0);
      expect(result.priorTaskFiles.size).toBe(0);
    });

    it("should return no conflicts when completed tasks have no logged file modifications", () => {
      const task1 = createTestTask(testDb.client.tasks, planId, { title: "Task 1" });
      const task2 = createTestTask(testDb.client.tasks, planId, { title: "Task 2" });

      // Complete task 1 without logging any file modifications
      completeTask(testDb.client.tasks, task1.id, "session-1", "Completed");

      const result = conflictService.detectConflicts(task2.id);

      expect(result.hasConflicts).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it("should detect conflicts when prior task modified files mentioned in current task", () => {
      // Create tasks where task 2 mentions a file that task 1 modified
      const task1 = createTestTask(testDb.client.tasks, planId, { title: "Task 1" });
      const task2 = createTestTask(testDb.client.tasks, planId, {
        title: "Task 2",
        description: "Update the src/components/Button.tsx component",
      });

      // Complete task 1 and log file modification
      completeTask(testDb.client.tasks, task1.id, "session-1", "Completed");

      // Log that task 1 modified src/components/Button.tsx
      testDb.db
        .insert(taskExecutionLogs)
        .values({
          id: crypto.randomUUID(),
          taskId: task1.id,
          sessionId: "session-1",
          message: "Updated Button component",
          filesModified: ["src/components/Button.tsx"],
          createdAt: new Date().toISOString(),
        })
        .run();

      const result = conflictService.detectConflicts(task2.id);

      expect(result.hasConflicts).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.filePath).toBe("src/components/Button.tsx");
      expect(result.warnings[0]?.modifiedBy).toHaveLength(1);
      expect(result.warnings[0]?.modifiedBy[0]?.taskNumber).toBe(task1.number);
    });

    it("should detect conflicts based on directory overlap", () => {
      const task1 = createTestTask(testDb.client.tasks, planId, { title: "Task 1" });
      const task2 = createTestTask(testDb.client.tasks, planId, {
        title: "Task 2",
        // Use a file path that shares a directory with the modified files
        description: "Update src/components/Nav.tsx to add navigation",
      });

      completeTask(testDb.client.tasks, task1.id, "session-1", "Completed");

      testDb.db
        .insert(taskExecutionLogs)
        .values({
          id: crypto.randomUUID(),
          taskId: task1.id,
          sessionId: "session-1",
          message: "Modified files in components",
          filesModified: ["src/components/Header.tsx", "src/components/Footer.tsx"],
          createdAt: new Date().toISOString(),
        })
        .run();

      const result = conflictService.detectConflicts(task2.id);

      expect(result.hasConflicts).toBe(true);
      // Files share the same directory (src/components), so should detect overlap
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("should not detect conflicts for unrelated files", () => {
      const task1 = createTestTask(testDb.client.tasks, planId, { title: "Task 1" });
      const task2 = createTestTask(testDb.client.tasks, planId, {
        title: "Task 2",
        description: "Work on src/api/users.ts",
      });

      completeTask(testDb.client.tasks, task1.id, "session-1", "Completed");

      testDb.db
        .insert(taskExecutionLogs)
        .values({
          id: crypto.randomUUID(),
          taskId: task1.id,
          sessionId: "session-1",
          message: "Modified auth",
          filesModified: ["src/auth/login.ts"],
          createdAt: new Date().toISOString(),
        })
        .run();

      const result = conflictService.detectConflicts(task2.id);

      expect(result.hasConflicts).toBe(false);
    });

    it("should aggregate multiple tasks that modified the same file", () => {
      const task1 = createTestTask(testDb.client.tasks, planId, { title: "Task 1" });
      const task2 = createTestTask(testDb.client.tasks, planId, { title: "Task 2" });
      const task3 = createTestTask(testDb.client.tasks, planId, {
        title: "Task 3",
        description: "Update src/index.ts",
      });

      // Complete task 1 and 2, both modify the same file
      completeTask(testDb.client.tasks, task1.id, "session-1", "Completed");
      completeTask(testDb.client.tasks, task2.id, "session-2", "Completed");

      testDb.db
        .insert(taskExecutionLogs)
        .values({
          id: crypto.randomUUID(),
          taskId: task1.id,
          sessionId: "session-1",
          message: "Initial index update",
          filesModified: ["src/index.ts"],
          createdAt: new Date().toISOString(),
        })
        .run();

      testDb.db
        .insert(taskExecutionLogs)
        .values({
          id: crypto.randomUUID(),
          taskId: task2.id,
          sessionId: "session-2",
          message: "Follow-up index update",
          filesModified: ["src/index.ts"],
          createdAt: new Date().toISOString(),
        })
        .run();

      const result = conflictService.detectConflicts(task3.id);

      expect(result.hasConflicts).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.modifiedBy).toHaveLength(2);
    });

    it("should throw error for non-existent task", () => {
      expect(() => {
        conflictService.detectConflicts("non-existent-id");
      }).toThrow("Task not found");
    });
  });

  describe("getModifiedFilesForPlan", () => {
    it("should return empty map when no tasks are completed", () => {
      createTestTask(testDb.client.tasks, planId, { title: "Task 1" });

      const result = conflictService.getModifiedFilesForPlan(planId);

      expect(result.size).toBe(0);
    });

    it("should return all files modified by completed tasks", () => {
      const task1 = createTestTask(testDb.client.tasks, planId, { title: "Task 1" });
      const task2 = createTestTask(testDb.client.tasks, planId, { title: "Task 2" });

      completeTask(testDb.client.tasks, task1.id, "session-1", "Completed");
      completeTask(testDb.client.tasks, task2.id, "session-2", "Completed");

      testDb.db
        .insert(taskExecutionLogs)
        .values({
          id: crypto.randomUUID(),
          taskId: task1.id,
          sessionId: "session-1",
          message: "First task",
          filesModified: ["src/a.ts", "src/b.ts"],
          createdAt: new Date().toISOString(),
        })
        .run();

      testDb.db
        .insert(taskExecutionLogs)
        .values({
          id: crypto.randomUUID(),
          taskId: task2.id,
          sessionId: "session-2",
          message: "Second task",
          filesModified: ["src/c.ts"],
          createdAt: new Date().toISOString(),
        })
        .run();

      const result = conflictService.getModifiedFilesForPlan(planId);

      expect(result.size).toBe(3);
      expect(result.has("src/a.ts")).toBe(true);
      expect(result.has("src/b.ts")).toBe(true);
      expect(result.has("src/c.ts")).toBe(true);
    });

    it("should track multiple modifications to same file", () => {
      const task1 = createTestTask(testDb.client.tasks, planId, { title: "Task 1" });
      const task2 = createTestTask(testDb.client.tasks, planId, { title: "Task 2" });

      completeTask(testDb.client.tasks, task1.id, "session-1", "Completed");
      completeTask(testDb.client.tasks, task2.id, "session-2", "Completed");

      testDb.db
        .insert(taskExecutionLogs)
        .values({
          id: crypto.randomUUID(),
          taskId: task1.id,
          sessionId: "session-1",
          message: "First modification",
          filesModified: ["src/shared.ts"],
          createdAt: new Date().toISOString(),
        })
        .run();

      testDb.db
        .insert(taskExecutionLogs)
        .values({
          id: crypto.randomUUID(),
          taskId: task2.id,
          sessionId: "session-2",
          message: "Second modification",
          filesModified: ["src/shared.ts"],
          createdAt: new Date().toISOString(),
        })
        .run();

      const result = conflictService.getModifiedFilesForPlan(planId);

      expect(result.size).toBe(1);
      const modifications = result.get("src/shared.ts");
      expect(modifications).toHaveLength(2);
    });
  });
});
