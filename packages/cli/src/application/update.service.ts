import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { FileSystem } from "../infrastructure/file-system.js";
import {
  TrackDirectoryResolver,
  DatabaseService,
  SqliteProjectRepository,
  ProjectService,
  NodeGitOperations,
  sql,
  resolveGlobalTrackDir,
  type Project,
} from "@dev-workflow/core";
import { UIService } from "./ui.service.js";

export class UpdateError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "UpdateError";
  }
}

/**
 * UpdateService handles updating an existing dev-workflow installation
 *
 * Responsibilities:
 * - Verify dev-workflow is already initialized
 * - Update skills to latest version
 * - Update MCP server registration
 * - Run database migrations
 * - Register/update project in database
 */
export class UpdateService {
  private project: Project | null = null;

  constructor(
    private readonly fileSystem: FileSystem,
    private readonly workingDirectory: string,
    private readonly packageRoot: string,
    private readonly resolver: TrackDirectoryResolver
  ) {}

  /**
   * Register or update the project in the database.
   *
   * Uses git's initial commit hash as stable identifier.
   * Must be called after runMigrations().
   *
   * @returns The registered project
   */
  async registerProject(): Promise<Project> {
    const dbPath = this.resolver.getDatabasePath();
    const dbService = await DatabaseService.create(dbPath);

    try {
      const projectRepo = new SqliteProjectRepository(dbService.getDb());
      const gitOps = new NodeGitOperations();
      const projectService = new ProjectService(projectRepo, gitOps);

      this.project = await projectService.getOrCreateProject(this.workingDirectory);
      return this.project;
    } finally {
      dbService.close();
    }
  }

  /**
   * Get the registered project.
   * @throws Error if registerProject() hasn't been called
   */
  getProject(): Project {
    if (!this.project) {
      throw new UpdateError("Project not registered. Call registerProject() first.");
    }
    return this.project;
  }

  /**
   * Migrate existing issues from old path-based projectId to new UUID-based project.id.
   *
   * This handles the transition from the old system where projectId was computed
   * from the git root path, to the new system where it's a database UUID.
   *
   * Must be called after registerProject() and runMigrations().
   *
   * @returns Number of issues migrated
   */
  async migrateIssues(): Promise<{ migrated: number; oldProjectId: string }> {
    const project = this.getProject();
    const dbPath = this.resolver.getDatabasePath();
    const oldProjectId = this.resolver.getProjectId(); // Path-based ID

    // If old and new projectIds are somehow the same, skip migration
    if (oldProjectId === project.id) {
      return { migrated: 0, oldProjectId };
    }

    const dbService = await DatabaseService.create(dbPath);

    try {
      const db = dbService.getDb();

      // Update issues with old projectId to use new project.id
      const result = db.run(
        sql`UPDATE issues SET project_id = ${project.id} WHERE project_id = ${oldProjectId}`
      );

      // Also update snapshots
      db.run(
        sql`UPDATE snapshots SET project_id = ${project.id} WHERE project_id = ${oldProjectId}`
      );

      // Also update milestones
      db.run(
        sql`UPDATE milestones SET project_id = ${project.id} WHERE project_id = ${oldProjectId}`
      );

      return { migrated: result.changes ?? 0, oldProjectId };
    } finally {
      dbService.close();
    }
  }

  /**
   * Check if dev-workflow is initialized for this project.
   * Also checks for old-style directory naming and returns that path if found.
   */
  async isInitialized(): Promise<boolean> {
    const trackDir = this.resolver.getTrackDirectory();
    if (await this.fileSystem.exists(trackDir)) {
      return true;
    }

    // Check for old-style directory (path-based hash)
    const oldTrackDir = this.getOldStyleTrackDirectory();
    if (oldTrackDir && (await this.fileSystem.exists(oldTrackDir))) {
      return true;
    }

    return false;
  }

  /**
   * Get the old-style track directory path (using path-based hash).
   * Used for migration from old naming to new naming.
   */
  private getOldStyleTrackDirectory(): string {
    const folderName = path.basename(this.workingDirectory);
    const hash = crypto
      .createHash("sha256")
      .update(this.workingDirectory)
      .digest("hex")
      .slice(0, 6);
    return path.join(resolveGlobalTrackDir(), `${folderName}-${hash}`);
  }

  /**
   * Migrate track directory from old naming (path-based hash) to new naming (git-based hash).
   * Returns info about what was migrated.
   */
  async migrateTrackDirectory(): Promise<{
    migrated: boolean;
    oldPath?: string;
    newPath?: string;
  }> {
    const newTrackDir = this.resolver.getTrackDirectory();
    const oldTrackDir = this.getOldStyleTrackDirectory();

    // If they're the same, no migration needed
    if (oldTrackDir === newTrackDir) {
      return { migrated: false };
    }

    // If new directory already exists, no migration needed
    if (await this.fileSystem.exists(newTrackDir)) {
      return { migrated: false };
    }

    // If old directory doesn't exist, no migration needed
    if (!(await this.fileSystem.exists(oldTrackDir))) {
      return { migrated: false };
    }

    // Rename old directory to new directory
    try {
      const fs = await import("node:fs/promises");
      await fs.rename(oldTrackDir, newTrackDir);
      return { migrated: true, oldPath: oldTrackDir, newPath: newTrackDir };
    } catch (error) {
      throw new UpdateError(
        `Failed to migrate track directory from ${oldTrackDir} to ${newTrackDir}`,
        error
      );
    }
  }

