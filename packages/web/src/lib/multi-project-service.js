import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { DatabaseService, SqliteIssueRepository, SqlitePlanRepository, SqliteTaskRepository, SqliteMilestoneRepository, getGlobalDatabasePath, } from "@dev-workflow/core";
/**
 * MultiProjectService manages access to the global database
 * and provides aggregated views of issues and tasks across all projects.
 */
export class MultiProjectService {
    globalTrackDir;
    dbService = null;
    planRepository = null;
    taskRepository = null;
    constructor(globalTrackDir = path.join(os.homedir(), ".track")) {
        this.globalTrackDir = globalTrackDir;
    }
    /**
     * Get the global database path
     */
    getDatabasePath() {
        return getGlobalDatabasePath();
    }
    /**
     * Initialize the database connection (lazy)
     */
    async ensureConnection() {
        if (this.dbService && this.planRepository && this.taskRepository) {
            return { planRepository: this.planRepository, taskRepository: this.taskRepository };
        }
        const dbPath = this.getDatabasePath();
        // Check if database exists
        try {
            await fs.access(dbPath);
        }
        catch {
            throw new Error(`Global database not found at ${dbPath}. Run 'dev-workflow init' first.`);
        }
        this.dbService = await DatabaseService.create(dbPath);
        const db = this.dbService.getDb();
        this.planRepository = new SqlitePlanRepository(db);
        this.taskRepository = new SqliteTaskRepository(db);
        return { planRepository: this.planRepository, taskRepository: this.taskRepository };
    }
    /**
     * Get an issue repository for a specific project
     */
    async getIssueRepository(projectId) {
        await this.ensureConnection();
        const db = this.dbService.getDb();
        return new SqliteIssueRepository(db, projectId);
    }
    /**
     * Get a milestone repository for a specific project
     */
    async getMilestoneRepository(projectId) {
        await this.ensureConnection();
        const db = this.dbService.getDb();
        return new SqliteMilestoneRepository(db, projectId);
    }
    /**
     * List all projects in the global track directory
     */
    async listProjects() {
        const projects = [];
        try {
            const entries = await fs.readdir(this.globalTrackDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                // Skip the workflow.db file and hidden directories
                if (entry.name.startsWith(".") || entry.name === "workflow.db")
                    continue;
                const projectId = entry.name;
                const trackDirectory = path.join(this.globalTrackDir, projectId);
                // Verify config.json exists (indicates valid project)
                try {
                    await fs.access(path.join(trackDirectory, "config.json"));
                    projects.push({ id: projectId, trackDirectory });
                }
                catch {
                    // Skip directories without config (not valid projects)
                    continue;
                }
            }
        }
        catch {
            // Global track directory doesn't exist - return empty list
            return [];
        }
        return projects.sort((a, b) => a.id.localeCompare(b.id));
    }
    /**
     * List all issues across all projects (or filtered by project)
     */
    async listIssues(projectFilter) {
        const projects = await this.listProjects();
        const filteredProjects = projectFilter
            ? projects.filter((p) => p.id === projectFilter)
            : projects;
        const { planRepository, taskRepository } = await this.ensureConnection();
        const allIssues = [];
        for (const project of filteredProjects) {
            const issueRepository = await this.getIssueRepository(project.id);
            const issues = issueRepository.findMany({});
            for (const issue of issues) {
                const plan = planRepository.findByIssueId(issue.id);
                let taskCounts;
                if (plan) {
                    const tasks = taskRepository.findByPlanId(plan.id);
                    const completed = tasks.filter((t) => t.status === "COMPLETED").length;
                    const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
                    taskCounts = {
                        total: tasks.length,
                        completed,
                        inProgress,
                    };
                }
                allIssues.push({
                    issue,
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
    async getIssue(projectId, issueNumber) {
        const { planRepository, taskRepository } = await this.ensureConnection();
        const issueRepository = await this.getIssueRepository(projectId);
        const issue = issueRepository.findByNumber(issueNumber);
        if (!issue)
            return null;
        const plan = planRepository.findByIssueId(issue.id);
        const tasks = plan ? taskRepository.findByPlanId(plan.id) : [];
        return {
            issue,
            plan,
            tasks,
        };
    }
    /**
     * List all tasks across all projects (for kanban board)
     */
    async listTasks(projectFilter, issueFilter) {
        const projects = await this.listProjects();
        const filteredProjects = projectFilter
            ? projects.filter((p) => p.id === projectFilter)
            : projects;
        const { planRepository, taskRepository } = await this.ensureConnection();
        const allIssuesWithTasks = [];
        for (const project of filteredProjects) {
            const issueRepository = await this.getIssueRepository(project.id);
            const milestoneRepository = await this.getMilestoneRepository(project.id);
            const issues = issueRepository.findMany({});
            for (const issue of issues) {
                // Apply issue filter if specified
                if (issueFilter !== undefined && issue.number !== issueFilter) {
                    continue;
                }
                // Skip closed issues - they shouldn't appear in the kanban board
                if (issue.status === "CLOSED") {
                    continue;
                }
                const plan = planRepository.findByIssueId(issue.id);
                const tasks = plan ? taskRepository.findByPlanId(plan.id) : [];
                // Get milestone info if issue is assigned to one
                let milestoneNumber;
                let milestoneTitle;
                if (issue.milestoneId) {
                    const milestone = milestoneRepository.findById(issue.milestoneId);
                    if (milestone) {
                        milestoneNumber = milestone.number;
                        milestoneTitle = milestone.title;
                    }
                }
                // Only include issues that have tasks
                if (tasks.length > 0) {
                    allIssuesWithTasks.push({
                        issue,
                        plan,
                        tasks,
                        milestoneNumber,
                        milestoneTitle,
                    });
                }
            }
        }
        return allIssuesWithTasks;
    }
    /**
     * List completed tasks for the Done column across all projects.
     */
    async listCompletedTasks(projectFilter) {
        const projects = await this.listProjects();
        const filteredProjects = projectFilter
            ? projects.filter((p) => p.id === projectFilter)
            : projects;
        const { planRepository, taskRepository } = await this.ensureConnection();
        const allCompletedTasks = [];
        // Calculate cutoff date (7 days ago)
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 7);
        const cutoffDateStr = cutoffDate.toISOString();
        for (const project of filteredProjects) {
            const issueRepository = await this.getIssueRepository(project.id);
            const issues = issueRepository.findMany({});
            for (const issue of issues) {
                const plan = planRepository.findByIssueId(issue.id);
                if (!plan)
                    continue;
                const tasks = taskRepository.findByPlanId(plan.id);
                for (const task of tasks) {
                    // Only include completed or abandoned tasks
                    if (task.status !== "COMPLETED" && task.status !== "ABANDONED") {
                        continue;
                    }
                    // Check if completed within the last 7 days
                    const completionDate = task.completedAt ?? task.abandonedAt;
                    if (!completionDate || completionDate < cutoffDateStr) {
                        continue;
                    }
                    allCompletedTasks.push({
                        ...task,
                        projectId: issue.projectId,
                        issueNumber: issue.number,
                        issueTitle: issue.title,
                        issueStatus: issue.status,
                    });
                }
            }
        }
        // Sort by completion date descending (most recent first)
        allCompletedTasks.sort((a, b) => {
            const dateA = a.completedAt ?? a.abandonedAt ?? "";
            const dateB = b.completedAt ?? b.abandonedAt ?? "";
            return dateB.localeCompare(dateA);
        });
        // Limit to 20 tasks
        return allCompletedTasks.slice(0, 20);
    }
    /**
     * List all milestones across all projects (or filtered by project)
     */
    async listMilestones(projectFilter) {
        const projects = await this.listProjects();
        const filteredProjects = projectFilter
            ? projects.filter((p) => p.id === projectFilter)
            : projects;
        await this.ensureConnection();
        const allMilestones = [];
        for (const project of filteredProjects) {
            const milestoneRepository = await this.getMilestoneRepository(project.id);
            const issueRepository = await this.getIssueRepository(project.id);
            const milestones = milestoneRepository.findMany();
            for (const milestone of milestones) {
                const issues = issueRepository.findMany({ milestoneId: milestone.id });
                const closedIssues = issues.filter((i) => i.status === "CLOSED").length;
                allMilestones.push({
                    milestone,
                    issues: issues.map((i) => ({
                        number: i.number,
                        title: i.title,
                        status: i.status,
                        type: i.type,
                    })),
                    progress: {
                        total: issues.length,
                        closed: closedIssues,
                        percentage: issues.length > 0 ? Math.round((closedIssues / issues.length) * 100) : 0,
                    },
                });
            }
        }
        // Sort by start date
        return allMilestones.sort((a, b) => a.milestone.startDate.localeCompare(b.milestone.startDate));
    }
    /**
     * Close the database connection
     */
    async close() {
        if (this.dbService) {
            this.dbService.close();
            this.dbService = null;
            this.planRepository = null;
            this.taskRepository = null;
        }
    }
}
// Singleton instance for API routes
let serviceInstance = null;
export function getMultiProjectService() {
    if (!serviceInstance) {
        serviceInstance = new MultiProjectService();
    }
    return serviceInstance;
}
//# sourceMappingURL=multi-project-service.js.map