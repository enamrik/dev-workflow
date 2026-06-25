/**
 * updateTask - Update a task's properties
 *
 * Updates task fields including title, description, acceptance criteria,
 * implementation plan, estimated minutes, and labels. Labels are merged
 * with existing labels (null values remove labels).
 */

import { z } from "zod";
import type { Task } from "../../domain/tasks/task.js";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { EntityNotFoundError } from "../../domain/errors.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema
// =============================================================================

export const updateTaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  implementationPlan: z.string().optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  labels: z.record(z.string(), z.string().nullable()).optional(),
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

// =============================================================================
// Types
// =============================================================================

export interface UpdateTaskResult {
  success: boolean;
  task: Task;
}

// =============================================================================
// Operation
// =============================================================================

export function updateTask(input: UpdateTaskInput) {
  return Effect.gen(function* () {
    const {
      taskId,
      title,
      description,
      acceptanceCriteria,
      implementationPlan,
      estimatedMinutes,
      labels,
    } = validateInput(updateTaskSchema, input);

    const taskDomainService = yield* TaskDomainService;

    const task = yield* taskDomainService.findById(taskId);
    if (!task) {
      return yield* Effect.fail(new EntityNotFoundError("Task", taskId));
    }

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (acceptanceCriteria !== undefined) updates.acceptanceCriteria = acceptanceCriteria;
    if (implementationPlan !== undefined) updates.implementationPlan = implementationPlan;
    if (estimatedMinutes !== undefined) updates.estimatedMinutes = estimatedMinutes;

    // Handle labels - merge with existing, null values remove labels
    if (labels !== undefined) {
      const currentLabels = task.labels ?? {};
      const mergedLabels: Record<string, string> = { ...currentLabels };

      for (const [key, value] of Object.entries(labels)) {
        if (value === null) {
          // Remove the label
          delete mergedLabels[key];
        } else {
          // Add or update the label
          mergedLabels[key] = value;
        }
      }

      // Use null to clear the field (undefined is ignored by Drizzle spread)
      updates.labels = Object.keys(mergedLabels).length > 0 ? mergedLabels : null;
    }

    const updatedTask = yield* taskDomainService.update(taskId, updates);

    return {
      success: true,
      task: updatedTask,
    } satisfies UpdateTaskResult;
  });
}
