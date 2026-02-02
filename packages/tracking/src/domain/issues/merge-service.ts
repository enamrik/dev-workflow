/**
 * Merge Service
 *
 * Handles deterministic merging of two issues into one.
 * Supports two modes:
 * - create_new: Creates a new issue from both sources, leaving originals unchanged
 * - merge_into: Folds source issue into target, soft-deleting the source
 *
 * All merge logic is deterministic in the service layer (not prompt-driven).
 */

import type { Issue } from "./issue.js";
import type { Plan } from "../plans/plan.js";
import type { Task, TaskStatus } from "../tasks/task.js";
import type { VersioningService } from "../snapshots/versioning-service.js";
import type { GitHubCLI } from "../../project-sync/github/github-cli.js";
import type { DbClient } from "../../data-access/db-client.js";
import type { DbSource } from "../../data-access/db-source.js";
import { EventBus } from "../../events/event-bus.js";
import { Effect, Service } from "@dev-workflow/effect";

/**
 * Merge mode options
 */
export type MergeMode = "create_new" | "merge_into";

/**
 * Request to merge two issues
 */
export interface MergeIssuesRequest {
  /** First issue ID or number */
  sourceIssueId?: string;
  sourceIssueNumber?: number;

  /** Second issue ID or number (target in merge_into mode) */
  targetIssueId?: string;
  targetIssueNumber?: number;

  /** Merge mode */
  mode: MergeMode;

  /** Optional: Custom title for create_new mode */
  newTitle?: string;

  /** Optional: Custom description for create_new mode */
  newDescription?: string;

  /** Who is performing the merge */
  mergedBy: string;
}

/**
 * Warning about potential issues with the merge
 */
export interface MergeWarning {
  type: "in_progress_task" | "pr_review_task";
  message: string;
  taskId: string;
  taskTitle: string;
  issueNumber: number;
}

/**
 * Result of a merge operation
 */
export interface MergeResult {
  /** The resulting issue after merge */
  resultIssue: Issue;

  /** Plan for the resulting issue (if any) */
  resultPlan?: Plan;

  /** Tasks in the resulting plan */
  resultTasks: Task[];

  /** Source issues that were merged */
  sourceIssues: Issue[];

  /** Any warnings about the merge (e.g., in-progress tasks) */
  warnings: MergeWarning[];

  /** Mode that was used */
  mode: MergeMode;
}

/**
 * Error thrown when merge validation fails
 */
export class MergeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeValidationError";
  }
}

/**
 * MergeService handles combining two issues into one
 *
 * Responsibilities:
 * - Validate both issues exist and are mergeable (not CLOSED)
 * - Combine issue metadata appropriately based on mode
 * - Merge plans and tasks while preserving state
 * - Detect and warn about in-progress work
 * - Soft-delete source issue in merge_into mode
 * - Sync merge actions to GitHub (comments, close source in merge_into mode)
 */
export class MergeService extends Service<MergeService>()("mergeService") {
  private readonly eventBus: EventBus;
  private readonly db: DbClient;

  constructor(
    private readonly source: DbSource,
    private readonly versioningService: VersioningService,
    private readonly projectId: string,
    private readonly githubCLI?: GitHubCLI
  ) {
    super();
    this.eventBus = EventBus.getInstance();
    this.db = source.createClient(projectId);
  }

