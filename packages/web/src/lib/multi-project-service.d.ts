import { type Issue, type Plan, type Task, type Milestone } from "@dev-workflow/core";
/**
 * Represents a project with its ID and track directory
 */
export interface Project {
    readonly id: string;
    readonly trackDirectory: string;
}
/**
 * Issue with project context (projectId is already part of Issue)
 */
export type ProjectIssue = Issue;
/**
 * Task with project and issue context
 */
export interface ProjectTask extends Task {
    projectId: string;
    issueNumber: number;
    issueTitle: string;
}
/**
 * Completed task with project and issue context for Done column
 */
export interface CompletedTask extends Task {
    projectId: string;
    issueNumber: number;
    issueTitle: string;
    issueStatus: string;
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
    milestoneNumber?: number;
    milestoneTitle?: string;
}
/**
 * Milestone with associated issues and progress
 */
export interface MilestoneWithIssues {
    milestone: Milestone;
    issues: {
        number: number;
        title: string;
        status: string;
        type: string;
    }[];
    progress: {
        total: number;
        closed: number;
        percentage: number;
    };
}
/**
 * MultiProjectService manages access to the global database
 * and provides aggregated views of issues and tasks across all projects.
 */
export declare class MultiProjectService {
    private readonly globalTrackDir;
    private dbService;
    private planRepository;
    private taskRepository;
    constructor(globalTrackDir?: string);
    /**
     * Get the global database path
     */
    private getDatabasePath;
    /**
     * Initialize the database connection (lazy)
     */
    private ensureConnection;
    /**
     * Get an issue repository for a specific project
     */
    private getIssueRepository;
    /**
     * Get a milestone repository for a specific project
     */
    private getMilestoneRepository;
    /**
     * List all projects in the global track directory
     */
    listProjects(): Promise<Project[]>;
    /**
     * List all issues across all projects (or filtered by project)
     */
    listIssues(projectFilter?: string): Promise<ProjectIssueWithPlanInfo[]>;
    /**
     * Get a single issue by project and number
     */
    getIssue(projectId: string, issueNumber: number): Promise<{
        issue: ProjectIssue;
        plan: Plan | null;
        tasks: Task[];
    } | null>;
    /**
     * List all tasks across all projects (for kanban board)
     */
    listTasks(projectFilter?: string, issueFilter?: number): Promise<ProjectIssueWithTasks[]>;
    /**
     * List completed tasks for the Done column across all projects.
     */
    listCompletedTasks(projectFilter?: string): Promise<CompletedTask[]>;
    /**
     * List all milestones across all projects (or filtered by project)
     */
    listMilestones(projectFilter?: string): Promise<MilestoneWithIssues[]>;
    /**
     * Close the database connection
     */
    close(): Promise<void>;
}
export declare function getMultiProjectService(): MultiProjectService;
//# sourceMappingURL=multi-project-service.d.ts.map