  /**
   * Update skills to latest version from package
   */
  async updateSkills(): Promise<void> {
    try {
      const skillsTarget = path.join(this.workingDirectory, ".claude/skills");
      const skillsSource = path.join(this.packageRoot, "skills");

      await this.fileSystem.mkdir(skillsTarget, { recursive: true });
      await this.fileSystem.copyDirectory(skillsSource, skillsTarget);
    } catch (error) {
      throw new UpdateError("Failed to update skills", error);
    }
  }

  /**
   * Update MCP server registration
   * (In case paths or environment variables changed)
   *
   * Must be called after registerProject().
   */
  async updateMCPServer(): Promise<void> {
    try {
      // Project must be registered first
      const project = this.getProject();

      const dbPath = this.resolver.getDatabasePath();
      const gitRoot = this.resolver.getGitRoot();
      const cliPath = path.join(this.packageRoot, "dist/index.js");

      // Remove existing registration (from both scopes for migration from old versions)
      try {
        execSync("claude mcp remove dev-workflow-tracker --scope project", {
          cwd: this.workingDirectory,
          stdio: "ignore",
          timeout: 30000,
        });
      } catch {
        // Ignore if doesn't exist
      }
      try {
        execSync("claude mcp remove dev-workflow-tracker --scope local", {
          cwd: this.workingDirectory,
          stdio: "ignore",
          timeout: 30000,
        });
      } catch {
        // Ignore if doesn't exist
      }

      // Build the command args for local scope only
      // Local scope stores config in ~/.claude.json, not in the project's .mcp.json
      // This allows dev-workflow to work in projects where .mcp.json is committed
      const args = [
        "mcp",
        "add",
        "--scope",
        "local",
        "--transport",
        "stdio",
        "dev-workflow-tracker",
        "--env",
        `DATABASE_PATH=${dbPath}`,
        "--env",
        `PROJECT_ID=${project.id}`,
        "--env",
        `GIT_ROOT=${gitRoot}`,
        "--",
        "node",
        cliPath,
        "mcp",
      ];

      // Re-register with local scope only (stored in ~/.claude.json)
      execSync(`claude ${args.join(" ")}`, {
        cwd: this.workingDirectory,
        stdio: "inherit",
        timeout: 30000,
      });
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      throw new UpdateError("Failed to update MCP server", error);
    }
  }

  /**
   * Run database migrations
   * (Updates schema if there are new migrations)
   */
  async runMigrations(): Promise<void> {
    try {
      const dbPath = this.resolver.getDatabasePath();

      // Verify database exists
      const exists = await this.fileSystem.exists(dbPath);
      if (!exists) {
        throw new UpdateError("Database not found. Run 'dev-workflow init' first.");
      }

      // Import and run migrations with automatic native/WASM detection
      const { DatabaseService } = await import("@dev-workflow/core");

      const dbService = await DatabaseService.create(dbPath);
      dbService.runMigrations();
      dbService.close();
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      throw new UpdateError("Failed to run database migrations", error);
    }
  }

  /**
   * Update task labels directory (local ./.track/labels/)
   * (Creates README if missing)
   */
  async updateTaskLabels(): Promise<void> {
    try {
      const labelsDir = this.resolver.getLocalLabelsPath();
      const dirExists = await this.fileSystem.exists(labelsDir);

      if (!dirExists) {
        await this.fileSystem.mkdir(labelsDir, { recursive: true });
      }

      // Create README if missing
      const readmePath = path.join(labelsDir, "README.md");
      const readmeExists = await this.fileSystem.exists(readmePath);
      if (!readmeExists) {
        const readme = `# Task Labels

Labels are markdown files that provide contextual guidance for tasks.
When a task has labels (e.g., \`["db", "api"]\`), the corresponding label
files (\`db.md\`, \`api.md\`) are loaded and provided as context.

## Creating Labels

Create any \`.md\` file in this directory. The filename (without extension)
becomes the label name.

Example: \`./.track/labels/testing.md\` creates a "testing" label.
`;
        await this.fileSystem.writeFile(readmePath, readme);
      }
    } catch (error) {
      throw new UpdateError("Failed to update task labels", error);
    }
  }

