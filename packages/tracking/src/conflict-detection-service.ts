/**
 * Conflict Detection Service
 *
 * Analyzes execution logs from completed tasks to detect potential
 * file conflicts before starting a new task.
 */

import type { Task } from "./domain/tasks/task.js";
import type { DbClient } from "./data-access/db-client.js";
import { Effect, Service } from "@dev-workflow/effect";

/**
 * Information about a file that was modified by a prior task
 */
export interface FileModification {
  readonly filePath: string;
  readonly taskId: string;
  readonly taskNumber: number;
  readonly taskTitle: string;
  readonly modifiedAt: string;
}

/**
 * Conflict warning for a specific file
 */
export interface ConflictWarning {
  readonly filePath: string;
  readonly modifiedBy: Array<{
    taskId: string;
    taskNumber: number;
    taskTitle: string;
  }>;
}

/**
 * Result of conflict detection
 */
export interface ConflictDetectionResult {
  readonly hasConflicts: boolean;
  readonly warnings: ConflictWarning[];
  readonly priorTaskFiles: Map<string, FileModification[]>;
}

/**
 * ConflictDetectionService analyzes execution logs to detect
 * potential file conflicts before starting a task.
 *
 * This is a non-blocking warning system - conflicts don't prevent
 * task execution, they just inform the user of potential issues.
 */
