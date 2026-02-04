/**
 * repairIssue - Repair external sync state for all tasks in an issue
 *
 * Coordinates domain services (data loading, persistence) with
 * ProjectManagementService (external sync work).
 */

import { z } from "zod";
import type { RepairSyncResult } from "../../project-sync/project-management-service.js";
import { ProjectManagementService } from "../../project-sync/project-management-service.js";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { EntityNotFoundError, BusinessRuleError } from "../../domain/errors.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const RepairIssueSchema = z.object({
  issueNumber: z.number().int().positive(),
});
export type RepairIssueInput = z.infer<typeof RepairIssueSchema>;

export interface RepairIssueResult {
  message: string;
  issueNumber: number;
  tasksProcessed: number;
  created: RepairSyncResult["created"];
  linked: RepairSyncResult["linked"];
  verified: RepairSyncResult["verified"];
  skipped: RepairSyncResult["skipped"];
}

// =============================================================================
// Operation
// =============================================================================

export function repairIssue(input: RepairIssueInput) {
  return Effect.gen(function* () {
    const { issueNumber } = validateInput(RepairIssueSchema, input);
    const issueDomainService = yield* IssueDomainService;
    const planDomainService = yield* PlanDomainService;
    const taskDomainService = yield* TaskDomainService;
    const pmService = yield* ProjectManagementService;

    if (!pmService.isEnabled()) {
      return yield* Effect.fail(
        new BusinessRuleError("GitHub sync is not enabled for this project")
      );
    }

    const issue = yield* issueDomainService.findByNumber(issueNumber);
    if (!issue) {
      return yield* Effect.fail(new EntityNotFoundError("Issue", `#${issueNumber}`));
    }

    const plan = yield* planDomainService.findByIssueId(issue.id);
    if (!plan) {
      return yield* Effect.fail(new EntityNotFoundError("Plan", `for issue #${issueNumber}`));
    }

    const allTasks = yield* taskDomainService.findByPlanId(plan.id);
    const tasksToSync = allTasks.filter((t) => t.isWorkable || t.isActive);

    const { syncStateUpdates, ...repairResult } = yield* pmService.repairTasksSync(
      issue,
      tasksToSync
    );

    for (const { taskId, syncState } of syncStateUpdates) {
      yield* taskDomainService.updateSyncState(taskId, syncState);
    }

    const parts = [
      repairResult.created.length > 0 ? `${repairResult.created.length} created` : null,
      repairResult.linked.length > 0 ? `${repairResult.linked.length} linked` : null,
      repairResult.verified.length > 0 ? `${repairResult.verified.length} verified` : null,
      repairResult.skipped.length > 0 ? `${repairResult.skipped.length} skipped` : null,
    ].filter(Boolean);

    return {
      message: `Issue #${issueNumber} sync complete: ${parts.length > 0 ? parts.join(", ") : "no tasks to sync"}`,
      issueNumber,
      ...repairResult,
    } satisfies RepairIssueResult;
  });
}
