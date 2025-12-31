import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import {
  DatabaseService,
  SqliteIssueRepository,
  SqlitePlanRepository,
  SqliteTaskRepository,
  type Issue,
  type Plan,
  type Task,
} from "@dev-workflow/core";

/**
 * Represents a project with its ID and database path
 */
export interface Project {
  readonly id: string;
  readonly trackDirectory: string;
  readonly databasePath: string;
}

/**
 * Issue with project context
 */
export interface ProjectIssue extends Issue {
  projectId: string;
}

/**
 * Task with project and issue context
 */
export interface ProjectTask extends Task {
  projectId: string;
  issueNumber: number;
  issueTitle: string;
}

/**
 * Issue with plan info and project context
 */
export interface ProjectIssueWithPlanInfo {
  issue: ProjectIssue;
  hasPlan: boolean;
  taskCounts?: {
    total: number;
    completed: number;
    inProgress: number;
  };
}

/**
 * Issue with tasks and project context
 */
export interface ProjectIssueWithTasks {
  issue: ProjectIssue;
  plan: Plan | null;
  tasks: Task[];
}

interface ProjectConnection {
  dbService: DatabaseService;
  issueRepository: SqliteIssueRepository;
  planRepository: SqlitePlanRepository;
  taskRepository: SqliteTaskRepository;
}

/**
 * MultiProjectService manages connections to multiple project databases
 * and provides aggregated views of issues and tasks across all projects.
 */
export class MultiProjectService {
  private connections: Map<string, ProjectConnection> = new Map();

  constructor(private readonly globalTrackDir: string = path.join(os.homedir(), ".track")) {}

  /**
   * List all projects in the global track directory
   */
  async listProjects(): Promise<Project[]> {
    const projects: Project[] = [];

    try {
      const entries = await fs.readdir(this.globalTrackDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const projectId = entry.name;
        const trackDirectory = path.join(this.globalTrackDir, projectId);
        const databasePath = path.join(trackDirectory, "data", "workflow.db");

        // Verify database exists
        try {
          await fs.access(databasePath);
          projects.push({ id: projectId, trackDirectory, databasePath });
        } catch {
          // Skip projects without a valid database
          continue;
        }
      }
    } catch {
      // Global track directory doesn't exist - return empty list
      return [];
    }

    return projects.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Get or create a database connection for a project
   */
  private async getConnection(project: Project): Promise<ProjectConnection> {
    const existing = this.connections.get(project.id);
    if (existing) {
      return existing;
    }

    const dbService = await DatabaseService.create(project.databasePath);
    const db = dbService.getDb();
    const issueRepository = new SqliteIssueRepository(db);
    const planRepository = new SqlitePlanRepository(db);
    const taskRepository = new SqliteTaskRepository(db);

    const connection: ProjectConnection = {
      dbService,
      issueRepository,
      planRepository,
      taskRepository,
    };

    this.connections.set(project.id, connection);
    return connection;
  }

  /**
   * List all issues across all projects (or filtered by project)
   */
  async listIssues(projectFilter?: string): Promise<ProjectIssueWithPlanInfo[]> {
    const projects = await this.listProjects();
    const filteredProjects = projectFilter
      ? projects.filter((p) => p.id === projectFilter)
      : projects;

    const allIssues: ProjectIssueWithPlanInfo[] = [];

    for (const project of filteredProjects) {
      const connection = await this.getConnection(project);
      const issues = connection.issueRepository.findMany({});

      for (const issue of issues) {
        const plan = connection.planRepository.findByIssueId(issue.id);
        let taskCounts: ProjectIssueWithPlanInfo["taskCounts"];

        if (plan) {
          const tasks = connection.taskRepository.findByPlanId(plan.id);
          const completed = tasks.filter((t) => t.status === "COMPLETED").length;
          const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;

          taskCounts = {
            total: tasks.length,
            completed,
            inProgress,
          };
        }

        allIssues.push({
          issue: { ...issue, projectId: project.id },
          hasPlan: !!plan,
          taskCounts,
        });
      }
    }

    // Sort by project, then by number descending
    return allIssues.sort((a, b) => {
      if (a.issue.projectId !== b.issue.projectId) {
        return a.issue.projectId.localeCompare(b.issue.projectId);
      }
      return b.issue.number - a.issue.number;
    });
  }

  /**
   * Get a single issue by project and number
   */
  async getIssue(
    projectId: string,
    issueNumber: number
  ): Promise<{ issue: ProjectIssue; plan: Plan | null; tasks: Task[] } | null> {
    const projects = await this.listProjects();
    const project = projects.find((p) => p.id === projectId);
    if (!project) return null;

    const connection = await this.getConnection(project);
    const issue = connection.issueRepository.findByNumber(issueNumber);
    if (!issue) return null;

    const plan = connection.planRepository.findByIssueId(issue.id);
    const tasks = plan ? connection.taskRepository.findByPlanId(plan.id) : [];

    return {
      issue: { ...issue, projectId },
      plan,
      tasks,
    };
  }

  /**
   * List all tasks across all projects (for kanban board)
   */
  async listTasks(
    projectFilter?: string,
    issueFilter?: number
  ): Promise<ProjectIssueWithTasks[]> {
    const projects = await this.listProjects();
    const filteredProjects = projectFilter
      ? projects.filter((p) => p.id === projectFilter)
      : projects;

    const allIssuesWithTasks: ProjectIssueWithTasks[] = [];

    for (const project of filteredProjects) {
      const connection = await this.getConnection(project);
      const issues = connection.issueRepository.findMany({});

      for (const issue of issues) {
        // Apply issue filter if specified
        if (issueFilter !== undefined && issue.number !== issueFilter) {
          continue;
        }

        const plan = connection.planRepository.findByIssueId(issue.id);
        const tasks = plan ? connection.taskRepository.findByPlanId(plan.id) : [];

        // Only include issues that have tasks
        if (tasks.length > 0) {
          allIssuesWithTasks.push({
            issue: { ...issue, projectId: project.id },
            plan,
            tasks,
          });
        }
      }
    }

    return allIssuesWithTasks;
  }

  /**
   * Close all database connections
   */
  async close(): Promise<void> {
    for (const connection of this.connections.values()) {
      connection.dbService.close();
    }
    this.connections.clear();
  }
}
