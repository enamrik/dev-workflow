import type { Snapshot, SnapshotRepository, SnapshotType } from "../domain/snapshot.js";
import type { Issue, IssueRepository } from "../domain/issue.js";
import type { Plan, PlanRepository } from "../domain/plan.js";
import type { Task, TaskRepository } from "../domain/task.js";

/**
 * Complete snapshot data including all related entities
 */
export interface SnapshotData {
  snapshot: Snapshot;
  issue: Issue;
  plan?: Plan;
  tasks: Task[];
}

/**
 * VersioningService coordinates snapshot creation and restoration
 *
 * Responsibilities:
 * - Create atomic snapshots (issue + plan + tasks)
 * - Archive previous active snapshot
 * - Handle snapshot restoration
 * - Coordinate between repositories
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
   * Create a new snapshot of current issue+plan+tasks state
   *
   * Archives the previous active snapshot if one exists.
   *
   * @param issueNumber - Issue number
   * @param snapshotType - Type of snapshot being created
   * @param createdBy - Who/what created this snapshot
   * @param notes - Optional notes about this version
   * @returns Complete snapshot data
   */
  createSnapshot(
    issueNumber: number,
    snapshotType: SnapshotType,
    createdBy: string,
    notes?: string
  ): SnapshotData {
    // Archive current active snapshot if exists
    this.snapshotRepository.archiveCurrent(issueNumber);

    // Create new snapshot
    const snapshot = this.snapshotRepository.create({
      issueNumber,
      status: "ACTIVE",
      snapshotType,
      createdBy,
      notes,
    });

    // Get current issue, plan, and tasks for this snapshot
    const issue = this.findIssueByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    const plan = this.planRepository.findActiveByIssueId(issue.id);
    const tasks = plan ? this.taskRepository.findByPlanId(plan.id) : [];

    return {
      snapshot,
      issue,
      plan: plan ?? undefined,
      tasks,
    };
  }

  /**
   * Revert to a previous version snapshot
   *
   * Creates a new snapshot based on old data (doesn't modify the old snapshot).
   *
   * @param issueNumber - Issue number
   * @param version - Version number to revert to
   * @param createdBy - Who initiated the revert
   * @param notes - Optional notes about why reverting
   * @returns Complete snapshot data for the new snapshot
   */
  revertToSnapshot(
    issueNumber: number,
    version: number,
    createdBy: string,
    notes?: string
  ): SnapshotData {
    // Find the target snapshot
    const targetSnapshot = this.findSnapshotByVersion(issueNumber, version);
    if (!targetSnapshot) {
      throw new Error(
        `Snapshot not found: issue #${issueNumber} version ${version}`
      );
    }

    // Get the old data
    const oldIssue = this.issueRepository.findBySnapshotId(targetSnapshot.id);
    if (!oldIssue) {
      throw new Error(`Issue not found for snapshot: ${targetSnapshot.id}`);
    }

    const oldPlan = this.planRepository.findBySnapshotId(targetSnapshot.id);
    const oldTasks = this.taskRepository.findBySnapshotId(targetSnapshot.id);

    // Archive current active snapshot
    this.snapshotRepository.archiveCurrent(issueNumber);

    // Create new snapshot for the revert
    const newSnapshot = this.snapshotRepository.create({
      issueNumber,
      status: "ACTIVE",
      snapshotType: "MANUAL",
      createdBy,
      notes: notes || `Reverted to version ${version}`,
    });

    // Create new issue based on old data
    const newIssue = this.issueRepository.create({
      title: oldIssue.title,
      description: oldIssue.description,
      acceptanceCriteria: oldIssue.acceptanceCriteria,
      type: oldIssue.type,
      priority: oldIssue.priority,
      status: oldIssue.status,
      labels: oldIssue.labels,
      templateUsed: oldIssue.templateUsed,
      createdBy: oldIssue.createdBy,
    });

    // Update new issue to link to snapshot
    this.issueRepository.update(newIssue.id, {
      snapshotId: newSnapshot.id,
    });

    // Create new plan if old one existed
    let newPlan: Plan | undefined;
    if (oldPlan) {
      newPlan = this.planRepository.create({
        snapshotId: newSnapshot.id,
        issueId: newIssue.id,
        summary: oldPlan.summary,
        approach: oldPlan.approach,
        estimatedComplexity: oldPlan.estimatedComplexity,
        generatedBy: oldPlan.generatedBy,
      });
    }

    // Create new tasks based on old tasks
    const newTasks: Task[] = [];
    if (oldPlan && newPlan) {
      const taskData = oldTasks.map((oldTask) => ({
        snapshotId: newSnapshot.id,
        planId: newPlan!.id,
        title: oldTask.title,
        description: oldTask.description,
        acceptanceCriteria: oldTask.acceptanceCriteria,
        status: oldTask.status,
        estimatedMinutes: oldTask.estimatedMinutes,
        matchedFromTaskId: oldTask.id, // Track that this was reverted
        matchConfidence: 1.0, // Perfect match since it's a revert
      }));

      newTasks.push(...this.taskRepository.createMany(taskData));
    }

    return {
      snapshot: newSnapshot,
      issue: newIssue,
      plan: newPlan,
      tasks: newTasks,
    };
  }

  /**
   * Get complete snapshot data
   *
   * @param snapshotId - Snapshot UUID
   * @returns Complete snapshot data
   */
  getSnapshot(snapshotId: string): SnapshotData {
    const snapshot = this.snapshotRepository.findById(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const issue = this.issueRepository.findBySnapshotId(snapshotId);
    if (!issue) {
      throw new Error(`Issue not found for snapshot: ${snapshotId}`);
    }

    const plan = this.planRepository.findBySnapshotId(snapshotId);
    const tasks = this.taskRepository.findBySnapshotId(snapshotId);

    return {
      snapshot,
      issue,
      plan: plan ?? undefined,
      tasks,
    };
  }

  /**
   * Get snapshot history for an issue
   *
   * @param issueNumber - Issue number
   * @returns Array of snapshots ordered by version DESC
   */
  getSnapshotHistory(issueNumber: number): Snapshot[] {
    return this.snapshotRepository.findByIssueNumber(issueNumber);
  }

  /**
   * Find issue by number (helper method)
   */
  private findIssueByNumber(issueNumber: number): Issue | null {
    const allIssues = this.issueRepository.findMany();
    return allIssues.find((issue) => issue.number === issueNumber) ?? null;
  }

  /**
   * Find snapshot by issue number and version (helper method)
   */
  private findSnapshotByVersion(
    issueNumber: number,
    version: number
  ): Snapshot | null {
    const snapshots = this.snapshotRepository.findByIssueNumber(issueNumber);
    return snapshots.find((s) => s.version === version) ?? null;
  }
}
