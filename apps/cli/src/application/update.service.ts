import { Effect } from "@dev-workflow/effect";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import Database from "better-sqlite3";
import { FileSystem } from "../infrastructure/file-system.js";
import {
  DbSourceProvider,
  ProjectService,
  runSqliteMigrations,
  type Project,
} from "@dev-workflow/tracking";
import {
  TrackDirectoryResolver,
  resolveGlobalTrackDir,
} from "@dev-workflow/git/track-directory-resolver.js";
import { GitOperations } from "@dev-workflow/git/operations/git-operations.js";

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
    private readonly resolver: TrackDirectoryResolver,
    private readonly databaseConnectionString: string
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
    const sourceProvider = new DbSourceProvider();
    const source = sourceProvider.getOrCreate({ connectionString: this.databaseConnectionString });

    try {
      const gitOps = new GitOperations();
      const projectService = new ProjectService(source, gitOps);

      this.project = await Effect.runPromise(
        projectService.getOrCreateProject(this.workingDirectory)
      );
      return this.project;
    } finally {
      source.close();
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

    // Use better-sqlite3 directly for this one-time migration
    // since we need raw SQL access across project scopes
    const db = new Database(dbPath);

    try {
      // Update issues with old projectId to use new project.id
      const issueStmt = db.prepare("UPDATE issues SET project_id = ? WHERE project_id = ?");
      const result = issueStmt.run(project.id, oldProjectId);

      // Also update snapshots
      const snapshotStmt = db.prepare("UPDATE snapshots SET project_id = ? WHERE project_id = ?");
      snapshotStmt.run(project.id, oldProjectId);

      // Also update milestones
      const milestoneStmt = db.prepare("UPDATE milestones SET project_id = ? WHERE project_id = ?");
      milestoneStmt.run(project.id, oldProjectId);

      return { migrated: result.changes ?? 0, oldProjectId };
    } finally {
      db.close();
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

      const cliPath = path.join(this.packageRoot, "dist/main.js");

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
      // MCP server loads config from ~/.track/<slug>/config.json at startup
      // All options must come BEFORE the server name
      // Use --env=KEY=value format (equals sign) to avoid variadic arg parsing issues
      const args = [
        "mcp",
        "add",
        "--scope",
        "local",
        "--transport",
        "stdio",
        `--env=PROJECT_SLUG=${project.slug}`,
      ];

      // Pass TRACK_DIR for E2E test isolation - allows MCP server to use
      // a temporary database instead of the global one
      const trackDir = process.env["TRACK_DIR"];
      if (trackDir) {
        args.push(`--env=TRACK_DIR=${trackDir}`);
      }

      args.push("dev-workflow-tracker", "--", "node", cliPath, "mcp");

      // Re-register with local scope only (stored in ~/.claude.json)
      // Use spawnSync with array args to preserve argument boundaries
      // (execSync with joined string causes --env to be parsed incorrectly)
      spawnSync("claude", args, {
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

      // Run migrations
      runSqliteMigrations(dbPath);
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      throw new UpdateError("Failed to run database migrations", error);
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
- Per-type templates: feature.md, bug.md, enhancement.md, task.md
- Fallback: all.md (used when per-type not found)
- Used to generate GitHub issue bodies when tasks are synced

## Resolution Order (same for both issues and tasks)
1. Local per-type (e.g., ./.track/templates/tasks/feature.md)
2. Local all.md (./.track/templates/tasks/all.md)
3. Global per-type (~/.track/config/templates/tasks/feature.md)
4. Global all.md (~/.track/config/templates/tasks/all.md)

## Template Placeholders (tasks only)
- {{description}} - Task description
- {{acceptanceCriteria}} - Formatted acceptance criteria list
- {{parentIssueLink}} - Link to parent dev-workflow issue

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
      const bundledIssueTemplatesSource = path.join(this.packageRoot, "templates/issues");
      const issueTemplates = ["feature.md", "bug.md", "enhancement.md", "task.md"];

      for (const template of issueTemplates) {
        const sourcePath = path.join(bundledIssueTemplatesSource, template);
        const destPath = path.join(globalIssueTemplatesDir, template);
        await this.fileSystem.copyFile(sourcePath, destPath);
      }

      // Copy bundled task templates to global directory (always overwrite)
      const bundledTaskTemplatesSource = path.join(this.packageRoot, "templates/tasks");
      const taskTemplates = ["feature.md", "bug.md", "enhancement.md", "task.md"];

      for (const template of taskTemplates) {
        const sourcePath = path.join(bundledTaskTemplatesSource, template);
        const destPath = path.join(globalTaskTemplatesDir, template);
        await this.fileSystem.copyFile(sourcePath, destPath);
      }
    } catch (error) {
      throw new UpdateError("Failed to update global templates", error);
    }
  }

  /**
   * Notify the user to restart the UI server if one is running.
   *
   * The UI now runs as an in-process foreground server (no PM2 daemon), so it
   * cannot be restarted automatically. If a server is listening on the saved
   * port, advise the user to restart it to pick up schema/code changes.
   */
  async restartUIDaemonIfRunning(): Promise<void> {
    const { getSavedDaemonPort, isPortInUse } = await import(
      "../infrastructure/port-manager.js"
    );
    const savedPort = getSavedDaemonPort();
    if (savedPort && (await isPortInUse(savedPort))) {
      console.log("ℹ️  A dev-workflow UI server is running. Restart it (Ctrl+C, then 'dev-workflow ui') to pick up changes.");
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