  /**
   * Update local templates directory structure (./.track/templates/)
   * Creates issue and task template directories with README if missing.
   * Templates are resolved at runtime via cascading fallback.
   */
  async updateTemplates(): Promise<void> {
    try {
      const localIssueTemplatesDir = this.resolver.getLocalIssueTemplatesPath();
      const localTaskTemplatesDir = this.resolver.getLocalTaskTemplatesPath();

      // Ensure local issue templates directory exists
      const issueDirExists = await this.fileSystem.exists(localIssueTemplatesDir);
      if (!issueDirExists) {
        await this.fileSystem.mkdir(localIssueTemplatesDir, { recursive: true });
      }

      // Ensure local task templates directory exists
      const taskDirExists = await this.fileSystem.exists(localTaskTemplatesDir);
      if (!taskDirExists) {
        await this.fileSystem.mkdir(localTaskTemplatesDir, { recursive: true });
      }

      // Create README in templates directory if missing
      const readmePath = path.join(
        this.resolver.getLocalTrackDirectory(),
        "templates",
        "README.md"
      );
      const readmeExists = await this.fileSystem.exists(readmePath);
      if (!readmeExists) {
        const readme = `# Templates

Custom templates for issues and tasks. These take precedence over global templates.

## Issue Templates (./templates/issues/)
- Per-type templates: feature.md, bug.md, enhancement.md, task.md
- Fallback: all.md (used when per-type not found)

## Task Templates (./templates/tasks/)
- Only all.md is supported for tasks

## Resolution Order
1. Local per-type (e.g., ./.track/templates/issues/feature.md)
2. Local all.md (./.track/templates/issues/all.md)
3. Global per-type (~/.track/config/templates/issues/feature.md)
4. Global all.md (~/.track/config/templates/issues/all.md)

## Frontmatter Format
\`\`\`yaml
---
type: FEATURE | BUG | ENHANCEMENT | TASK
priority: LOW | MEDIUM | HIGH | CRITICAL
---
\`\`\`
`;
        await this.fileSystem.writeFile(readmePath, readme);
      }
    } catch (error) {
      throw new UpdateError("Failed to update templates", error);
    }
  }

  /**
   * Update global default templates (~/.track/config/templates/)
   *
   * Copies bundled issue templates to the global fallback location.
   * Always overwrites to get latest versions.
   */
  async updateGlobalTemplates(): Promise<void> {
    try {
      const globalIssueTemplatesDir = this.resolver.getGlobalIssueTemplatesPath();
      const globalTaskTemplatesDir = this.resolver.getGlobalTaskTemplatesPath();

      // Create global template directories
      await this.fileSystem.mkdir(globalIssueTemplatesDir, { recursive: true });
      await this.fileSystem.mkdir(globalTaskTemplatesDir, { recursive: true });

      // Copy bundled issue templates to global directory (always overwrite)
      const bundledTemplatesSource = path.join(this.packageRoot, "templates/issues");
      const templates = ["feature.md", "bug.md", "enhancement.md", "task.md"];

      for (const template of templates) {
        const sourcePath = path.join(bundledTemplatesSource, template);
        const destPath = path.join(globalIssueTemplatesDir, template);
        await this.fileSystem.copyFile(sourcePath, destPath);
      }
    } catch (error) {
      throw new UpdateError("Failed to update global templates", error);
    }
  }

  /**
   * Restart UI daemon if running
   * (So it picks up any schema/code changes)
   */
  async restartUIDaemonIfRunning(): Promise<void> {
    const isRunning = await UIService.isDaemonRunning();
    if (isRunning) {
      console.log("🔄 Restarting UI daemon...");
      await UIService.restartDaemon();
      console.log("✓ UI daemon restarted");
    }
  }

  /**
   * Configure Claude Code permissions for worktree directories.
   *
   * Creates per-project .claude/settings.local.json with Read and Edit permissions
   * for worktree paths so Claude can access files without prompting.
   */
  async configureClaudePermissions(): Promise<{ configured: boolean; permissions: string[] }> {
    const permissions = [
      // Worktree file access
      "Read(~/.track/**/worktrees/**)",
      "Edit(~/.track/**/worktrees/**)",
      // Skills
      "Skill(dwf-*)",
      // MCP tools
      "mcp__dev-workflow-tracker__*",
    ];

    try {
      const claudeDir = path.join(this.workingDirectory, ".claude");
      const settingsPath = path.join(claudeDir, "settings.local.json");

      // Ensure .claude directory exists
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // Read existing settings or create new one
      let settings: Record<string, unknown> = {};

      if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, "utf-8");
        settings = JSON.parse(content);
      }

      // Ensure permissions.allow structure exists, preserving other properties
      const existingPermissions = (settings["permissions"] as Record<string, unknown>) ?? {};
      const existingAllow = (existingPermissions["allow"] as string[]) ?? [];

      // Merge permissions (avoid duplicates)
      settings["permissions"] = {
        ...existingPermissions,
        allow: [...new Set([...existingAllow, ...permissions])],
      };

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      return { configured: true, permissions };
    } catch {
      // Don't fail if settings can't be written
      return { configured: false, permissions };
    }
  }
}
