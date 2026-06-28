/**
 * getWorkQueue - Get prioritized work queue for next actions
 *
 * Returns:
 * - Issues needing planning (PLANNED status without a plan)
 * - Top 3 issues to work on (scored by priority, milestone deadline, task readiness)
 * - Top 3 tasks to work on (scored by task priority, issue priority, status)
 *
 * Uses a multi-factor scoring algorithm to rank issues and tasks.
 */

import { z } from "zod";
import type { ComputedIssueStatus, IssuePriority } from "../../domain/issues/issue.js";
import {
  isIssueClosed,
  isIssueInPlanning,
  issueHasActiveWork,
  computeIssueStatus,
  PRIORITY_WEIGHTS,
} from "../../domain/issues/issue.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Constants
// =============================================================================

const STATUS_WEIGHTS: Record<string, number> = {
  IN_PROGRESS: 100,
  OPEN: 50,
  PLANNED: 0,
};

const TASK_STATUS_WEIGHTS: Record<string, number> = {
  READY: 100,
  BACKLOG: 50,
};

// =============================================================================
// Schema & Types
// =============================================================================

export const GetWorkQueueSchema = z.object({
  projectSlug: z.string().min(1),
});
export type GetWorkQueueInput = z.infer<typeof GetWorkQueueSchema>;

export interface WorkQueueIssueNeedingPlanning {
  number: number;
  title: string;
  priority: string;
  milestone?: string;
}

export interface WorkQueueScoredIssue {
  number: number;
  title: string;
  status: string;
  computedStatus: ComputedIssueStatus;
  priority: string;
  milestone?: string;
  availableTaskCount: number;
}

export interface WorkQueueScoredTask {
  id: string;
  number: number;
  title: string;
  status: string;
  issueNumber: number;
  issueTitle: string;
  priority: string;
}

export interface GetWorkQueueResult {
  needsPlanning?: WorkQueueIssueNeedingPlanning[];
  issues: WorkQueueScoredIssue[];
  tasks: WorkQueueScoredTask[];
}

// =============================================================================
// Internal Types
// =============================================================================

interface TaskWithContext {
  id: string;
  number: number;
  title: string;
  status: string;
  order: number;
  planId: string;
  issueNumber: number;
  issueTitle: string;
  issuePriority: string;
  issueStatus: string;
  milestoneId?: string;
  score: number;
}

// =============================================================================
// Scoring Helpers
// =============================================================================

