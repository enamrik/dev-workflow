/**
 * changeIssueType - Change an issue's type after validation
 *
 * Validates the new type against available types (from TypeService or defaults),
 * then applies the change via PlanDomainService.
 */

import { z } from "zod";
import type { Issue, IssueType } from "../../domain/issues/issue.js";
import type { Plan } from "../../domain/plans/plan.js";
import type { Task } from "../../domain/tasks/task.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { TypeDomainService } from "../../domain/types/type-service.js";
import { BusinessRuleError } from "../../domain/errors.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const ChangeIssueTypeSchema = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.number().int().positive(),
  type: z.string().min(1),
});
export type ChangeIssueTypeInput = z.infer<typeof ChangeIssueTypeSchema>;

export interface ChangeIssueTypeResult {
  issue: Issue;
  plan?: Plan;
  tasks: Task[];
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Change an issue's type.
 *
 * 1. Validate input and resolve project domain
 * 2. Find the issue by number
 * 3. Validate the new type against available types
 * 4. Apply type change via PlanDomainService
 */
export function changeIssueType(input: ChangeIssueTypeInput) {
  return Effect.gen(function* () {
    const { projectSlug, issueNumber, type } = validateInput(ChangeIssueTypeSchema, input);
    const domain = yield* DomainExecutorFactory;
    const pd = yield* domain.forProject(projectSlug);

    // Find the issue
    const issue = yield* pd.issues.getByNumber(issueNumber);

    // Validate the type against available types
    const defaultValidTypes = ["FEATURE", "BUG", "ENHANCEMENT", "TASK"];
    const typeDomainService = yield* TypeDomainService;

    const typeDefinitions = yield* typeDomainService.loadTypes();
    const availableTypes = typeDefinitions.types.map((t) => t.name);

    if (availableTypes.length > 0) {
      if (!availableTypes.includes(type as IssueType)) {
        return yield* Effect.fail(
          new BusinessRuleError(
            `Invalid type: ${type}. Available types: ${availableTypes.join(", ")}`
          )
        );
      }
    } else {
      // Fall back to hardcoded validation if no types defined
      if (!defaultValidTypes.includes(type)) {
        return yield* Effect.fail(
          new BusinessRuleError(
            `Invalid type: ${type}. Available types: ${defaultValidTypes.join(", ")}`
          )
        );
      }
    }

    // Apply the type change via PlanDomainService (no snapshot for type-only change)
    const planDomainService = yield* PlanDomainService;
    const result = yield* planDomainService.updateIssue(issue.id, { type: type as IssueType });

    return {
      issue: result.issue,
      plan: result.plan,
      tasks: result.tasks,
    } satisfies ChangeIssueTypeResult;
  });
}
