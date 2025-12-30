import type {
  Snapshot,
  SnapshotRepository,
  SnapshotType,
  SnapshotIssueState,
  SnapshotPlanState,
  SnapshotTaskState,
} from "../domain/snapshot.js";
import type { Issue, IssueRepository } from "../domain/issue.js";
import type { Plan, PlanRepository } from "../domain/plan.js";
import type { Task, TaskRepository } from "../domain/task.js";

/**
 * Complete snapshot data for viewing historical state
 */
export interface SnapshotData {
  snapshot: Snapshot;
  issue: SnapshotIssueState;
  plan: SnapshotPlanState | null;
  tasks: SnapshotTaskState[];
}

/**
 * VersioningService coordinates snapshot creation and restoration
 *
 * Key changes from previous version:
 * - Snapshots now store complete state as JSON (issueState, planState, tasksState)
 * - No more snapshotId foreign keys on entities
 * - Single row per entity in live tables
 * - Revert updates live state from snapshot JSON
 *
 * Responsibilities:
 * - Create atomic snapshots capturing complete state
 * - Archive previous active snapshot
 * - Handle snapshot restoration (revert)
 * - Provide time travel view of historical state
 *
 * Follows the Dependency Inversion Principle - depends on repository
 * interfaces, not concrete implementations.
 */
export class VersioningService {
  constructor(
    private readonly issueRepository: IssueRepository,
    private readonly snapshotRepository: SnapshotRepository,
    private readonly planRepository: PlanRepository,
    private readonly taskRepository: TaskRepository
  ) {}

  /**
   * Create a new snapshot capturing current live state
   *
   * Captures:
   * - Issue state
   * - Plan state (if exists)
   * - All tasks state (including soft-deleted)
   *
   * Archives the previous active snapshot if one exists.
   *
   * @param issueNumber - Issue number
   * @param snapshotType - Type of snapshot being created
   * @param createdBy - Who/what created this snapshot
   * @param notes - Optional notes about this version
   * @returns The created snapshot with captured state
   */
  createSnapshot(
    issueNumber: number,
    snapshotType: SnapshotType,
    createdBy: string,
    notes?: string
  ): Snapshot {
    // Get current live state
    const issue = this.issueRepository.findByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    const plan = this.planRepository.findByIssueId(issue.id);
    const tasks = plan
      ? this.taskRepository.findByPlanId(plan.id, true) // Include deleted
      : [];

    // Archive current active snapshot (if exists)
    this.snapshotRepository.archiveCurrent(issueNumber);

    // Create snapshot with captured state
    const snapshot = this.snapshotRepository.create({
      issueNumber,
      status: "ACTIVE",
      snapshotType,
      issueState: this.captureIssueState(issue),
      planState: plan ? this.capturePlanState(plan) : null,
      tasksState: tasks.map((t) => this.captureTaskState(t)),
      createdBy,
      notes,
    });

    return snapshot;
  }

