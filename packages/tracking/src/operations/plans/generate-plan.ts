/**
 * generatePlan - Generate a plan for an issue with tasks
 *
 * Thin orchestrator: resolves issue, delegates to PlanDomainService,
 * then handles side effects (snapshot, events).
 */

import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { VersioningService } from "../../domain/snapshots/versioning-service.js";
import { EventBus } from "../../events/event-bus.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";
import { z } from "zod";

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
 * 2. Resolve issue via specification pattern
 * 3. Delegate to PlanDomainService (type/dep validation + normalization inside)
 * 4. Side effect: post-regeneration snapshot
 * 5. Side effects: events
 */
export function generatePlan(input: GeneratePlanInput) {
  return Effect.gen(function* () {
    const { issueId, issueNumber, summary, approach, tasks, estimatedComplexity, projectSlug } =
      validateInput(GeneratePlanSchema, input);
    const issueDomainService = yield* IssueDomainService;
    const planDomainService = yield* PlanDomainService;
    const versioningService = yield* VersioningService;
    const eventBus = yield* EventBus;

    // 1. Resolve issue (specification pattern)
    const issue = yield* issueDomainService.getOne({ byId: issueId, byNumber: issueNumber });

    // 2. Domain logic (type validation, dep validation, normalization all inside)
    const result = yield* planDomainService.savePlan({
      issueId: issue.id,
      summary,
      approach,
      tasks,
      estimatedComplexity,
      generatedBy: "claude-agent",
    });

    // 3. Side effect: post-regeneration snapshot
    yield* versioningService.createSnapshot(
      issue.number,
      "PLAN_REGENERATION",
      "claude-agent",
      `Generated plan: ${summary}`
    );

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
