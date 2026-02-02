/**
 * getTask - Get task details by ID or by issue+task number
 *
 * Lightweight lookup without full execution context. Returns enriched
 * task data with worker info (from dispatch queue) and PR info.
 */

import { z } from "zod";
import type { Task } from "../../domain/tasks/task.js";
import { TaskService } from "../../domain/tasks/task-service.js";
import { IssueService } from "../../domain/issues/issue-service.js";
import { PlanService } from "../../domain/plans/plan-service.js";
import { WorkerQueueDbTag } from "@dev-workflow/dispatch/worker-queue-db.js";
import type { WorkerQueueDb } from "@dev-workflow/dispatch/worker-queue-db.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema
// =============================================================================

export const getTaskSchema = z
  .object({
    taskId: z.string().min(1).optional(),
    taskNumber: z.number().int().positive().optional(),
    issueNumber: z.number().int().positive().optional(),
  })
  .refine(
    (data) => data.taskId || (data.taskNumber !== undefined && data.issueNumber !== undefined),
    { message: "Either taskId or both taskNumber and issueNumber are required" }
  );

export type GetTaskInput = z.infer<typeof getTaskSchema>;

// =============================================================================
// Types
// =============================================================================

export interface TaskWorkerInfo {
  workerId: string | null;
  sessionId: string | null;
}

export interface TaskPRInfo {
  prNumber: number;
  prUrl: string;
  prStatus: string;
}

export interface EnrichedTaskData {
  id: string;
  planId: string;
  number: number;
  order: number;
  title: string;
  description: string;
  status: string;
  type: string;
  source: string;
  acceptanceCriteria: string[];
  estimatedMinutes?: number | null;
  dependsOn?: string[] | null;
  labels?: Record<string, string> | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  worktreePath?: string | null;
  branchName?: string | null;
  workerInfo?: TaskWorkerInfo;
  prInfo?: TaskPRInfo;
}

// =============================================================================
// Helpers
// =============================================================================

function enrichTaskData(task: Task, workerQueueDb?: WorkerQueueDb): EnrichedTaskData {
  const enriched: EnrichedTaskData = {
    id: task.id,
    planId: task.planId,
    number: task.number,
    order: task.order,
    title: task.title,
    description: task.description,
    status: task.status,
    type: task.type,
    source: task.source,
    acceptanceCriteria: task.acceptanceCriteria,
    estimatedMinutes: task.estimatedMinutes,
    dependsOn: task.dependsOn,
    labels: task.labels,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    worktreePath: task.worktreePath,
    branchName: task.branchName,
  };

  // Add worker info if task has an active session
  const hasActiveSession = task.sessionId && task.status === "IN_PROGRESS";
  if (hasActiveSession) {
    let workerId: string | null = null;
    if (workerQueueDb) {
      const queueEntry = workerQueueDb.findByTaskId(task.id);
      workerId = queueEntry?.workerId ?? null;
    }

    enriched.workerInfo = {
      workerId,
      sessionId: task.sessionId ?? null,
    };
  }

  // Add PR info if task has a PR
  if (task.prNumber && task.prUrl && task.prStatus) {
    enriched.prInfo = {
      prNumber: task.prNumber,
      prUrl: task.prUrl,
      prStatus: task.prStatus,
    };
  }

  return enriched;
}

// =============================================================================
// Operation
// =============================================================================

export function getTask(input: GetTaskInput) {
  return Effect.gen(function* () {
    const { taskId, taskNumber, issueNumber } = validateInput(getTaskSchema, input);
    const taskService = yield* TaskService;
    const workerQueueDb = yield* WorkerQueueDbTag;

    let task: Task | null = null;

    if (taskId) {
      task = yield* taskService.findById(taskId);
    } else if (taskNumber !== undefined && issueNumber !== undefined) {
      const issueService = yield* IssueService;
      const planService = yield* PlanService;

      const issue = yield* issueService.findByNumber(issueNumber);
      if (!issue) {
        throw new Error(`Issue not found: #${issueNumber}`);
      }

      const plan = yield* planService.findByIssueId(issue.id);
      if (!plan) {
        throw new Error(`No plan found for issue #${issueNumber}`);
      }

      const tasks = yield* taskService.findByPlanId(plan.id);
      task = tasks.find((t) => t.number === taskNumber) ?? null;
    }

    if (!task) {
      throw new Error(
        taskId
          ? `Task not found: ${taskId}`
          : `Task #${taskNumber} not found in issue #${issueNumber}`
      );
    }

    // Return enriched task data with worker and PR info
    return enrichTaskData(task, workerQueueDb ?? undefined) satisfies EnrichedTaskData;
  });
}