  /**
   * Check if GitHub sync is enabled for this project
   */
  private isGitHubSyncEnabled(): Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const project = yield* self.source.projects.findById(self.projectId);
      return project?.syncConfig?.enabled ?? false;
    });
  }

  /**
   * Merge two issues into one
   *
   * @param request - Merge request with source, target, and mode
   * @returns MergeResult with the resulting issue, plan, tasks, and warnings
   * @throws MergeValidationError if validation fails
   */
  merge(request: MergeIssuesRequest): Effect<MergeResult> {
    const self = this;
    return Effect.gen(function* () {
      // Resolve issues from IDs or numbers
      const sourceIssue = yield* self.resolveIssue(
        request.sourceIssueId,
        request.sourceIssueNumber,
        "source"
      );
      const targetIssue = yield* self.resolveIssue(
        request.targetIssueId,
        request.targetIssueNumber,
        "target"
      );

      // Validate issues are not the same
      if (sourceIssue.id === targetIssue.id) {
        throw new MergeValidationError("Cannot merge an issue with itself");
      }

      // Validate issues are not CLOSED - use trait function
      if (sourceIssue.isClosed) {
        throw new MergeValidationError(
          `Source issue #${sourceIssue.number} is CLOSED and cannot be merged`
        );
      }
      if (targetIssue.isClosed) {
        throw new MergeValidationError(
          `Target issue #${targetIssue.number} is CLOSED and cannot be merged`
        );
      }

      // Collect warnings about in-progress work
      const warnings = yield* self.detectWarnings(sourceIssue, targetIssue);

      // Execute merge based on mode
      let result: MergeResult;
      if (request.mode === "create_new") {
        result = yield* self.executeCreateNew(
          sourceIssue,
          targetIssue,
          warnings,
          request.newTitle,
          request.newDescription,
          request.mergedBy
        );
      } else {
        result = yield* self.executeMergeInto(sourceIssue, targetIssue, warnings, request.mergedBy);
      }

      // Sync merge to GitHub (comments, close source in merge_into mode)
      yield* self.syncMergeToGitHub(sourceIssue, targetIssue, result, request.mode);

      return result;
    });
  }

  /**
   * Resolve an issue from ID or number
   */
  private resolveIssue(
    id: string | undefined,
    number: number | undefined,
    label: "source" | "target"
  ): Effect<Issue> {
    const self = this;
    return Effect.gen(function* () {
      let issue: Issue | null = null;

      if (id) {
        issue = yield* self.db.issues.findById(id);
      } else if (number !== undefined) {
        issue = yield* self.db.issues.findByNumber(number);
      }

      if (!issue) {
        const identifier = id ? `ID ${id}` : `#${number}`;
        throw new MergeValidationError(`${label} issue not found: ${identifier}`);
      }

      return issue;
    });
  }

  /**
   * Detect warnings about in-progress or PR_REVIEW tasks
   */
  private detectWarnings(sourceIssue: Issue, targetIssue: Issue): Effect<MergeWarning[]> {
    const self = this;
    return Effect.gen(function* () {
      const warnings: MergeWarning[] = [];

      // Check source issue tasks
      const sourcePlan = yield* self.db.plans.findByIssueId(sourceIssue.id);
      if (sourcePlan) {
        const sourceTasks = yield* self.db.tasks.findByPlanId(sourcePlan.id, false);
        warnings.push(...self.checkTasksForWarnings(sourceTasks, sourceIssue.number));
      }

      // Check target issue tasks
      const targetPlan = yield* self.db.plans.findByIssueId(targetIssue.id);
      if (targetPlan) {
        const targetTasks = yield* self.db.tasks.findByPlanId(targetPlan.id, false);
        warnings.push(...self.checkTasksForWarnings(targetTasks, targetIssue.number));
      }

      return warnings;
    });
  }

  /**
   * Check tasks for warning conditions
   */
  private checkTasksForWarnings(tasks: Task[], issueNumber: number): MergeWarning[] {
    const warnings: MergeWarning[] = [];

    for (const task of tasks) {
      if (task.status === "IN_PROGRESS") {
        warnings.push({
          type: "in_progress_task",
          message: `Task "${task.title}" is currently IN_PROGRESS`,
          taskId: task.id,
          taskTitle: task.title,
          issueNumber,
        });
      } else if (task.status === "PR_REVIEW") {
        warnings.push({
          type: "pr_review_task",
          message: `Task "${task.title}" has a PR awaiting review`,
          taskId: task.id,
          taskTitle: task.title,
          issueNumber,
        });
      }
    }

    return warnings;
  }

  /**
   * Execute create_new mode: Create a new issue from both sources
   */
  private executeCreateNew(
    sourceIssue: Issue,
    targetIssue: Issue,
    warnings: MergeWarning[],
    customTitle?: string,
    customDescription?: string,
    mergedBy?: string
  ): Effect<MergeResult> {
    const self = this;
    return Effect.gen(function* () {
      // Create snapshot before merge (using ISSUE_UPDATE as the snapshot type)
      yield* self.versioningService.createSnapshot(
        sourceIssue.number,
        "ISSUE_UPDATE",
        mergedBy ?? "merge-service",
        `Pre-merge snapshot (create_new mode)`
      );
      yield* self.versioningService.createSnapshot(
        targetIssue.number,
        "ISSUE_UPDATE",
        mergedBy ?? "merge-service",
        `Pre-merge snapshot (create_new mode)`
      );

      // Create combined title and description
      const title = customTitle ?? `Merged: ${sourceIssue.title} + ${targetIssue.title}`;
      const description = customDescription ?? self.combineDescriptions(sourceIssue, targetIssue);

      // Combine acceptance criteria (deduplicated)
      const acceptanceCriteria = self.combineAcceptanceCriteria(
        sourceIssue.acceptanceCriteria,
        targetIssue.acceptanceCriteria
      );

      // Use higher priority
      const priority = self.getHigherPriority(sourceIssue.priority, targetIssue.priority);

      // Create new issue
      const newIssue = yield* self.db.issues.create({
        title,
        description,
        type: sourceIssue.type, // Use source type
        priority,
        status: "OPEN",
        acceptanceCriteria,
        createdBy: mergedBy ?? "merge-service",
      });

      // Emit issue created event
      self.eventBus.emit("issue:created", {
        issueId: newIssue.id,
        issueNumber: newIssue.number,
      });

      // Handle plan and task merging
      const sourcePlan = yield* self.db.plans.findByIssueId(sourceIssue.id);
      const targetPlan = yield* self.db.plans.findByIssueId(targetIssue.id);

      let resultPlan: Plan | undefined;
      const resultTasks: Task[] = [];

      if (sourcePlan || targetPlan) {
        // Create a combined plan
        const planSummary = self.combinePlanSummaries(sourcePlan, targetPlan);
        const planApproach = self.combinePlanApproaches(sourcePlan, targetPlan);
        const complexity = self.getHigherComplexity(
          sourcePlan?.estimatedComplexity,
          targetPlan?.estimatedComplexity
        );

        resultPlan = yield* self.db.plans.create({
          issueId: newIssue.id,
          summary: planSummary,
          approach: planApproach,
          estimatedComplexity: complexity,
          generatedBy: mergedBy ?? "merge-service",
        });

        // Emit plan created event
        self.eventBus.emit("plan:generated", {
          planId: resultPlan.id,
          issueId: newIssue.id,
          issueNumber: newIssue.number,
        });

        // Copy tasks from both plans
        if (sourcePlan) {
          const sourceTasks = yield* self.db.tasks.findByPlanId(sourcePlan.id, false);
          resultTasks.push(
            ...(yield* self.copyTasksToPlan(sourceTasks, resultPlan.id, sourceIssue.number))
          );
        }
        if (targetPlan) {
          const targetTasks = yield* self.db.tasks.findByPlanId(targetPlan.id, false);
          resultTasks.push(
            ...(yield* self.copyTasksToPlan(targetTasks, resultPlan.id, targetIssue.number))
          );
        }

        // Emit task created events
        for (const task of resultTasks) {
          self.eventBus.emit("task:created", {
            taskId: task.id,
            planId: resultPlan.id,
            issueNumber: newIssue.number,
          });
        }
      }

      // Create snapshot after merge
      yield* self.versioningService.createSnapshot(
        newIssue.number,
        "ISSUE_UPDATE",
        mergedBy ?? "merge-service",
        `Created from merge of #${sourceIssue.number} and #${targetIssue.number}`
      );

      return {
        resultIssue: newIssue,
        resultPlan,
        resultTasks,
        sourceIssues: [sourceIssue, targetIssue],
        warnings,
        mode: "create_new" as const,
      };
    });
  }

  /**
   * Execute merge_into mode: Fold source into target, soft-delete source
   */
  private executeMergeInto(
    sourceIssue: Issue,
    targetIssue: Issue,
    warnings: MergeWarning[],
    mergedBy?: string
  ): Effect<MergeResult> {
    const self = this;
    return Effect.gen(function* () {
      // Create snapshots before merge (using ISSUE_UPDATE as the snapshot type)
      yield* self.versioningService.createSnapshot(
        sourceIssue.number,
        "ISSUE_UPDATE",
        mergedBy ?? "merge-service",
        `Pre-merge snapshot (merge_into mode - source)`
      );
      yield* self.versioningService.createSnapshot(
        targetIssue.number,
        "ISSUE_UPDATE",
        mergedBy ?? "merge-service",
        `Pre-merge snapshot (merge_into mode - target)`
      );

      // Update target description to include reference to merged source
      const updatedDescription = self.appendMergeNote(targetIssue.description, sourceIssue);

      // Combine acceptance criteria
      const combinedCriteria = self.combineAcceptanceCriteria(
        targetIssue.acceptanceCriteria,
        sourceIssue.acceptanceCriteria
      );

      // Update target issue
      const updatedTarget = yield* self.db.issues.update(targetIssue.id, {
        description: updatedDescription,
        acceptanceCriteria: combinedCriteria,
      });

      // Handle plan and task merging
      const sourcePlan = yield* self.db.plans.findByIssueId(sourceIssue.id);
      const targetPlan = yield* self.db.plans.findByIssueId(targetIssue.id);

      let resultPlan: Plan | undefined = targetPlan ?? undefined;
      let resultTasks: Task[] = [];

      if (sourcePlan) {
        const sourceTasks = yield* self.db.tasks.findByPlanId(sourcePlan.id, false);

        if (targetPlan) {
          // Target has a plan - add source tasks to it
          resultTasks = yield* self.db.tasks.findByPlanId(targetPlan.id, false);
          const copiedTasks = yield* self.copyTasksToPlan(
            sourceTasks,
            targetPlan.id,
            sourceIssue.number
          );
          resultTasks.push(...copiedTasks);

          // Update plan approach to include source approach
          const updatedApproach = self.appendPlanApproach(
            targetPlan.approach,
            sourcePlan.approach,
            sourceIssue.number
          );
          resultPlan = yield* self.db.plans.update(targetPlan.id, {
            approach: updatedApproach,
          });

          // Emit task created events
          for (const task of copiedTasks) {
            self.eventBus.emit("task:created", {
              taskId: task.id,
              planId: targetPlan.id,
              issueNumber: updatedTarget.number,
            });
          }
        } else {
          // Target has no plan - create one from source
          resultPlan = yield* self.db.plans.create({
            issueId: targetIssue.id,
            summary: sourcePlan.summary,
            approach: sourcePlan.approach,
            estimatedComplexity: sourcePlan.estimatedComplexity,
            generatedBy: mergedBy ?? "merge-service",
          });

          // Copy tasks to new plan
          resultTasks = yield* self.copyTasksToPlan(sourceTasks, resultPlan.id, sourceIssue.number);

          // Emit events
          self.eventBus.emit("plan:generated", {
            planId: resultPlan.id,
            issueId: targetIssue.id,
            issueNumber: updatedTarget.number,
          });
          for (const task of resultTasks) {
            self.eventBus.emit("task:created", {
              taskId: task.id,
              planId: resultPlan.id,
              issueNumber: updatedTarget.number,
            });
          }
        }
      } else if (targetPlan) {
        // Source has no plan, target does - just get existing tasks
        resultTasks = yield* self.db.tasks.findByPlanId(targetPlan.id, false);
      }

      // Soft-delete the source issue
      yield* self.db.issues.delete(sourceIssue.id, mergedBy ?? "merge-service");

      // Emit event for target issue update
      self.eventBus.emit("issue:updated", {
        issueId: updatedTarget.id,
        issueNumber: updatedTarget.number,
        fields: ["description", "acceptanceCriteria"],
      });

      // Note: Source issue is soft-deleted, no "issue:deleted" event exists in the domain events
      // The soft delete is tracked in the database with isDeleted=true

      // Create snapshot after merge
      yield* self.versioningService.createSnapshot(
        updatedTarget.number,
        "ISSUE_UPDATE",
        mergedBy ?? "merge-service",
        `Merged #${sourceIssue.number} into this issue`
      );

      return {
        resultIssue: updatedTarget,
        resultPlan,
        resultTasks,
        sourceIssues: [sourceIssue, targetIssue],
        warnings,
        mode: "merge_into" as const,
      };
    });
  }

  /**
   * Copy tasks from one plan to another, preserving state and GitHub links
   */
  private copyTasksToPlan(
    tasks: Task[],
    targetPlanId: string,
    sourceIssueNumber: number
  ): Effect<Task[]> {
    const self = this;
    return Effect.gen(function* () {
      const copiedTasks: Task[] = [];

      for (const task of tasks) {
        // Determine the status for the copied task
        // PLANNED/BACKLOG/READY → BACKLOG
        // IN_PROGRESS/PR_REVIEW → preserve (with warning)
        // COMPLETED/ABANDONED → preserve
        const newStatus = self.mapTaskStatusForCopy(task.status);

        // Create the copied task, preserving GitHub sync state
        const copiedTask = yield* self.db.tasks.create({
          id: crypto.randomUUID(),
          planId: targetPlanId,
          title: task.title,
          description: `(From #${sourceIssueNumber}) ${task.description}`,
          acceptanceCriteria: task.acceptanceCriteria,
          status: newStatus,
          type: task.type,
          source: task.source,
          estimatedMinutes: task.estimatedMinutes,
          isDeleted: false,
          implementationPlan: task.implementationPlan,
          syncState: task.syncState,
          // Note: dependsOn is cleared since task IDs are different in the new plan
        });

        copiedTasks.push(copiedTask);
      }

      return copiedTasks;
    });
  }

  /**
   * Map task status for copying to a new plan
   */
  private mapTaskStatusForCopy(status: TaskStatus): TaskStatus {
    switch (status) {
      case "PLANNED":
      case "BACKLOG":
      case "READY":
        return "BACKLOG";
      case "IN_PROGRESS":
      case "PR_REVIEW":
      case "COMPLETED":
      case "ABANDONED":
        return status; // Preserve as-is
    }
  }

  /**
   * Combine descriptions from two issues
   */
  private combineDescriptions(source: Issue, target: Issue): string {
    return `## From #${source.number}: ${source.title}\n\n${source.description}\n\n---\n\n## From #${target.number}: ${target.title}\n\n${target.description}`;
  }

  /**
   * Append a merge note to an existing description
   */
  private appendMergeNote(description: string, mergedIssue: Issue): string {
    return `${description}\n\n---\n\n**Merged from #${mergedIssue.number}:** ${mergedIssue.title}\n\n${mergedIssue.description}`;
  }

  /**
   * Combine acceptance criteria, deduplicating similar items
   */
  private combineAcceptanceCriteria(criteria1: string[], criteria2: string[]): string[] {
    const combined = [...criteria1];

    for (const criterion of criteria2) {
      // Simple deduplication - exact match
      const normalized = criterion.toLowerCase().trim();
      const isDuplicate = combined.some((c) => c.toLowerCase().trim() === normalized);
      if (!isDuplicate) {
        combined.push(criterion);
      }
    }

    return combined;
  }

  /**
   * Get the higher of two priorities
   */
  private getHigherPriority(p1: Issue["priority"], p2: Issue["priority"]): Issue["priority"] {
    const order: Issue["priority"][] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    const i1 = order.indexOf(p1);
    const i2 = order.indexOf(p2);
    return i1 >= i2 ? p1 : p2;
  }

  /**
   * Combine plan summaries
   */
  private combinePlanSummaries(plan1?: Plan | null, plan2?: Plan | null): string {
    if (plan1 && plan2) {
      return `${plan1.summary}\n\nAdditionally: ${plan2.summary}`;
    }
    return plan1?.summary ?? plan2?.summary ?? "Combined implementation plan";
  }

  /**
   * Combine plan approaches
   */
  private combinePlanApproaches(plan1?: Plan | null, plan2?: Plan | null): string {
    if (plan1 && plan2) {
      return `${plan1.approach}\n\n---\n\n${plan2.approach}`;
    }
    return plan1?.approach ?? plan2?.approach ?? "Combined approach from merged issues";
  }

  /**
   * Append plan approach from merged source
   */
  private appendPlanApproach(
    targetApproach: string,
    sourceApproach: string,
    sourceIssueNumber: number
  ): string {
    return `${targetApproach}\n\n---\n\n**From merged issue #${sourceIssueNumber}:**\n\n${sourceApproach}`;
  }

  /**
   * Get the higher of two complexities
   */
  private getHigherComplexity(
    c1?: Plan["estimatedComplexity"],
    c2?: Plan["estimatedComplexity"]
  ): Plan["estimatedComplexity"] {
    const order: Plan["estimatedComplexity"][] = ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"];
    const i1 = c1 ? order.indexOf(c1) : 0;
    const i2 = c2 ? order.indexOf(c2) : 0;
    return i1 >= i2 ? (c1 ?? "MEDIUM") : (c2 ?? "MEDIUM");
  }

  /**
   * Sync merge operation to GitHub
   *
   * - Adds comments to source GitHub issues about the merge
   * - In merge_into mode, closes the source GitHub issue
   *
   * This is best-effort: if GitHub sync fails, the merge still succeeds
   * (the local merge is the source of truth)
   */
  private syncMergeToGitHub(
    sourceIssue: Issue,
    targetIssue: Issue,
    result: MergeResult,
    mode: MergeMode
  ): Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      // Skip if GitHub sync is not enabled or no CLI available
      if (!(yield* self.isGitHubSyncEnabled()) || !self.githubCLI) {
        return;
      }

      const resultIssueNumber = result.resultIssue.number;

      // Comment on source issue's GitHub issue (if it has one)
      if (sourceIssue.syncState?.externalId) {
        const comment = self.buildMergeComment(sourceIssue.number, resultIssueNumber, mode);
        const issueNumber = parseInt(sourceIssue.syncState.externalId, 10);

        // Best-effort: log but don't fail the merge if GitHub sync fails
        yield* Effect.catchAll(
          mode === "merge_into"
            ? self.githubCLI.closeIssueWithComment(issueNumber, comment)
            : self.githubCLI.commentOnIssue(issueNumber, comment),
          (error) => {
            console.warn(
              `Failed to sync merge to GitHub issue #${sourceIssue.syncState?.externalId}:`,
              error
            );
            return Effect.succeed(undefined as void);
          }
        );
      }

      // Comment on target issue's GitHub issue (if it has one and mode is merge_into)
      // Note: In create_new mode, we commented on both source issues above
      // In merge_into mode, target issue continues, so add a note about the merge
      if (mode === "merge_into" && targetIssue.syncState?.externalId) {
        const comment = `**Merged:** Issue #${sourceIssue.number} has been merged into this issue.`;
        const issueNumber = parseInt(targetIssue.syncState.externalId, 10);

        yield* Effect.catchAll(self.githubCLI.commentOnIssue(issueNumber, comment), (error) => {
          console.warn(
            `Failed to comment on target GitHub issue #${targetIssue.syncState?.externalId}:`,
            error
          );
          return Effect.succeed(undefined as void);
        });
      }

      // For create_new mode, also comment on target's GitHub issue
      if (mode === "create_new" && targetIssue.syncState?.externalId) {
        const comment = self.buildMergeComment(targetIssue.number, resultIssueNumber, mode);
        const issueNumber = parseInt(targetIssue.syncState.externalId, 10);

        yield* Effect.catchAll(self.githubCLI.commentOnIssue(issueNumber, comment), (error) => {
          console.warn(
            `Failed to comment on GitHub issue #${targetIssue.syncState?.externalId}:`,
            error
          );
          return Effect.succeed(undefined as void);
        });
      }
    });
  }

  /**
   * Build a merge comment for GitHub
   */
  private buildMergeComment(
    localIssueNumber: number,
    resultIssueNumber: number,
    mode: MergeMode
  ): string {
    if (mode === "merge_into") {
      return `🔀 **Merged:** This issue (#${localIssueNumber}) has been merged into issue #${resultIssueNumber}.`;
    } else {
      return `🔀 **Merged:** This issue (#${localIssueNumber}) was combined with another issue to create issue #${resultIssueNumber}.`;
    }
  }
}
