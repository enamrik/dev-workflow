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

import type { Issue, IssueRepository } from "../domain/issue.js";
import type { Plan, PlanRepository } from "../domain/plan.js";
import type { Task, TaskRepository, TaskStatus } from "../domain/task.js";
import type { VersioningService } from "./versioning-service.js";
import type { GitHubCLI } from "../infrastructure/github/github-cli.js";
import type { ProjectRepository } from "../domain/project.js";
import { EventBus } from "../infrastructure/events/event-bus.js";

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
export class MergeService {
  private readonly eventBus: EventBus;

  constructor(
    private readonly issueRepository: IssueRepository,
    private readonly planRepository: PlanRepository,
    private readonly taskRepository: TaskRepository,
    private readonly versioningService: VersioningService,
    private readonly projectRepository: ProjectRepository,
    private readonly projectId: string,
    private readonly githubCLI?: GitHubCLI
  ) {
    this.eventBus = EventBus.getInstance();
  }

  /**
   * Check if GitHub sync is enabled for this project
   */
  private async isGitHubSyncEnabled(): Promise<boolean> {
    const project = await this.projectRepository.findById(this.projectId);
    return project?.githubSync?.enabled ?? false;
  }

  /**
   * Merge two issues into one
   *
   * @param request - Merge request with source, target, and mode
   * @returns MergeResult with the resulting issue, plan, tasks, and warnings
   * @throws MergeValidationError if validation fails
   */
  async merge(request: MergeIssuesRequest): Promise<MergeResult> {
    // Resolve issues from IDs or numbers
    const sourceIssue = this.resolveIssue(
      request.sourceIssueId,
      request.sourceIssueNumber,
      "source"
    );
    const targetIssue = this.resolveIssue(
      request.targetIssueId,
      request.targetIssueNumber,
      "target"
    );

    // Validate issues are not the same
    if (sourceIssue.id === targetIssue.id) {
      throw new MergeValidationError("Cannot merge an issue with itself");
    }

    // Validate issues are not CLOSED
    if (sourceIssue.status === "CLOSED") {
      throw new MergeValidationError(
        `Source issue #${sourceIssue.number} is CLOSED and cannot be merged`
      );
    }
    if (targetIssue.status === "CLOSED") {
      throw new MergeValidationError(
        `Target issue #${targetIssue.number} is CLOSED and cannot be merged`
      );
    }

    // Collect warnings about in-progress work
    const warnings = this.detectWarnings(sourceIssue, targetIssue);

    // Execute merge based on mode
    let result: MergeResult;
    if (request.mode === "create_new") {
      result = this.executeCreateNew(
        sourceIssue,
        targetIssue,
        warnings,
        request.newTitle,
        request.newDescription,
        request.mergedBy
      );
    } else {
      result = this.executeMergeInto(sourceIssue, targetIssue, warnings, request.mergedBy);
    }

    // Sync merge to GitHub (comments, close source in merge_into mode)
    await this.syncMergeToGitHub(sourceIssue, targetIssue, result, request.mode);

    return result;
  }

  /**
   * Resolve an issue from ID or number
   */
  private resolveIssue(
    id: string | undefined,
    number: number | undefined,
    label: "source" | "target"
  ): Issue {
    let issue: Issue | null = null;

    if (id) {
      issue = this.issueRepository.findById(id);
    } else if (number !== undefined) {
      issue = this.issueRepository.findByNumber(number);
    }

    if (!issue) {
      const identifier = id ? `ID ${id}` : `#${number}`;
      throw new MergeValidationError(`${label} issue not found: ${identifier}`);
    }

    return issue;
  }

