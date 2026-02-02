/**
 * updateTask - Update a task's properties
 *
 * Updates task fields including title, description, acceptance criteria,
 * implementation plan, estimated minutes, and labels. Labels are validated
 * against available labels from the project management provider and merged
 * with existing labels (null values remove labels).
 */

import { z } from "zod";
import type { Task } from "../../domain/tasks/task.js";
import type { AvailableLabel } from "../../project-sync/project-management-provider.js";
import { TaskService } from "../../domain/tasks/task-service.js";
import { ProjectManagementRegistry } from "../../project-sync/provider-registry.js";
import { GitHubCLITag } from "../../project-sync/github/github-cli.js";
import type { GitHubCLI } from "../../project-sync/github/github-cli.js";
import { DbSourceTag } from "../../data-access/db-source.js";
import type { DbSource } from "../../data-access/db-source.js";
import { ProjectTag } from "../../domain/projects/project.js";
import type { Project } from "../../domain/projects/project.js";
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
// Helpers
// =============================================================================

async function validateLabels(
  labels: Record<string, string | null>,
  providerRegistry: ProjectManagementRegistry | null,
  project: Project | null,
  dbSource: DbSource | null,
  githubCLI: GitHubCLI | null
): Promise<string | null> {
  // Skip validation if provider context is not available
  if (!providerRegistry || !project || !dbSource || !githubCLI) {
    return null; // Graceful degradation - no validation
  }

  // Re-fetch project to get latest config
  const latestProject = await dbSource.projects.findById(project.id);
  if (!latestProject) {
    return null; // Project not found - graceful degradation
  }

  // Get available labels from provider
  const provider = providerRegistry.createProvider(latestProject, {
    githubCLI,
  });

  const result = await provider.getAvailableLabels();

  if (!result.supported || result.error) {
    return null; // Provider doesn't support labels or errored - no validation
  }

  // Build lookup map for efficient validation
  const availableLabelsMap = new Map<string, AvailableLabel>();
  for (const label of result.labels) {
    availableLabelsMap.set(label.name.toLowerCase(), label);
  }

  // Validate each label being set (ignore null values - those are removals)
  const errors: string[] = [];
  for (const [name, value] of Object.entries(labels)) {
    if (value === null) continue; // Removal - no validation needed

    const availableLabel = availableLabelsMap.get(name.toLowerCase());

    if (!availableLabel) {
      const availableNames = result.labels.map((l) => l.name).join(", ");
      errors.push(`Unknown label "${name}". Available labels: ${availableNames}`);
      continue;
    }

    // Check if value is valid (if label has constrained values)
    if (availableLabel.validValues !== null && value !== "") {
      const validValuesLower = availableLabel.validValues.map((v) => v.toLowerCase());
      if (!validValuesLower.includes(value.toLowerCase())) {
        errors.push(
          `Invalid value "${value}" for label "${name}". Valid values: ${availableLabel.validValues.join(", ")}`
        );
      }
    }
  }

  return errors.length > 0 ? errors.join("; ") : null;
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

    const taskService = yield* TaskService;

    // These are nullable dependencies - try to resolve, fall back to null
    let providerRegistry: ProjectManagementRegistry | null = null;
    let project: Project | null = null;
    let dbSource: DbSource | null = null;
    let githubCLI: GitHubCLI | null = null;

    try {
      providerRegistry = yield* ProjectManagementRegistry;
    } catch {
      // Optional dependency
    }
    try {
      project = yield* ProjectTag;
    } catch {
      // Optional dependency
    }
    try {
      dbSource = yield* DbSourceTag;
    } catch {
      // Optional dependency
    }
    try {
      githubCLI = yield* GitHubCLITag;
    } catch {
      // Optional dependency
    }

    const task = yield* Effect.promise(() => taskService.findById(taskId));
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (acceptanceCriteria !== undefined) updates.acceptanceCriteria = acceptanceCriteria;
    if (implementationPlan !== undefined) updates.implementationPlan = implementationPlan;
    if (estimatedMinutes !== undefined) updates.estimatedMinutes = estimatedMinutes;

    // Handle labels - validate and merge with existing, null values remove labels
    if (labels !== undefined) {
      // Validate labels against available labels from provider
      const validationError = yield* Effect.promise(() =>
        validateLabels(labels, providerRegistry, project, dbSource, githubCLI)
      );
      if (validationError) {
        throw new Error(`Label validation failed: ${validationError}`);
      }

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

    const updatedTask = yield* Effect.promise(() => taskService.update(taskId, updates));

    return {
      success: true,
      task: updatedTask,
    } satisfies UpdateTaskResult;
  });
}
