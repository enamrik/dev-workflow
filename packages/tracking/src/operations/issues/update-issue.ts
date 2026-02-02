/**
 * updateIssue - Update an issue's fields
 *
 * Resolves issue by ID or number, applies updates via PlanningService
 * (which handles snapshot creation), and optionally regenerates the plan.
 */

import { z } from "zod";
import type { Issue } from "../../domain/issues/issue.js";
import type { IssueType, IssuePriority } from "../../domain/issues/issue.js";
import type { Plan } from "../../domain/plans/plan.js";
import type { Task } from "../../domain/tasks/task.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { PlanningService } from "../../domain/plans/planning-service.js";
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
 * 3. Apply typed updates via PlanningService (handles snapshots)
 */
export function updateIssue(input: UpdateIssueInput) {
  return Effect.gen(function* () {
    const { projectSlug, issueId, issueNumber, updates, regeneratePlan } = validateInput(
      UpdateIssueSchema,
      input
    );
    const domain = yield* DomainExecutorFactory;
    const pd = yield* domain.forProject(projectSlug);

    // Resolve issue from ID or number
    const issue = issueId
      ? yield* pd.issues.getOrThrow(issueId)
      : yield* pd.issues.getByNumber(issueNumber!);

    // Apply typed updates via PlanningService
    const planningService = yield* PlanningService;
    const typedUpdates = {
      ...updates,
      type: updates.type as IssueType | undefined,
      priority: updates.priority as IssuePriority | undefined,
    };
    const result = yield* Effect.promise(() =>
      planningService.updateIssue(issue.id, typedUpdates, regeneratePlan)
    );

    return {
      issue: result.issue,
      plan: result.plan,
      tasks: result.tasks,
    } satisfies UpdateIssueResult;
  });
}