  /**
   * Detect warnings about in-progress or PR_REVIEW tasks
   */
  private detectWarnings(sourceIssue: Issue, targetIssue: Issue): MergeWarning[] {
    const warnings: MergeWarning[] = [];

    // Check source issue tasks
    const sourcePlan = this.planRepository.findByIssueId(sourceIssue.id);
    if (sourcePlan) {
      const sourceTasks = this.taskRepository.findByPlanId(sourcePlan.id, false);
      warnings.push(...this.checkTasksForWarnings(sourceTasks, sourceIssue.number));
    }

    // Check target issue tasks
    const targetPlan = this.planRepository.findByIssueId(targetIssue.id);
    if (targetPlan) {
      const targetTasks = this.taskRepository.findByPlanId(targetPlan.id, false);
      warnings.push(...this.checkTasksForWarnings(targetTasks, targetIssue.number));
    }

    return warnings;
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
  ): MergeResult {
    // Create snapshot before merge (using ISSUE_UPDATE as the snapshot type)
    this.versioningService.createSnapshot(
      sourceIssue.number,
      "ISSUE_UPDATE",
      mergedBy ?? "merge-service",
      `Pre-merge snapshot (create_new mode)`
    );
    this.versioningService.createSnapshot(
      targetIssue.number,
      "ISSUE_UPDATE",
      mergedBy ?? "merge-service",
      `Pre-merge snapshot (create_new mode)`
    );

    // Create combined title and description
    const title = customTitle ?? `Merged: ${sourceIssue.title} + ${targetIssue.title}`;
    const description = customDescription ?? this.combineDescriptions(sourceIssue, targetIssue);

    // Combine acceptance criteria (deduplicated)
    const acceptanceCriteria = this.combineAcceptanceCriteria(
      sourceIssue.acceptanceCriteria,
      targetIssue.acceptanceCriteria
    );

    // Use higher priority
    const priority = this.getHigherPriority(sourceIssue.priority, targetIssue.priority);

    // Create new issue
    const newIssue = this.issueRepository.create({
      title,
      description,
      type: sourceIssue.type, // Use source type
      priority,
      status: "OPEN",
      acceptanceCriteria,
      createdBy: mergedBy ?? "merge-service",
    });

    // Emit issue created event
    this.eventBus.emit("issue:created", {
      issueId: newIssue.id,
      issueNumber: newIssue.number,
    });

    // Handle plan and task merging
    const sourcePlan = this.planRepository.findByIssueId(sourceIssue.id);
    const targetPlan = this.planRepository.findByIssueId(targetIssue.id);

    let resultPlan: Plan | undefined;
    const resultTasks: Task[] = [];

    if (sourcePlan || targetPlan) {
      // Create a combined plan
      const planSummary = this.combinePlanSummaries(sourcePlan, targetPlan);
      const planApproach = this.combinePlanApproaches(sourcePlan, targetPlan);
      const complexity = this.getHigherComplexity(
        sourcePlan?.estimatedComplexity,
        targetPlan?.estimatedComplexity
      );

      resultPlan = this.planRepository.create({
        issueId: newIssue.id,
        summary: planSummary,
        approach: planApproach,
        estimatedComplexity: complexity,
        generatedBy: mergedBy ?? "merge-service",
      });

      // Emit plan created event
      this.eventBus.emit("plan:generated", {
        planId: resultPlan.id,
        issueId: newIssue.id,
        issueNumber: newIssue.number,
      });

      // Copy tasks from both plans
      if (sourcePlan) {
        const sourceTasks = this.taskRepository.findByPlanId(sourcePlan.id, false);
        resultTasks.push(...this.copyTasksToPlan(sourceTasks, resultPlan.id, sourceIssue.number));
      }
      if (targetPlan) {
        const targetTasks = this.taskRepository.findByPlanId(targetPlan.id, false);
        resultTasks.push(...this.copyTasksToPlan(targetTasks, resultPlan.id, targetIssue.number));
      }

      // Emit task created events
      for (const task of resultTasks) {
        this.eventBus.emit("task:created", {
          taskId: task.id,
          planId: resultPlan.id,
          issueNumber: newIssue.number,
        });
      }
    }

    // Create snapshot after merge
    this.versioningService.createSnapshot(
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
      mode: "create_new",
    };
  }

  /**
   * Execute merge_into mode: Fold source into target, soft-delete source
   */
  private executeMergeInto(
    sourceIssue: Issue,
    targetIssue: Issue,
    warnings: MergeWarning[],
    mergedBy?: string
  ): MergeResult {
    // Create snapshots before merge (using ISSUE_UPDATE as the snapshot type)
    this.versioningService.createSnapshot(
      sourceIssue.number,
      "ISSUE_UPDATE",
      mergedBy ?? "merge-service",
      `Pre-merge snapshot (merge_into mode - source)`
    );
    this.versioningService.createSnapshot(
      targetIssue.number,
      "ISSUE_UPDATE",
      mergedBy ?? "merge-service",
      `Pre-merge snapshot (merge_into mode - target)`
    );

    // Update target description to include reference to merged source
    const updatedDescription = this.appendMergeNote(targetIssue.description, sourceIssue);

    // Combine acceptance criteria
    const combinedCriteria = this.combineAcceptanceCriteria(
      targetIssue.acceptanceCriteria,
      sourceIssue.acceptanceCriteria
    );

    // Update target issue
    const updatedTarget = this.issueRepository.update(targetIssue.id, {
      description: updatedDescription,
      acceptanceCriteria: combinedCriteria,
    });

    // Handle plan and task merging
    const sourcePlan = this.planRepository.findByIssueId(sourceIssue.id);
    const targetPlan = this.planRepository.findByIssueId(targetIssue.id);

    let resultPlan: Plan | undefined = targetPlan ?? undefined;
    let resultTasks: Task[] = [];

    if (sourcePlan) {
      const sourceTasks = this.taskRepository.findByPlanId(sourcePlan.id, false);

      if (targetPlan) {
        // Target has a plan - add source tasks to it
        resultTasks = this.taskRepository.findByPlanId(targetPlan.id, false);
        const copiedTasks = this.copyTasksToPlan(sourceTasks, targetPlan.id, sourceIssue.number);
        resultTasks.push(...copiedTasks);

        // Update plan approach to include source approach
        const updatedApproach = this.appendPlanApproach(
          targetPlan.approach,
          sourcePlan.approach,
          sourceIssue.number
        );
        resultPlan = this.planRepository.update(targetPlan.id, {
          approach: updatedApproach,
        });

        // Emit task created events
        for (const task of copiedTasks) {
          this.eventBus.emit("task:created", {
            taskId: task.id,
            planId: targetPlan.id,
            issueNumber: updatedTarget.number,
          });
        }
      } else {
        // Target has no plan - create one from source
        resultPlan = this.planRepository.create({
          issueId: targetIssue.id,
          summary: sourcePlan.summary,
          approach: sourcePlan.approach,
          estimatedComplexity: sourcePlan.estimatedComplexity,
          generatedBy: mergedBy ?? "merge-service",
        });

        // Copy tasks to new plan
        resultTasks = this.copyTasksToPlan(sourceTasks, resultPlan.id, sourceIssue.number);

        // Emit events
        this.eventBus.emit("plan:generated", {
          planId: resultPlan.id,
          issueId: targetIssue.id,
          issueNumber: updatedTarget.number,
        });
        for (const task of resultTasks) {
          this.eventBus.emit("task:created", {
            taskId: task.id,
            planId: resultPlan.id,
            issueNumber: updatedTarget.number,
          });
        }
      }
    } else if (targetPlan) {
      // Source has no plan, target does - just get existing tasks
      resultTasks = this.taskRepository.findByPlanId(targetPlan.id, false);
    }

    // Soft-delete the source issue
    this.issueRepository.delete(sourceIssue.id, mergedBy ?? "merge-service");

    // Emit event for target issue update
    this.eventBus.emit("issue:updated", {
      issueId: updatedTarget.id,
      issueNumber: updatedTarget.number,
      fields: ["description", "acceptanceCriteria"],
    });

    // Note: Source issue is soft-deleted, no "issue:deleted" event exists in the domain events
    // The soft delete is tracked in the database with isDeleted=true

    // Create snapshot after merge
    this.versioningService.createSnapshot(
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
      mode: "merge_into",
    };
  }

