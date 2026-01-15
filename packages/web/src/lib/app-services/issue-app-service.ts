/**
 * IssueAppService - Application service for issue operations in web context
 *
 * This service handles project resolution and delegates to core IssueService.
 * Endpoints call this service with projectSlug + issueNumber, and the service
 * handles all the complexity of resolving the project and creating services.
 */

import {
  ProjectsResolver,
  DbSourceProvider,
  IssueService,
  IssueStatusService,
  TaskService,
  NoOpProjectManagementProvider,
  EntityNotFoundError,
  BusinessRuleError,
  isIssueInPlanning,
  type Issue,
  type Plan,
  type Task,
  type CloseIssueResult,
  type DbClient,
} from "@dev-workflow/core";

/**
 * Issue details with plan and tasks
 */
export interface IssueWithDetails {
  issue: Issue;
  plan: Plan | null;
  tasks: Task[];
}

/**
 * Result of moving tasks to READY or BACKLOG
 */
export interface MoveTasksResult {
  issue: Issue;
  tasksUpdated: number;
  tasks: Array<{ id: string; number: number; title: string }>;
}

/**
 * Result of activating a PLANNED issue
 */
export interface ActivateIssueResult {
  issue: Issue;
  previousStatus: string;
  tasksActivated: number;
  tasks: Array<{ id: string; number: number; title: string }>;
}

/**
 * IssueAppService - Handles issue operations with project resolution
 *
 * All methods take projectSlug to identify the project, then resolve
 * the project and create the appropriate services.
 */
export class IssueAppService {
  constructor(
    private readonly projectsResolver: ProjectsResolver,
    private readonly sourceProvider: DbSourceProvider
  ) {}

  /**
   * Get issue with plan and tasks
   */
  async getIssueWithDetails(projectSlug: string, issueNumber: number): Promise<IssueWithDetails> {
    const db = await this.getDbClient(projectSlug);

    const issue = db.issues.findByNumber(issueNumber);
    if (!issue) {
      throw new EntityNotFoundError("Issue", `#${issueNumber}`);
    }

    const plan = db.plans.findByIssueId(issue.id);
    const tasks = plan ? db.tasks.findByPlanId(plan.id) : [];

    return { issue, plan, tasks };
  }

  /**
   * Close an issue (abandons incomplete tasks)
   */
  async closeIssue(
    projectSlug: string,
    issueNumber: number,
    actor = "web-ui"
  ): Promise<CloseIssueResult> {
    const db = await this.getDbClient(projectSlug);
    const issueService = this.createIssueService(db);

    const issue = db.issues.findByNumber(issueNumber);
    if (!issue) {
      throw new EntityNotFoundError("Issue", `#${issueNumber}`);
    }

    return issueService.closeIssue(issue.id, true, actor);
  }

  /**
   * Delete an issue (soft delete, only allowed for PLANNED issues)
   */
  async deleteIssue(projectSlug: string, issueNumber: number, actor = "web-ui"): Promise<Issue> {
    const db = await this.getDbClient(projectSlug);
    const issueService = this.createIssueService(db);

    const issue = db.issues.findByNumber(issueNumber);
    if (!issue) {
      throw new EntityNotFoundError("Issue", `#${issueNumber}`);
    }

    // Only PLANNED issues can be deleted - once work begins, use close instead
    if (!isIssueInPlanning(issue)) {
      throw new BusinessRuleError(
        `Only PLANNED issues can be deleted. Current status: ${issue.status}. Use close_issue instead.`
      );
    }

    return issueService.delete(issue.id, actor);
  }

  /**
   * Move issue tasks to READY status (only allowed for OPEN issues)
   */
  async moveToReady(projectSlug: string, issueNumber: number): Promise<MoveTasksResult> {
    const db = await this.getDbClient(projectSlug);

    const issue = db.issues.findByNumber(issueNumber);
    if (!issue) {
      throw new EntityNotFoundError("Issue", `#${issueNumber}`);
    }

    // Only OPEN issues can have tasks moved to READY
    if (issue.status !== "OPEN") {
      throw new BusinessRuleError(
        `Issue must be in OPEN status to move tasks to ready. Current status: ${issue.status}`
      );
    }

    const plan = db.plans.findByIssueId(issue.id);
    if (!plan) {
      throw new BusinessRuleError("No plan found for this issue. Generate a plan first.");
    }

    const allTasks = db.tasks.findByPlanId(plan.id);
    const readiedTasks: Array<{ id: string; number: number; title: string }> = [];

    for (const task of allTasks) {
      if (task.status === "BACKLOG") {
        db.tasks.updateStatus(task.id, "READY");
        readiedTasks.push({ id: task.id, number: task.number, title: task.title });
      }
    }

    return { issue, tasksUpdated: readiedTasks.length, tasks: readiedTasks };
  }

