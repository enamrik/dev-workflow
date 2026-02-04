/**
 * updateIssue - Update an issue's fields
 *
 * Resolves issue by ID or number, applies updates via PlanDomainService,
 * and manages side effects (snapshots, events) directly.
 */

import { z } from "zod";
import type { Issue } from "../../domain/issues/issue.js";
import type { IssueType, IssuePriority } from "../../domain/issues/issue.js";
import type { Plan } from "../../domain/plans/plan.js";
import type { Task } from "../../domain/tasks/task.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { TypeDomainService } from "../../domain/types/type-service.js";
import { BusinessRuleError } from "../../domain/errors.js";
import { VersioningService } from "../../domain/snapshots/versioning-service.js";
import { EventBus } from "../../events/event-bus.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const UpdateIssueSchema = z
  .object({
    projectSlug: z.string().min(1),
    issueId: z.string().optional(),
    issueNumber: z.number().int().positive().optional(),
    updates: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      acceptanceCriteria: z.array(z.string()).optional(),
      type: z.string().optional(),
      priority: z.string().optional(),
      labels: z.record(z.string(), z.string()).nullable().optional(),
    }),
    regeneratePlan: z.boolean().optional().default(false),
  })
  .refine((data) => data.issueId || data.issueNumber, {
    message: "Either issueId or issueNumber is required",
  });
export type UpdateIssueInput = z.infer<typeof UpdateIssueSchema>;

export interface UpdateIssueResult {
  issue: Issue;
  plan?: Plan;
  tasks: Task[];
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Update an issue's fields.
 *
 * 1. Validate input and resolve project domain
 * 2. Resolve issue by ID or number
 * 3. Apply typed updates via PlanDomainService
 * 4. Create snapshot if requested (regeneratePlan)
 * 5. Emit issue:updated event
 */
export function updateIssue(input: UpdateIssueInput) {
  return Effect.gen(function* () {
    const { projectSlug, issueId, issueNumber, updates, regeneratePlan } = validateInput(
      UpdateIssueSchema,
      input
    );
    const domain = yield* DomainExecutorFactory;
    const pd = yield* domain.forProject(projectSlug);
    const eventBus = yield* EventBus;

    // Resolve issue
    const issue = yield* pd.issues.getOne({ byId: issueId, byNumber: issueNumber });

    // Validate the type against available types if provided
    if (updates.type) {
      const typeDomainService = yield* TypeDomainService;
      const isValid = yield* typeDomainService.isValidType(updates.type);
      if (!isValid) {
        const types = yield* typeDomainService.getTypes();
        const availableNames = types.map((t) => t.name).join(", ");
        return yield* Effect.fail(
          new BusinessRuleError(`Invalid type: ${updates.type}. Available types: ${availableNames}`)
        );
      }
    }

    // Apply typed updates via PlanDomainService
    const planDomainService = yield* PlanDomainService;
    const typedUpdates = {
      ...updates,
      type: updates.type as IssueType | undefined,
      priority: updates.priority as IssuePriority | undefined,
    };
    const result = yield* planDomainService.updateIssue(issue.id, typedUpdates);

    // Side effect: create snapshot if requested
    if (regeneratePlan) {
      const versioningService = yield* VersioningService;
      yield* versioningService.createSnapshot(
        issue.number,
        "ISSUE_UPDATE",
        "user",
        "Issue updated"
      );
    }

    eventBus.emit("issue:updated", {
      issueId: issue.id,
      issueNumber: issue.number,
      fields: Object.keys(updates),
    });

    return {
      issue: result.issue,
      plan: result.plan,
      tasks: result.tasks,
    } satisfies UpdateIssueResult;
  });
}
