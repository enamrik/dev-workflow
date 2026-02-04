/**
 * repairIssue - Repair external sync state for all tasks in an issue
 *
 * Checks that external sync is enabled, then repairs the sync state
 * for each task in the issue. Creates, links, or verifies external
 * issues as needed.
 *
 * Uses TaskDomainService for persistence and ProjectManagementService for
 * external sync (provisionTaskSync handles body/label construction).
 */

import { z } from "zod";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { ProjectManagementService } from "../../project-sync/project-management-service.js";
import type { Issue } from "../../domain/issues/issue.js";
import type { Task } from "../../domain/tasks/task.js";
import { syncStateFromExternalIssue } from "../../project-sync/project-management-provider.js";
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
  created: Array<{
    taskNumber: number;
    githubIssueNumber: number | null;
    githubUrl: string | null;
  }>;
  linked: Array<{ taskNumber: number; githubIssueNumber: number | null; githubUrl: string | null }>;
  verified: Array<{
    taskNumber: number;
    githubIssueNumber: number | null;
    githubUrl: string | null;
  }>;
  skipped: Array<{ taskNumber: number; reason: string | undefined }>;
}

// =============================================================================
// Internal Types
// =============================================================================

interface TaskRepairEntry {
  taskNumber: number;
  action: "created" | "linked" | "verified" | "skipped";
  githubIssueNumber?: number | null;
  githubUrl?: string | null;
  error?: string;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Repair external sync state for an issue.
 *
 * 1. Validate input
 * 2. Verify external sync is enabled via ProjectManagementService
 * 3. Load issue, plan, and tasks via domain services
 * 4. Filter to workable/active tasks
 * 5. For each task, run repair logic (verify, link, or create)
 * 6. Build summary from created/linked/verified/skipped counts
 */
export function repairIssue(input: RepairIssueInput) {
  return Effect.gen(function* () {
    const { issueNumber } = validateInput(RepairIssueSchema, input);
    const issueDomainService = yield* IssueDomainService;
    const taskDomainService = yield* TaskDomainService;
    const planDomainService = yield* PlanDomainService;
    const pm = yield* ProjectManagementService;
    if (!pm.isEnabled()) {
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

    if (tasksToSync.length === 0) {
      return {
        message: `Issue #${issueNumber} sync complete: no tasks to sync`,
        issueNumber,
        tasksProcessed: 0,
        created: [],
        linked: [],
        verified: [],
        skipped: [],
      } satisfies RepairIssueResult;
    }

    const created: TaskRepairEntry[] = [];
    const linked: TaskRepairEntry[] = [];
    const verified: TaskRepairEntry[] = [];
    const skipped: TaskRepairEntry[] = [];
    const errors: TaskRepairEntry[] = [];

    for (const task of tasksToSync) {
      try {
        const repairResult = yield* repairSingleTask(
          issue,
          task,
          tasksToSync.length,
          pm,
          taskDomainService
        );

        switch (repairResult.action) {
          case "created":
            created.push(repairResult);
            break;
          case "linked":
            linked.push(repairResult);
            break;
          case "verified":
            verified.push(repairResult);
            break;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          taskNumber: task.number,
          action: "skipped",
          error: errorMessage,
        });
      }
    }

    if (errors.length > 0) {
      const errorMessages = errors.map((e) => e.error).join("; ");
      return yield* Effect.fail(
        new BusinessRuleError(`Sync completed with errors: ${errorMessages}`)
      );
    }

    const parts: string[] = [];
    if (created.length > 0) {
      parts.push(`${created.length} created`);
    }
    if (linked.length > 0) {
      parts.push(`${linked.length} linked`);
    }
    if (verified.length > 0) {
      parts.push(`${verified.length} verified`);
    }
    if (skipped.length > 0) {
      parts.push(`${skipped.length} skipped`);
    }

    const summary = parts.length > 0 ? parts.join(", ") : "no tasks to sync";

    return {
      message: `Issue #${issueNumber} sync complete: ${summary}`,
      issueNumber,
      tasksProcessed: tasksToSync.length,
      created: created.map((t) => ({
        taskNumber: t.taskNumber,
        githubIssueNumber: t.githubIssueNumber ?? null,
        githubUrl: t.githubUrl ?? null,
      })),
      linked: linked.map((t) => ({
        taskNumber: t.taskNumber,
        githubIssueNumber: t.githubIssueNumber ?? null,
        githubUrl: t.githubUrl ?? null,
      })),
      verified: verified.map((t) => ({
        taskNumber: t.taskNumber,
        githubIssueNumber: t.githubIssueNumber ?? null,
        githubUrl: t.githubUrl ?? null,
      })),
      skipped: skipped.map((t) => ({
        taskNumber: t.taskNumber,
        reason: t.error,
      })),
    } satisfies RepairIssueResult;
  });
}

// =============================================================================
// Per-Task Repair Logic
// =============================================================================

/**
 * Repair sync state for a single task.
 *
 * Case 1: Task has syncState.externalId -> verify issue exists via pm.getIssue().
 *   If exists, ensure project state. If deleted, clear sync state and fall through.
 * Case 2: No sync -> search by title pattern "Task N.M:" via pm.searchIssues().
 *   If found, link it to project.
 * Case 3: No existing -> create new issue, then sync to correct column.
 */
function repairSingleTask(
  issue: Issue,
  task: Task,
  totalTaskCount: number,
  pm: ProjectManagementService,
  taskDomainService: TaskDomainService
) {
  return Effect.gen(function* () {
    if (task.syncState?.externalId) {
      const existingIssue = yield* pm.getIssue(String(task.syncState.externalId));

      if (existingIssue) {
        yield* ensureProjectState(task, pm, taskDomainService);

        return {
          taskNumber: task.number,
          action: "verified" as const,
          githubIssueNumber: existingIssue.numericId ?? parseInt(existingIssue.id, 10),
          githubUrl: existingIssue.url,
        };
      }

      yield* taskDomainService.updateSyncState(task.id, {
        externalId: null,
        externalUrl: null,
        externalNodeId: null,
        syncStatus: "NOT_SYNCED",
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: "External issue was deleted, re-syncing",
        remoteProjectId: null,
      });
    }

    const searchPattern = `Task ${issue.number}.${task.number}:`;
    const searchResults = yield* pm.searchIssues(searchPattern, "all", 5);
    const matchingIssue = searchResults.find((gh) =>
      gh.body.includes(`Task ${issue.number}.${task.number}: ${task.title}`)
    );

    if (matchingIssue) {
      const parentSyncState = syncStateFromExternalIssue(matchingIssue);
      const linked = yield* pm.linkToProject(parentSyncState, task.status, task.labels);
      yield* taskDomainService.updateSyncState(task.id, linked ?? parentSyncState);

      return {
        taskNumber: task.number,
        action: "linked" as const,
        githubIssueNumber: matchingIssue.numericId ?? parseInt(matchingIssue.id, 10),
        githubUrl: matchingIssue.url,
      };
    }

    const syncState = yield* pm.provisionTaskSync({
      issue,
      task,
      totalTaskCount,
      targetStatus: task.status,
    });

    if (syncState) {
      yield* taskDomainService.updateSyncState(task.id, syncState);
      const statusSync = yield* pm.syncTaskStatus(syncState, task.status);
      if (statusSync) {
        yield* taskDomainService.updateSyncState(task.id, statusSync);
      }
    }

    return {
      taskNumber: task.number,
      action: "created" as const,
      githubIssueNumber: syncState?.externalId ? parseInt(syncState.externalId, 10) : undefined,
      githubUrl: syncState?.externalUrl ?? undefined,
    };
  });
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Ensure a task's external issue is in the correct project state.
 *
 * If the task has no project item ID but has a node ID, link to project.
 * If already has project item, sync status column and labels.
 */
function ensureProjectState(
  task: Task,
  pm: ProjectManagementService,
  taskDomainService: TaskDomainService
): Effect<void> {
  return Effect.gen(function* () {
    if (!task.syncState) return;

    if (!task.syncState.remoteProjectId && task.syncState.externalNodeId) {
      const linked = yield* pm.linkToProject(task.syncState, task.status, task.labels);
      if (linked) {
        yield* taskDomainService.updateSyncState(task.id, linked);
      }
    } else if (task.syncState.remoteProjectId) {
      const statusSync = yield* pm.syncTaskStatus(task.syncState, task.status);
      if (statusSync) {
        yield* taskDomainService.updateSyncState(task.id, statusSync);
      }

      const labelSync = yield* pm.syncTaskLabels(task.syncState, task.labels);
      if (labelSync) {
        yield* taskDomainService.updateSyncState(task.id, labelSync);
      }
    }
  });
}
