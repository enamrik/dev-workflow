/**
 * generatePlan - Generate a plan for an issue with tasks
 *
 * Validates task types and dependency references, normalizes task data,
 * then delegates to PlanDomainService for plan creation with smart matching.
 * Side effects (snapshots, events) are owned by this operation.
 */

import { z } from "zod";
import type { IssueType } from "../../domain/issues/issue.js";
import { IssueService } from "../../domain/issues/issue-service.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { VersioningService } from "../../domain/snapshots/versioning-service.js";
import { TypeService } from "../../domain/types/type-service.js";
import { EventBus } from "../../events/event-bus.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const GeneratePlanSchema = z.object({
  issueId: z.string().optional(),
  issueNumber: z.number().int().positive().optional(),
  summary: z.string().min(1),
  approach: z.string().min(1),
  tasks: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().min(1),
        type: z.string().min(1),
        acceptanceCriteria: z.array(z.string()).optional(),
        estimatedMinutes: z.number().positive().optional(),
        dependsOn: z.array(z.string()).optional(),
        implementationPlan: z.string().optional(),
      })
    )
    .min(1),
  estimatedComplexity: z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]),
  projectSlug: z.string().min(1),
});
export type GeneratePlanInput = z.infer<typeof GeneratePlanSchema>;

export interface GeneratePlanResult {
  plan: unknown;
  tasks: unknown[];
  url: string;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Generate a plan for an issue.
 *
 * 1. Validate input schema
 * 2. Resolve issue from issueId or issueNumber
 * 3. Validate task types against available types
 * 4. Validate dependsOn references
 * 5. Create pre-regeneration snapshot
 * 6. Normalize tasks and delegate to PlanDomainService
 * 7. Create post-regeneration snapshot
 * 8. Emit plan:generated and task:created events
 */
export function generatePlan(input: GeneratePlanInput) {
  return Effect.gen(function* () {
    const { issueId, issueNumber, summary, approach, tasks, estimatedComplexity, projectSlug } =
      validateInput(GeneratePlanSchema, input);
    const issueService = yield* IssueService;
    const planDomainService = yield* PlanDomainService;
    const versioningService = yield* VersioningService;
    const typeService = yield* TypeService;

    // 1. Resolve issue from ID or number
    const issue = issueId
      ? yield* issueService.findById(issueId)
      : issueNumber
        ? yield* issueService.findByNumber(issueNumber)
        : null;

    if (!issue) {
      throw new Error(
        issueId
          ? `Issue not found: ${issueId}`
          : issueNumber
            ? `Issue not found: #${issueNumber}`
            : "Either issueId or issueNumber is required"
      );
    }

    // 2. Validate task types
    const validTypes = yield* typeService.getTypes();
    const validTypeNames = validTypes.map((t) => t.name);

    for (const task of tasks) {
      if (!task.type) {
        throw new Error(
          `Task '${task.id}' is missing required 'type' field. ` +
            `Valid types: ${validTypeNames.join(", ")}. ` +
            `Call list_types first to get available types.`
        );
      }

      const isValid = yield* typeService.isValidType(task.type);
      if (!isValid) {
        throw new Error(
          `Task '${task.id}' has invalid type '${task.type}'. ` +
            `Valid types: ${validTypeNames.join(", ")}. ` +
            `Call list_types first to get available types.`
        );
      }
    }

    // 3. Validate dependsOn references
    const taskIds = new Set(tasks.map((t) => t.id));
    for (const task of tasks) {
      if (task.dependsOn) {
        for (const depId of task.dependsOn) {
          if (!taskIds.has(depId)) {
            throw new Error(
              `Task '${task.id}' references non-existent dependency '${depId}'. ` +
                `Available task IDs: ${Array.from(taskIds).join(", ")}`
            );
          }
        }
      }
    }

    // 4. Normalize tasks
    const normalizedTasks = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      type: t.type as IssueType,
      acceptanceCriteria: t.acceptanceCriteria ?? [],
      estimatedMinutes: t.estimatedMinutes,
      dependsOn: t.dependsOn,
      implementationPlan: t.implementationPlan,
    }));

    // 5. Side effect: pre-regeneration snapshot
    yield* versioningService.createSnapshot(
      issue.number,
      "PLAN_REGENERATION",
      "claude-agent",
      "Pre-regeneration snapshot"
    );

    // 6. Domain logic: save plan
    const result = yield* planDomainService.savePlan({
      issueId: issue.id,
      summary,
      approach,
      tasks: normalizedTasks,
      estimatedComplexity,
      generatedBy: "claude-agent",
    });

    // 7. Side effect: post-regeneration snapshot
    yield* versioningService.createSnapshot(
      issue.number,
      "PLAN_REGENERATION",
      "claude-agent",
      `Generated plan: ${summary}`
    );

    // 8. Side effects: events
    const eventBus = EventBus.getInstance();
    eventBus.emit("plan:generated", {
      planId: result.plan.id,
      issueId: issue.id,
      issueNumber: issue.number,
    });
    for (const task of result.tasks) {
      eventBus.emit("task:created", {
        taskId: task.id,
        planId: result.plan.id,
        issueNumber: issue.number,
      });
    }

    return {
      ...result,
      url: `http://127.0.0.1:3456/projects/${projectSlug}/issues/${issue.number}`,
    } satisfies GeneratePlanResult;
  });
}