function calculateIssueScore(
  issue: { status: string; priority: IssuePriority; createdAt: string; milestoneId?: string },
  milestoneEndDates: Map<string, string>
): number {
  let score = 0;

  // Status weight
  score += STATUS_WEIGHTS[issue.status] ?? 0;

  // Priority weight
  score += PRIORITY_WEIGHTS[issue.priority] ?? 0;

  // Milestone urgency (days until end date)
  if (issue.milestoneId) {
    const endDate = milestoneEndDates.get(issue.milestoneId);
    if (endDate) {
      const daysUntilEnd = Math.max(
        0,
        (new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      // Closer deadline = higher score (max 30 points for immediate, 0 for 30+ days)
      score += Math.max(0, 30 - daysUntilEnd);
    }
  }

  // Age tiebreaker (older = slightly higher priority, max 5 points)
  const ageInDays = (Date.now() - new Date(issue.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  score += Math.min(5, ageInDays / 10);

  return score;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Get prioritized work queue: top issues and tasks to work on next.
 *
 * 1. Validate input and resolve project domain
 * 2. Load milestones for date lookups
 * 3. Get all active (non-closed) issues
 * 4. Identify issues that need planning (PLANNED without plan)
 * 5. Score tasks by status weight, parent issue activity, priority, milestone urgency, order
 * 6. Score issues by status weight, priority, milestone urgency, age
 * 7. Return top 3 issues and top 3 tasks
 */
export function getWorkQueue(input: GetWorkQueueInput) {
  return Effect.gen(function* () {
    const { projectSlug } = validateInput(GetWorkQueueSchema, input);
    const domain = yield* DomainExecutorFactory;
    const pd = yield* domain.forProject(projectSlug);

    // Get all milestones for date lookups
    const milestones = yield* pd.milestones.findMany();
    const milestoneEndDates = new Map(milestones.map((m) => [m.id, m.endDate]));
    const milestoneNames = new Map(milestones.map((m) => [m.id, m.title]));

    // Get actionable issues (not closed)
    const allIssues = yield* pd.issues.findMany({});
    const activeIssues = allIssues.filter((i) => !isIssueClosed(i));

    // Identify issues that need planning (PLANNED status without a plan)
    const issuesNeedingPlanning: WorkQueueIssueNeedingPlanning[] = [];

    for (const issue of activeIssues) {
      if (isIssueInPlanning(issue)) {
        const plan = yield* pd.plans.findByIssueId(issue.id);
        if (!plan) {
          issuesNeedingPlanning.push({
            number: issue.number,
            title: issue.title,
            priority: issue.priority,
            milestone: issue.milestoneId ? milestoneNames.get(issue.milestoneId) : undefined,
          });
        }
      }
    }

    // Get available tasks and their parent info
    const tasksWithContext: TaskWithContext[] = [];

    for (const issue of activeIssues) {
      const plan = yield* pd.plans.findByIssueId(issue.id);
      if (!plan) continue;

      const tasks = yield* pd.tasks.findByPlanId(plan.id);

      // Only include available tasks (workable but not yet active)
      const availableTasks = tasks.filter((t) => t.isWorkable && !t.isActive);

      for (const task of availableTasks) {
        let score = 0;

        // Task status weight
        score += TASK_STATUS_WEIGHTS[task.status] ?? 0;

        // Bonus for parent issue having active work (continue what's started)
        if (issueHasActiveWork(issue, tasks)) {
          score += 50;
        }

        // Inherit issue priority weight
        score += PRIORITY_WEIGHTS[issue.priority] ?? 0;

        // Milestone urgency from parent issue
        if (issue.milestoneId) {
          const endDate = milestoneEndDates.get(issue.milestoneId);
          if (endDate) {
            const daysUntilEnd = Math.max(
              0,
              (new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            );
            score += Math.max(0, 30 - daysUntilEnd);
          }
        }

        // Lower task order = higher priority (first tasks in plan come first)
        score += Math.max(0, 10 - task.order);

        tasksWithContext.push({
          id: task.id,
          number: task.number,
          title: task.title,
          status: task.status,
          order: task.order,
          planId: plan.id,
          issueNumber: issue.number,
          issueTitle: issue.title,
          issuePriority: issue.priority,
          issueStatus: issue.status,
          milestoneId: issue.milestoneId,
          score,
        });
      }
    }

    // Score and sort issues
    const scoredIssues: Array<WorkQueueScoredIssue & { score: number }> = [];

    for (const issue of activeIssues) {
      // Count available tasks for this issue
      const plan = yield* pd.plans.findByIssueId(issue.id);
      let availableTaskCount = 0;
      const tasks = plan ? yield* pd.tasks.findByPlanId(plan.id) : [];
      if (plan) {
        availableTaskCount = tasks.filter(
          (t) => t.status === "READY" || t.status === "BACKLOG"
        ).length;
      }

      const computedStatus = computeIssueStatus(issue, tasks);

      scoredIssues.push({
        number: issue.number,
        title: issue.title,
        status: issue.status,
        computedStatus,
        priority: issue.priority,
        milestone: issue.milestoneId ? milestoneNames.get(issue.milestoneId) : undefined,
        availableTaskCount,
        score: calculateIssueScore(issue, milestoneEndDates),
      });
    }

    // Sort by score descending, take top 3
    scoredIssues.sort((a, b) => b.score - a.score);
    const topIssues: WorkQueueScoredIssue[] = scoredIssues
      .slice(0, 3)
      .map(({ score: _score, ...rest }) => rest);

    // Sort tasks by score descending, take top 3
    tasksWithContext.sort((a, b) => b.score - a.score);
    const topTasks: WorkQueueScoredTask[] = tasksWithContext.slice(0, 3).map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      status: t.status,
      issueNumber: t.issueNumber,
      issueTitle: t.issueTitle,
      priority: t.issuePriority,
    }));

    return {
      needsPlanning: issuesNeedingPlanning.length > 0 ? issuesNeedingPlanning : undefined,
      issues: topIssues,
      tasks: topTasks,
    } satisfies GetWorkQueueResult;
  });
}