  /**
   * Copy tasks from one plan to another, preserving state and GitHub links
   */
  private copyTasksToPlan(tasks: Task[], targetPlanId: string, sourceIssueNumber: number): Task[] {
    const copiedTasks: Task[] = [];

    for (const task of tasks) {
      // Determine the status for the copied task
      // PLANNED/BACKLOG/READY → BACKLOG
      // IN_PROGRESS/PR_REVIEW → preserve (with warning)
      // COMPLETED/ABANDONED → preserve
      const newStatus = this.mapTaskStatusForCopy(task.status);

      // Create the copied task, preserving GitHub sync state
      const copiedTask = this.taskRepository.create({
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
        // Preserve GitHub sync state - the task still references the same GitHub issue
        githubSync: task.githubSync,
        // Note: dependsOn is cleared since task IDs are different in the new plan
      });

      copiedTasks.push(copiedTask);
    }

    return copiedTasks;
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
  private async syncMergeToGitHub(
    sourceIssue: Issue,
    targetIssue: Issue,
    result: MergeResult,
    mode: MergeMode
  ): Promise<void> {
    // Skip if GitHub sync is not enabled or no CLI available
    if (!(await this.isGitHubSyncEnabled()) || !this.githubCLI) {
      return;
    }

    const resultIssueNumber = result.resultIssue.number;

    // Comment on source issue's GitHub issue (if it has one)
    if (sourceIssue.githubSync?.githubIssueNumber) {
      try {
        const comment = this.buildMergeComment(sourceIssue.number, resultIssueNumber, mode);

        if (mode === "merge_into") {
          // Close with comment for merge_into mode
          await this.githubCLI.closeIssueWithComment(
            sourceIssue.githubSync.githubIssueNumber,
            comment
          );
        } else {
          // Just comment for create_new mode
          await this.githubCLI.commentOnIssue(sourceIssue.githubSync.githubIssueNumber, comment);
        }
      } catch (error) {
        // Log but don't fail the merge - GitHub sync is best-effort
        console.warn(
          `Failed to sync merge to GitHub issue #${sourceIssue.githubSync.githubIssueNumber}:`,
          error
        );
      }
    }

    // Comment on target issue's GitHub issue (if it has one and mode is merge_into)
    // Note: In create_new mode, we commented on both source issues above
    // In merge_into mode, target issue continues, so add a note about the merge
    if (mode === "merge_into" && targetIssue.githubSync?.githubIssueNumber) {
      try {
        const comment = `📥 **Merged:** Issue #${sourceIssue.number} has been merged into this issue.`;
        await this.githubCLI.commentOnIssue(targetIssue.githubSync.githubIssueNumber, comment);
      } catch (error) {
        console.warn(
          `Failed to comment on target GitHub issue #${targetIssue.githubSync.githubIssueNumber}:`,
          error
        );
      }
    }

    // For create_new mode, also comment on target's GitHub issue
    if (mode === "create_new" && targetIssue.githubSync?.githubIssueNumber) {
      try {
        const comment = this.buildMergeComment(targetIssue.number, resultIssueNumber, mode);
        await this.githubCLI.commentOnIssue(targetIssue.githubSync.githubIssueNumber, comment);
      } catch (error) {
        console.warn(
          `Failed to comment on GitHub issue #${targetIssue.githubSync.githubIssueNumber}:`,
          error
        );
      }
    }
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
