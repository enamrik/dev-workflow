import {
  TrackDirectoryResolver,
  DatabaseService,
  SqliteProjectRepository,
  SqliteTaskRepository,
  NodeGitWorktreeService,
  type Project,
} from "@dev-workflow/core";
import { UninstallService } from "./uninstall.service.js";
import { FileSystem } from "../infrastructure/file-system.js";

export class ArchiveError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ArchiveError";
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class ArchiveService {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly workingDirectory: string,
    private readonly resolver: TrackDirectoryResolver
  ) {}

  /**
   * Check if there are any active worktrees (non-main).
   *
   * @returns true if there are active worktrees that would block archiving
   */
  async hasActiveWorktrees(): Promise<boolean> {
    try {
      const gitWorktreeService = new NodeGitWorktreeService(this.workingDirectory);
      const worktrees = await gitWorktreeService.listWorktrees();

      // Filter out main worktree - only count non-main worktrees
      const nonMainWorktrees = worktrees.filter(wt => !wt.isMain);
      return nonMainWorktrees.length > 0;
    } catch {
      // If git worktree command fails, assume no worktrees
      return false;
    }
  }

  /**
   * Check if there are any tasks in IN_PROGRESS or PR_REVIEW status.
   *
   * @param _projectId - Project UUID (currently unused, but kept for future filtering)
   * @returns true if there are active tasks that would block archiving
   */
  async hasInProgressTasks(_projectId: string): Promise<boolean> {
    const dbPath = this.resolver.getDatabasePath();
    const dbService = await DatabaseService.create(dbPath);

    try {
      const taskRepository = new SqliteTaskRepository(dbService.getDb());

      // Check for IN_PROGRESS tasks
      const inProgressTasks = taskRepository.findMany({ status: "IN_PROGRESS" });
      if (inProgressTasks.length > 0) {
        return true;
      }

      // Also check for PR_REVIEW tasks (work in progress awaiting merge)
      const prReviewTasks = taskRepository.findMany({ status: "PR_REVIEW" });
      return prReviewTasks.length > 0;
    } finally {
      dbService.close();
    }
  }

  /**
   * Validate that the project can be archived.
   *
   * Requirements:
   * - No active worktrees (non-main)
   * - No IN_PROGRESS or PR_REVIEW tasks
   *
   * @param projectId - Project UUID
   * @returns Validation result with any errors
   */
  async validateForArchive(projectId: string): Promise<ValidationResult> {
    const errors: string[] = [];

    // Check for active worktrees
    const hasWorktrees = await this.hasActiveWorktrees();
    if (hasWorktrees) {
      errors.push("Active worktrees exist. Complete or abandon tasks before archiving.");
    }

    // Check for in-progress tasks
    const hasActiveTasks = await this.hasInProgressTasks(projectId);
    if (hasActiveTasks) {
      errors.push("Tasks are in progress (IN_PROGRESS or PR_REVIEW). Complete or abandon them before archiving.");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get the project for the current repository.
   *
   * @returns The project if found, null otherwise
   */
  async getProject(): Promise<Project | null> {
    const dbPath = this.resolver.getDatabasePath();
    const dbExists = await this.fileSystem.exists(dbPath);

    if (!dbExists) {
      return null;
    }

    const dbService = await DatabaseService.create(dbPath);

    try {
      const projectRepository = new SqliteProjectRepository(dbService.getDb());

      // Look up by config's projectId
      const configPath = this.resolver.getConfigPath();
      const configExists = await this.fileSystem.exists(configPath);

      if (configExists) {
        const content = await this.fileSystem.readFile(configPath);
        const config = JSON.parse(content);
        if (config.projectId) {
          return projectRepository.findById(config.projectId);
        }
      }

      return null;
    } finally {
      dbService.close();
    }
  }

  /**
   * Archive the project.
   *
   * 1. Validates no active worktrees or in-progress tasks
   * 2. Removes Claude integration (skills, MCP)
   * 3. Marks project as archived in database
   *
   * @returns The archived project
   * @throws ArchiveError if validation fails or archiving fails
   */
  async archive(): Promise<Project> {
    // Get project first
    const project = await this.getProject();
    if (!project) {
      throw new ArchiveError("Project not found. Is dev-workflow initialized?");
    }

    if (project.isArchived) {
      throw new ArchiveError("Project is already archived.");
    }

    // Validate
    const validation = await this.validateForArchive(project.id);
    if (!validation.valid) {
      throw new ArchiveError(
        `Cannot archive project:\n${validation.errors.map(e => `  - ${e}`).join("\n")}`
      );
    }

    // Remove Claude integration (uninit)
    const uninstaller = new UninstallService(
      this.fileSystem,
      this.workingDirectory,
      this.resolver
    );
    await uninstaller.removeSkills();
    await uninstaller.unregisterMCPServer();

    // Mark project as archived in database
    const dbPath = this.resolver.getDatabasePath();
    const dbService = await DatabaseService.create(dbPath);

    try {
      const projectRepository = new SqliteProjectRepository(dbService.getDb());
      return projectRepository.archive(project.id);
    } finally {
      dbService.close();
    }
  }
}
