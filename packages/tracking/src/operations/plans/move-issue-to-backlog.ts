/**
 * moveIssueToBacklog - Activate a PLANNED issue by moving tasks to BACKLOG
 *
 * Transitions a PLANNED issue to OPEN and its PLANNED tasks to BACKLOG.
 * When GitHub sync is enabled, creates external issues for each task.
 * Supports skipGitHubSync to bypass external provider integration.
 */

import { z } from "zod";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { TaskService } from "../../domain/tasks/task-service.js";
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
 *
 * 1. Validate input
 * 2. Get issue and validate status is PLANNED or OPEN
 * 3. Get plan and find PLANNED tasks
 * 4. If no PLANNED tasks and issue already active, return early
 * 5. If GitHub sync enabled: use taskService.activatePlannedTasks
 * 6. If GitHub sync skipped: manually move tasks and transition issue
 */
export function moveIssueToBacklog(input: MoveIssueToBacklogInput) {
  return Effect.gen(function* () {
    const { issueNumber, skipGitHubSync = false } = validateInput(MoveIssueToBacklogSchema, input);
    const issueDomainService = yield* IssueDomainService;
    const planDomainService = yield* PlanDomainService;
    const taskDomainService = yield* TaskDomainService;
    const taskService = yield* TaskService;

    // 1. Get the issue
    const issue = yield* issueDomainService.findByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    // 2. Validate issue status
    if (issue.status !== "PLANNED" && issue.status !== "OPEN") {
      throw new Error(`Issue must be PLANNED or OPEN to activate. Current status: ${issue.status}`);
    }

    // 3. Get the plan
    const plan = yield* planDomainService.findByIssueId(issue.id);
    if (!plan) {
      throw new Error(`No plan found for issue #${issueNumber}`);
    }

    // 4. Get PLANNED tasks
    const allTasks = yield* taskDomainService.findByPlanId(plan.id);
    const plannedTasks = allTasks.filter((t) => t.status === "PLANNED");

    // If no PLANNED tasks and issue is already active, nothing to do
    if (plannedTasks.length === 0 && !issue.isInPlanning) {
      return {
        message: `Issue #${issueNumber} is already active with no PLANNED tasks`,
        issueNumber: issue.number,
        issueStatus: issue.status,
        tasksActivated: 0,
        githubIssuesCreated: 0,
        tasks: [],
      } satisfies MoveIssueToBacklogResult;
    }

    // 5. Use TaskService unless user explicitly skipped GitHub sync
    if (!skipGitHubSync) {
      const result = yield* taskService.activatePlannedTasks(issue.id);

      if (!result.success) {
        throw new Error(result.error ?? "Failed to activate tasks");
      }

      return {
        message: `Issue #${issueNumber} activated. ${result.tasksActivated.length} task(s) moved to BACKLOG.`,
        issueNumber: issue.number,
        issueStatus: result.issueTransitioned ? "OPEN" : issue.status,
        issueTransitioned: result.issueTransitioned,
        tasksActivated: result.tasksActivated.length,
        githubIssuesCreated: result.tasksActivated.filter((t) => t.githubIssueNumber).length,
        tasks: result.tasksActivated.map((t) => ({
          taskId: t.taskId,
          taskNumber: t.taskNumber,
          githubIssueNumber: t.githubIssueNumber,
          githubUrl: t.githubUrl,
        })),
      } satisfies MoveIssueToBacklogResult;
    }

    // 6. No GitHub sync - just move tasks to BACKLOG
    const activatedTasks = [];
    for (const task of plannedTasks) {
      yield* taskDomainService.moveToBacklog(task.id, "system");
      activatedTasks.push({
        taskId: task.id,
        taskNumber: task.number,
      });
    }

    // Transition issue from PLANNED → OPEN
    const issueTransitioned = issue.isInPlanning;
    if (issueTransitioned) {
      yield* issueDomainService.update(issue.id, { status: "OPEN" });
    }

    return {
      message: `Issue #${issueNumber} activated. ${activatedTasks.length} task(s) moved to BACKLOG.${skipGitHubSync ? " (GitHub sync skipped)" : ""}`,
      issueNumber: issue.number,
      issueStatus: issueTransitioned ? "OPEN" : issue.status,
      issueTransitioned,
      tasksActivated: activatedTasks.length,
      githubIssuesCreated: 0,
      githubSyncSkipped: skipGitHubSync,
      tasks: activatedTasks,
    } satisfies MoveIssueToBacklogResult;
  });
}