  /**
   * Revert to a previous snapshot version
   *
   * Restores live state from snapshot JSON.
   * Creates a new snapshot before reverting (backup).
   * Creates another snapshot after reverting (records the revert).
   *
   * @param issueNumber - Issue number
   * @param version - Version number to revert to
   * @param createdBy - Who initiated the revert
   * @param notes - Optional notes about why reverting
   * @returns The new snapshot created after reverting
   */
  revertToSnapshot(
    issueNumber: number,
    version: number,
    createdBy: string,
    notes?: string
  ): Snapshot {
    // Find the target snapshot
    const targetSnapshot = this.snapshotRepository.findByVersion(
      issueNumber,
      version
    );
    if (!targetSnapshot) {
      throw new Error(
        `Snapshot not found: issue #${issueNumber} version ${version}`
      );
    }

    // Create backup snapshot of current state before reverting
    this.createSnapshot(
      issueNumber,
      "MANUAL",
      createdBy,
      `Pre-revert backup (before reverting to v${version})`
    );

    // Get current issue
    const issue = this.issueRepository.findByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    // Restore issue state from snapshot
    this.issueRepository.update(issue.id, {
      title: targetSnapshot.issueState.title,
      description: targetSnapshot.issueState.description,
      type: targetSnapshot.issueState.type,
      priority: targetSnapshot.issueState.priority,
      status: targetSnapshot.issueState.status,
      acceptanceCriteria: targetSnapshot.issueState.acceptanceCriteria,
      labels: targetSnapshot.issueState.labels,
    });

    // Handle plan restoration
    const currentPlan = this.planRepository.findByIssueId(issue.id);
    if (targetSnapshot.planState) {
      if (currentPlan) {
        // Update existing plan
        this.planRepository.update(currentPlan.id, {
          summary: targetSnapshot.planState.summary,
          approach: targetSnapshot.planState.approach,
          estimatedComplexity: targetSnapshot.planState.estimatedComplexity,
          generatedBy: targetSnapshot.planState.generatedBy,
        });
      } else {
        // Create new plan from snapshot
        this.planRepository.create({
          issueId: issue.id,
          summary: targetSnapshot.planState.summary,
          approach: targetSnapshot.planState.approach,
          estimatedComplexity: targetSnapshot.planState.estimatedComplexity,
          generatedBy: targetSnapshot.planState.generatedBy,
        });
      }
    } else if (currentPlan) {
      // Target had no plan, delete current plan (cascades to tasks)
      this.planRepository.delete(currentPlan.id);
    }

    // Handle tasks restoration
    const plan = this.planRepository.findByIssueId(issue.id);
    if (plan && targetSnapshot.tasksState.length > 0) {
      // Soft delete all current tasks
      const currentTasks = this.taskRepository.findByPlanId(plan.id, false);
      for (const task of currentTasks) {
        if (task.status === "PENDING") {
          this.taskRepository.softDelete(task.id, createdBy);
        }
      }

      // Create new tasks from snapshot state
      for (const taskState of targetSnapshot.tasksState) {
        // Only restore non-deleted tasks from snapshot
        if (!taskState.isDeleted) {
          this.taskRepository.create({
            planId: plan.id,
            title: taskState.title,
            description: taskState.description,
            status: taskState.status,
            source: taskState.source,
            acceptanceCriteria: taskState.acceptanceCriteria,
            estimatedMinutes: taskState.estimatedMinutes,
            isDeleted: false,
            hookConfigLabels: taskState.hookConfigLabels,
            startedAt: taskState.startedAt,
            completedAt: taskState.completedAt,
            abandonedAt: taskState.abandonedAt,
            matchedFromTaskId: taskState.id, // Track that this was restored
            matchConfidence: 1.0, // Perfect match (exact restore)
          });
        }
      }
    }

    // Create snapshot recording the revert
    return this.createSnapshot(
      issueNumber,
      "MANUAL",
      createdBy,
      notes || `Reverted to version ${version}`
    );
  }

  /**
   * View historical state at a specific version (read-only)
   *
   * Returns the captured state from the snapshot without modifying live state.
   *
   * @param issueNumber - Issue number
   * @param version - Version number to view
   * @returns Snapshot data with captured state
   */
  viewSnapshot(issueNumber: number, version: number): SnapshotData {
    const snapshot = this.snapshotRepository.findByVersion(
      issueNumber,
      version
    );
    if (!snapshot) {
      throw new Error(
        `Snapshot not found: issue #${issueNumber} version ${version}`
      );
    }

    return {
      snapshot,
      issue: snapshot.issueState,
      plan: snapshot.planState,
      tasks: snapshot.tasksState,
    };
  }

  /**
   * Get snapshot history for an issue
   *
   * @param issueNumber - Issue number
   * @returns Array of snapshots ordered by version DESC (newest first)
   */
  getSnapshotHistory(issueNumber: number): Snapshot[] {
    return this.snapshotRepository.findByIssueNumber(issueNumber);
  }

  /**
   * Capture issue state for snapshot
   */
  private captureIssueState(issue: Issue): SnapshotIssueState {
    return {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      description: issue.description,
      type: issue.type,
      priority: issue.priority,
      status: issue.status,
      acceptanceCriteria: issue.acceptanceCriteria,
      labels: issue.labels,
      templateUsed: issue.templateUsed,
      createdBy: issue.createdBy,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    };
  }

  /**
   * Capture plan state for snapshot
   */
  private capturePlanState(plan: Plan): SnapshotPlanState {
    return {
      id: plan.id,
      issueId: plan.issueId,
      summary: plan.summary,
      approach: plan.approach,
      estimatedComplexity: plan.estimatedComplexity,
      generatedBy: plan.generatedBy,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  }

  /**
   * Capture task state for snapshot
   */
  private captureTaskState(task: Task): SnapshotTaskState {
    return {
      id: task.id,
      planId: task.planId,
      order: task.order,
      title: task.title,
      description: task.description,
      status: task.status,
      source: task.source,
      acceptanceCriteria: task.acceptanceCriteria,
      estimatedMinutes: task.estimatedMinutes,
      isDeleted: task.isDeleted,
      deletedAt: task.deletedAt,
      deletedBy: task.deletedBy,
      hookConfigLabels: task.hookConfigLabels,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      abandonedAt: task.abandonedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
}
