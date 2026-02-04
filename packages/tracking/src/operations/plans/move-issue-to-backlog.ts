/**
 * moveIssueToBacklog - Activate a PLANNED issue by moving tasks to BACKLOG
 *
 * Delegates domain transitions to PlanDomainService.activateIssue() and
 * external sync to ProjectManagementService.syncActivatedTasks().
 */

import { z } from "zod";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { ProjectManagementService } from "../../project-sync/project-management-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const MoveIssueToBacklogSchema = z.object({
  issueNumber: z.number().int().positive(),
  skipGitHubSync: z.boolean().optional(),
});
export type MoveIssueToBacklogInput = z.infer<typeof MoveIssueToBacklogSchema>;

export interface MoveIssueToBacklogResult {
  message: string;
  issueNumber: number;
  issueStatus: string;
  issueTransitioned?: boolean;
  tasksActivated: number;
  githubIssuesCreated: number;
  githubSyncSkipped?: boolean;
  tasks: Array<{
    taskId: string;
    taskNumber: number;
    githubIssueNumber?: number | null;
    githubUrl?: string | null;
  }>;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Move a PLANNED issue to OPEN and activate all PLANNED tasks to BACKLOG.
 */
export function moveIssueToBacklog(input: MoveIssueToBacklogInput) {
  return Effect.gen(function* () {
    const { issueNumber, skipGitHubSync } = validateInput(MoveIssueToBacklogSchema, input);
    const planDomainService = yield* PlanDomainService;
    const pmService = yield* ProjectManagementService;

    const activation = yield* planDomainService.activateIssue(issueNumber);
    const syncResults = yield* pmService.syncActivatedTasks(activation, skipGitHubSync);
    const count = activation.activatedTasks.length;

    return {
      message:
        count > 0
          ? `Issue #${issueNumber} activated. ${count} task(s) moved to BACKLOG.${skipGitHubSync ? " (GitHub sync skipped)" : ""}`
          : `Issue #${issueNumber} is already active with no PLANNED tasks`,
      issueNumber: activation.issue.number,
      issueStatus: activation.issue.status,
      issueTransitioned: activation.issueTransitioned,
      tasksActivated: count,
      githubIssuesCreated: syncResults.filter((t) => t.externalId).length,
      githubSyncSkipped: skipGitHubSync || undefined,
      tasks: syncResults.map((t) => ({
        taskId: t.taskId,
        taskNumber: t.taskNumber,
        githubIssueNumber: t.externalId ? parseInt(t.externalId, 10) : undefined,
        githubUrl: t.externalUrl ?? undefined,
      })),
    } satisfies MoveIssueToBacklogResult;
  });
}
