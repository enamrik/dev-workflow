import {
  TrackDirectoryResolver,
  DataSourceFactory,
  SqliteProjectRepository,
  SqliteTaskRepository,
  SqliteIssueRepository,
  NodeGitWorktreeService,
  NodeGitOperations,
  resolveConfig,
  type Project,
} from "@dev-workflow/core";
import { UninstallService } from "./uninstall.service.js";
import { InstallService } from "./install.service.js";
import { FileSystem } from "../infrastructure/file-system.js";

export class ArchiveError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
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
    private readonly resolver: TrackDirectoryResolver,
    private readonly packageRoot?: string
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
      const nonMainWorktrees = worktrees.filter((wt) => !wt.isMain);
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
    const dbService = await DataSourceFactory.createSqlite(dbPath);

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
      errors.push(
        "Tasks are in progress (IN_PROGRESS or PR_REVIEW). Complete or abandon them before archiving."
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if there are any issues that are not CLOSED.
   *
   * @param projectId - Project UUID
   * @returns true if there are open issues that would block nuking
   */
  async hasOpenIssues(projectId: string): Promise<boolean> {
    const dbPath = this.resolver.getDatabasePath();
    const dbService = await DataSourceFactory.createSqlite(dbPath);

    try {
      const issueRepository = new SqliteIssueRepository(dbService.getDb(), projectId);

      // Get all non-deleted issues
      const issues = issueRepository.findMany({ includeDeleted: false });

      // Check if any are not CLOSED
      return issues.some((issue) => issue.status !== "CLOSED");
    } finally {
      dbService.close();
    }
  }

  /**
   * Validate that the project can be nuked.
   *
   * Requirements:
   * - All issues must be CLOSED
   * - No active worktrees (non-main)
   *
   * @param projectId - Project UUID
   * @returns Validation result with any errors
   */
  async validateForNuke(projectId: string): Promise<ValidationResult> {
    const errors: string[] = [];

    // Check for active worktrees
    const hasWorktrees = await this.hasActiveWorktrees();
    if (hasWorktrees) {
      errors.push("Active worktrees exist. Remove worktrees before nuking.");
    }

    // Check for open issues
    const hasOpen = await this.hasOpenIssues(projectId);
    if (hasOpen) {
      errors.push("Some issues are not CLOSED. Close all issues before nuking.");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Nuke the project - permanently delete all data.
   *
   * 1. Validates all issues are CLOSED and no worktrees
   * 2. Removes Claude integration (skills, MCP)
   * 3. Hard deletes project from database (cascades to all data)
   * 4. Removes track directory (~/.track/<project>/)
   *
   * WARNING: This operation is IRREVERSIBLE.
   *
   * @param project - The project to nuke
   * @throws ArchiveError if validation fails or nuking fails
   */
  async nuke(project: Project): Promise<void> {
    // Validate
    const validation = await this.validateForNuke(project.id);
    if (!validation.valid) {
      throw new ArchiveError(
        `Cannot nuke project:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}`
      );
    }

    // Remove Claude integration (uninit)
    const uninstaller = new UninstallService(this.fileSystem, this.workingDirectory, this.resolver);
    await uninstaller.removeSkills();
    await uninstaller.unregisterMCPServer();

    // Hard delete project from database
    const dbPath = this.resolver.getDatabasePath();
    const dbService = await DataSourceFactory.createSqlite(dbPath);

    try {
      const projectRepository = new SqliteProjectRepository(dbService.getDb());
      projectRepository.hardDelete(project.id);
    } finally {
      dbService.close();
    }

    // Remove track directory
    const trackDir = this.resolver.getTrackDirectory();
    const trackDirExists = await this.fileSystem.exists(trackDir);
    if (trackDirExists) {
      await this.fileSystem.rmdir(trackDir, { recursive: true });
    }
  }

  /**
   * Get the project for the current repository.
   *
   * Looks up the project by gitRootHash (first commit hash).
   *
   * @returns The project if found, null otherwise
   */
  async getProject(): Promise<Project | null> {
    const dbPath = this.resolver.getDatabasePath();
    const dbExists = await this.fileSystem.exists(dbPath);

    if (!dbExists) {
      return null;
    }

    const dbService = await DataSourceFactory.createSqlite(dbPath);

    try {
      const projectRepository = new SqliteProjectRepository(dbService.getDb());
      const gitOps = new NodeGitOperations();

      // Look up by gitRootHash (first commit hash)
      const gitRootHash = await gitOps.getInitialCommitHash(this.workingDirectory);
      return await projectRepository.findByGitRootHash(gitRootHash);
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
        `Cannot archive project:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}`
      );
    }

    // Remove Claude integration (uninit)
    const uninstaller = new UninstallService(this.fileSystem, this.workingDirectory, this.resolver);
    await uninstaller.removeSkills();
    await uninstaller.unregisterMCPServer();

    // Mark project as archived in database
    const dbPath = this.resolver.getDatabasePath();
    const dbService = await DataSourceFactory.createSqlite(dbPath);

    try {
      const projectRepository = new SqliteProjectRepository(dbService.getDb());
      return await projectRepository.archive(project.id);
    } finally {
      dbService.close();
    }
  }

  /**
   * Find an archived project by git root hash.
   *
   * Used by init to detect if this repo was previously archived.
   *
   * @returns The archived project if found, null otherwise
   */
  async findArchivedProjectByGitHash(): Promise<Project | null> {
    const dbPath = this.resolver.getDatabasePath();
    const dbExists = await this.fileSystem.exists(dbPath);

    if (!dbExists) {
      return null;
    }

    const dbService = await DataSourceFactory.createSqlite(dbPath);

    try {
      const projectRepository = new SqliteProjectRepository(dbService.getDb());
      const gitOps = new NodeGitOperations();

      // Get gitRootHash for current directory
      const gitRootHash = await gitOps.getInitialCommitHash(this.workingDirectory);

      // Look up by gitRootHash
      const project = await projectRepository.findByGitRootHash(gitRootHash);

      // Only return if it's archived
      if (project && project.isArchived) {
        return project;
      }

      return null;
    } finally {
      dbService.close();
    }
  }

  /**
   * Unarchive a project.
   *
   * 1. Marks project as unarchived in database
   * 2. Re-installs Claude integration (skills, MCP)
   *
   * @param project - The project to unarchive (must be archived)
   * @returns The unarchived project
   * @throws ArchiveError if unarchiving fails
   */
  async unarchive(project: Project): Promise<Project> {
    if (!project.isArchived) {
      throw new ArchiveError("Project is not archived.");
    }

    if (!this.packageRoot) {
      throw new ArchiveError("Package root not provided. Cannot reinstall skills.");
    }

    // Get database connection string from config - must exist for unarchive
    const slug = this.resolver.getProjectId();
    let databaseConnectionString: string;
    try {
      const config = await resolveConfig(slug);
      databaseConnectionString = config.database;
    } catch {
      throw new ArchiveError(
        `Config not found for project "${slug}". ` +
          `Run 'dev-workflow init' to recreate the configuration.`
      );
    }

    const dbPath = this.resolver.getDatabasePath();
    const dbService = await DataSourceFactory.createSqlite(dbPath);

    try {
      const projectRepository = new SqliteProjectRepository(dbService.getDb());

      // Mark project as unarchived in database first
      const unarchivedProject = await projectRepository.unarchive(project.id);

      // Re-install Claude integration
      const installer = new InstallService(
        this.fileSystem,
        this.workingDirectory,
        this.packageRoot,
        this.resolver,
        databaseConnectionString
      );

      // Set the project so installer can use it
      installer.setProject(unarchivedProject);

      // Ensure track directory exists (it should, since archive preserves it)
      const trackDir = this.resolver.getTrackDirectory();
      const trackDirExists = await this.fileSystem.exists(trackDir);
      if (!trackDirExists) {
        await installer.createTrackDirectory();
      }

      // Re-install skills
      await installer.installSkills();

      // Re-register MCP server
      await installer.registerMCPServer();

      return unarchivedProject;
    } finally {
      dbService.close();
    }
  }
}