export class ConflictDetectionService extends Service<ConflictDetectionService>()(
  "conflictDetectionService"
) {
  constructor(private readonly db: DbClient) {
    super();
  }

  /**
   * Detect potential conflicts for a task by analyzing
   * files modified by completed tasks in the same plan.
   *
   * @param taskId - The task to check for conflicts
   * @returns ConflictDetectionResult with warnings if conflicts found
   */
  async detectConflicts(taskId: string): Promise<ConflictDetectionResult> {
    const task = await Effect.runPromise(this.db.tasks.findById(taskId));
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Get all completed tasks in the same plan
    const planTasks = await Effect.runPromise(this.db.tasks.findByPlanId(task.planId));
    const completedTaskIds = planTasks
      .filter((t) => t.status === "COMPLETED" && t.id !== taskId)
      .map((t) => t.id);

    if (completedTaskIds.length === 0) {
      return {
        hasConflicts: false,
        warnings: [],
        priorTaskFiles: new Map(),
      };
    }

    // Get execution logs with filesModified from completed tasks
    const logs = await this.db.executionLogs.findWithFileModifications(completedTaskIds);

    // Build a map of file paths to the tasks that modified them
    const priorTaskFiles = new Map<string, FileModification[]>();
    const taskMap = new Map(planTasks.map((t) => [t.id, t]));

    for (const log of logs) {
      if (!log.filesModified || log.filesModified.length === 0) {
        continue;
      }

      const logTask = taskMap.get(log.taskId);
      if (!logTask) continue;

      for (const filePath of log.filesModified) {
        const existing = priorTaskFiles.get(filePath) || [];
        existing.push({
          filePath,
          taskId: log.taskId,
          taskNumber: logTask.number,
          taskTitle: logTask.title,
          modifiedAt: log.createdAt,
        });
        priorTaskFiles.set(filePath, existing);
      }
    }

    // Check if the new task might touch files that were already modified
    // We infer potential files from task description and acceptance criteria
    const potentialFiles = this.inferPotentialFiles(task);
    const warnings: ConflictWarning[] = [];

    // Look for overlaps between potential files and prior modifications
    for (const potentialFile of potentialFiles) {
      // Check for exact matches or pattern matches
      for (const [modifiedFile, modifications] of priorTaskFiles) {
        if (this.filesOverlap(potentialFile, modifiedFile)) {
          // Check if we already have a warning for this file
          const existingWarning = warnings.find((w) => w.filePath === modifiedFile);
          if (!existingWarning) {
            warnings.push({
              filePath: modifiedFile,
              modifiedBy: modifications.map((m) => ({
                taskId: m.taskId,
                taskNumber: m.taskNumber,
                taskTitle: m.taskTitle,
              })),
            });
          }
        }
      }
    }

    return {
      hasConflicts: warnings.length > 0,
      warnings,
      priorTaskFiles,
    };
  }

  /**
   * Get all files modified by completed tasks in a plan.
   * Useful for providing context about what files have been touched.
   *
   * @param planId - The plan to analyze
   * @returns Map of file paths to their modifications
   */
  async getModifiedFilesForPlan(planId: string): Promise<Map<string, FileModification[]>> {
    const planTasks = await Effect.runPromise(this.db.tasks.findByPlanId(planId));
    const completedTaskIds = planTasks.filter((t) => t.status === "COMPLETED").map((t) => t.id);

    if (completedTaskIds.length === 0) {
      return new Map();
    }

    const logs = await this.db.executionLogs.findWithFileModifications(completedTaskIds);

    const fileMap = new Map<string, FileModification[]>();
    const taskMap = new Map(planTasks.map((t) => [t.id, t]));

    for (const log of logs) {
      if (!log.filesModified || log.filesModified.length === 0) {
        continue;
      }

      const logTask = taskMap.get(log.taskId);
      if (!logTask) continue;

      for (const filePath of log.filesModified) {
        const existing = fileMap.get(filePath) || [];
        existing.push({
          filePath,
          taskId: log.taskId,
          taskNumber: logTask.number,
          taskTitle: logTask.title,
          modifiedAt: log.createdAt,
        });
        fileMap.set(filePath, existing);
      }
    }

    return fileMap;
  }

  /**
   * Infer potential file paths that a task might modify
   * based on its description and acceptance criteria.
   *
   * This is heuristic-based and may have false positives/negatives.
   */
  private inferPotentialFiles(task: Task): string[] {
    const potentialFiles: Set<string> = new Set();

    // Combine description and acceptance criteria
    const text = [
      task.title,
      task.description,
      ...task.acceptanceCriteria,
      task.implementationPlan || "",
    ].join(" ");

    // Look for file path patterns in the text
    const filePatterns = [
      // Explicit paths: src/foo/bar.ts, ./components/Button.tsx
      /(?:^|[\s`"'(])([./]?(?:src|lib|app|components|pages|api|utils|hooks|services|domain|infrastructure|application|test|tests|__tests__|e2e)\/[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+)/g,
      // Package paths: @package/module
      /(@[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+)/g,
    ];

    for (const pattern of filePatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          potentialFiles.add(match[1].trim());
        }
      }
    }

    // Also extract directory patterns for broader matching
    const dirPatterns = [
      /(?:in|to|from|at|update|modify|create|add)\s+(?:the\s+)?[`"]?([a-zA-Z0-9_/-]+(?:\/[a-zA-Z0-9_/-]+)+)[`"]?/gi,
    ];

    for (const pattern of dirPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          potentialFiles.add(match[1].trim());
        }
      }
    }

    return Array.from(potentialFiles);
  }

  /**
   * Check if two file paths might overlap (exact match or directory overlap)
   */
  private filesOverlap(potentialFile: string, modifiedFile: string): boolean {
    // Normalize paths
    const normalizedPotential = potentialFile.replace(/^\.\//, "");
    const normalizedModified = modifiedFile.replace(/^\.\//, "");

    // Exact match
    if (normalizedPotential === normalizedModified) {
      return true;
    }

    // Check if potential is a directory that contains the modified file
    if (normalizedModified.startsWith(normalizedPotential + "/")) {
      return true;
    }

    // Check if modified is a directory that contains the potential file
    if (normalizedPotential.startsWith(normalizedModified + "/")) {
      return true;
    }

    // Check if they share a common directory (within 2 levels)
    const potentialParts = normalizedPotential.split("/");
    const modifiedParts = normalizedModified.split("/");

    // If both have at least 2 parts and first 2 match, might be related
    if (potentialParts.length >= 2 && modifiedParts.length >= 2) {
      if (potentialParts[0] === modifiedParts[0] && potentialParts[1] === modifiedParts[1]) {
        return true;
      }
    }

    return false;
  }
}