  /**
   * Move issue tasks back to BACKLOG status (pause)
   */
  async moveToBacklog(projectSlug: string, issueNumber: number): Promise<MoveTasksResult> {
    const db = await this.getDbClient(projectSlug);

    const issue = db.issues.findByNumber(issueNumber);
    if (!issue) {
      throw new EntityNotFoundError("Issue", `#${issueNumber}`);
    }

    const plan = db.plans.findByIssueId(issue.id);
    if (!plan) {
      return { issue, tasksUpdated: 0, tasks: [] };
    }

    const allTasks = db.tasks.findByPlanId(plan.id);
    const pausedTasks: Array<{ id: string; number: number; title: string }> = [];

    for (const task of allTasks) {
      if (task.status === "READY") {
        db.tasks.updateStatus(task.id, "BACKLOG");
        pausedTasks.push({ id: task.id, number: task.number, title: task.title });
      }
    }

    return { issue, tasksUpdated: pausedTasks.length, tasks: pausedTasks };
  }

  /**
   * Activate a PLANNED issue (PLANNED → OPEN + PLANNED tasks → BACKLOG)
   */
  async activateIssue(projectSlug: string, issueNumber: number): Promise<ActivateIssueResult> {
    const db = await this.getDbClient(projectSlug);
    const issueService = this.createIssueService(db);

    const issue = db.issues.findByNumber(issueNumber);
    if (!issue) {
      throw new EntityNotFoundError("Issue", `#${issueNumber}`);
    }

    // Only PLANNED issues can be activated
    if (!isIssueInPlanning(issue)) {
      throw new BusinessRuleError(
        `Issue must be in PLANNED status to activate. Current status: ${issue.status}`
      );
    }

    const plan = db.plans.findByIssueId(issue.id);
    if (!plan) {
      throw new BusinessRuleError("No plan found for this issue. Generate a plan first.");
    }

    const previousStatus = issue.status;

    // Transition all PLANNED tasks to BACKLOG
    const allTasks = db.tasks.findByPlanId(plan.id);
    const activatedTasks: Array<{ id: string; number: number; title: string }> = [];

    for (const task of allTasks) {
      if (task.status === "PLANNED") {
        db.tasks.updateStatus(task.id, "BACKLOG");
        activatedTasks.push({ id: task.id, number: task.number, title: task.title });
      }
    }

    // Transition issue from PLANNED → OPEN
    const updatedIssue = issueService.update(issue.id, { status: "OPEN" });

    return {
      issue: updatedIssue,
      previousStatus,
      tasksActivated: activatedTasks.length,
      tasks: activatedTasks,
    };
  }

  /**
   * Get computed status for an issue
   */
  async getComputedStatus(projectSlug: string, issueNumber: number) {
    const db = await this.getDbClient(projectSlug);

    const issue = db.issues.findByNumber(issueNumber);
    if (!issue) {
      throw new EntityNotFoundError("Issue", `#${issueNumber}`);
    }

    const statusService = new IssueStatusService(db);
    return statusService.computeStatus(issue);
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private async getDbClient(projectSlug: string): Promise<DbClient> {
    const projectInfo = await this.projectsResolver.getProjectBySlug(projectSlug);
    const source = this.sourceProvider.getOrCreate(projectInfo.sourceInfo);
    await source.provision();
    return source.createClient(projectInfo.projectId);
  }

  private createIssueService(db: DbClient): IssueService {
    const noOpProvider = new NoOpProjectManagementProvider();
    const taskService = new TaskService(db, noOpProvider, null);
    return new IssueService(db, taskService, noOpProvider);
  }
}
