import { Effect } from "@dev-workflow/effect";
import * as path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { FileSystem } from "../infrastructure/file-system.js";
import {
  DbSourceProvider,
  ProjectService,
  runSqliteMigrations,
  DEFAULT_TYPE_DEFINITIONS,
  type Project,
} from "@dev-workflow/tracking";
import { TrackDirectoryResolver } from "@dev-workflow/git/track-directory-resolver.js";
import { GitOperations } from "@dev-workflow/git/operations/git-operations.js";

export class InstallError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "InstallError";
  }
}

export class InstallService {
  private project: Project | null = null;

  constructor(
    private readonly fileSystem: FileSystem,
    private readonly workingDirectory: string,
    private readonly packageRoot: string,
    private readonly resolver: TrackDirectoryResolver,
    private readonly sourceProvider: DbSourceProvider,
    private readonly gitOps: GitOperations
  ) {}

  /**
   * Validate connection string format.
   * Expected: sqlite:///path
   */
  private validateConnectionString(connectionString: string): void {
    if (connectionString.startsWith("sqlite:")) {
      return;
    }
    throw new InstallError(
      `Invalid connection string format: ${connectionString}. Expected sqlite:///path`
    );
  }

  /**
   * Extract the file path from a sqlite connection string for file operations.
   */
  private getDbFilePath(connectionString: string): string {
    if (connectionString.startsWith("sqlite:///")) {
      return connectionString.slice(9); // "sqlite://" is 9 chars, path starts with /
    }
    if (connectionString.startsWith("sqlite::memory:")) {
      return ":memory:";
    }
    throw new InstallError(`Cannot extract path from connection string: ${connectionString}`);
  }


  /**
   * Register the project in the database.
   *
   * Uses git's initial commit hash as stable identifier.
   * Must be called after initializeDatabase().
   *
   * @param connectionString - Database connection string
   * @returns The registered project
   */
  async registerProject(connectionString: string): Promise<Project> {
    this.validateConnectionString(connectionString);

    const source = this.sourceProvider.getOrCreate({ connectionString });
    const projectService = new ProjectService(source, this.gitOps);

    this.project = await Effect.runPromise(
      projectService.getOrCreateProject(this.workingDirectory)
    );
    return this.project;
  }

  /**
   * Get the registered project.
   * @throws Error if registerProject() hasn't been called
   */
  getProject(): Project {
    if (!this.project) {
      throw new InstallError("Project not registered. Call registerProject() first.");
    }
    return this.project;
  }

  async createTrackDirectory(): Promise<void> {
    try {
      // Create local ./.track/ directory structure
      const localIssueTemplatesDir = this.resolver.getLocalIssueTemplatesPath();
      const localTaskTemplatesDir = this.resolver.getLocalTaskTemplatesPath();

      await this.fileSystem.mkdir(localIssueTemplatesDir, { recursive: true });
      await this.fileSystem.mkdir(localTaskTemplatesDir, { recursive: true });

      // Create README for templates
      const templatesReadme = `# Templates

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
3. Global per-type (~/.track/templates/tasks/feature.md)
4. Global all.md (~/.track/templates/tasks/all.md)

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

      await this.fileSystem.writeFile(
        path.join(this.resolver.getLocalTrackDirectory(), "templates", "README.md"),
        templatesReadme
      );
    } catch (error) {
      throw new InstallError("Failed to create track directory", error);
    }
  }

  async installSkills(): Promise<void> {
    try {
      const skillsTarget = path.join(this.workingDirectory, ".claude/skills");
      await this.fileSystem.mkdir(skillsTarget, { recursive: true });

      // Copy skill folders directly (flat, no subfolder)
      // Skills are prefixed with dwf- to avoid conflicts with other packages
      const skillsSource = path.join(this.packageRoot, "skills");
      await this.fileSystem.copyDirectory(skillsSource, skillsTarget);
    } catch (error) {
      throw new InstallError("Failed to install skills", error);
    }
  }

  async registerMCPServer(): Promise<void> {
    try {
      // Project must be registered first (to validate it exists)
      this.getProject();

      const slug = this.resolver.getProjectId();
      const cliPath = path.join(this.packageRoot, "dist/main.js");

      // Remove existing registration if it exists (from both scopes for migration)
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
      // All options must come BEFORE the server name
      // Use --env=KEY=value format (equals sign) to avoid variadic arg parsing issues
      const gitRoot = this.resolver.getGitRoot();
      const args = [
        "mcp",
        "add",
        "--scope",
        "local",
        "--transport",
        "stdio",
        `--env=PROJECT_SLUG=${slug}`,
        `--env=GIT_ROOT=${gitRoot}`,
      ];

      // Pass TRACK_DIR for E2E test isolation - allows MCP server to use
      // a temporary database instead of the global one
      const trackDir = process.env["TRACK_DIR"];
      if (trackDir) {
        args.push(`--env=TRACK_DIR=${trackDir}`);
      }

      args.push("dev-workflow-tracker", "--", "node", cliPath, "mcp");

      // Register with local scope only (stored in ~/.claude.json)
      // Use spawnSync with array args to preserve argument boundaries
      // (execSync with joined string causes --env to be parsed incorrectly)
      spawnSync("claude", args, {
        cwd: this.workingDirectory,
        stdio: "inherit",
        timeout: 30000,
      });
    } catch {
      // Don't fail if claude CLI is not available
      console.warn("Warning: Could not register MCP server with claude CLI");
    }
  }

  /**
   * Initialize the database (run migrations).
   *
   * @param connectionString - Database connection string
   */
  async initializeDatabase(connectionString: string): Promise<void> {
    this.validateConnectionString(connectionString);

    try {
      const dbPath = this.getDbFilePath(connectionString);

      // Ensure parent directory exists for SQLite
      const dbDir = path.dirname(dbPath);
      await this.fileSystem.mkdir(dbDir, { recursive: true });

      // Create database and run migrations
      runSqliteMigrations(dbPath);
    } catch (error) {
      if (error instanceof InstallError) throw error;
      throw new InstallError("Failed to initialize database", error);
    }
  }

  /**
   * Migrate templates from old path (~/.track/config/templates/) to new path (~/.track/templates/).
   *
   * Only migrates if old path exists and new path doesn't. This is a one-time migration.
   *
   * @returns Object indicating if migration occurred
   */
  async migrateTemplatesFromOldPath(): Promise<{ migrated: boolean; message: string }> {
    try {
      const oldConfigDir = this.resolver.getOldGlobalConfigDirectory();
      const oldTemplatesDir = path.join(oldConfigDir, "templates");
      const newTemplatesDir = path.join(this.resolver.getGlobalTrackDirectory(), "templates");

      // Check if old path exists
      const oldExists = await this.fileSystem.exists(oldTemplatesDir);
      if (!oldExists) {
        return { migrated: false, message: "No old templates to migrate" };
      }

      // Check if new path already exists (migration already done)
      const newExists = await this.fileSystem.exists(newTemplatesDir);
      if (newExists) {
        return {
          migrated: false,
          message: "New templates path already exists, skipping migration",
        };
      }

      // Migrate by copying the directory
      await this.fileSystem.copyDirectory(oldTemplatesDir, newTemplatesDir);

      // Optionally remove old directory (keep it for safety, user can delete manually)
      // await this.fileSystem.rmdir(oldTemplatesDir, { recursive: true });

      return {
        migrated: true,
        message: `Migrated templates from ${oldTemplatesDir} to ${newTemplatesDir}`,
      };
    } catch (error) {
      // Don't fail the install if migration fails, just warn
      const message = error instanceof Error ? error.message : String(error);
      return { migrated: false, message: `Migration failed: ${message}` };
    }
  }

  /**
   * Install default templates to global ~/.track/templates/.
   *
   * Copies bundled issue templates to the global fallback location so users
   * always have default templates available. Local templates in ./.track/templates/
   * take precedence over these global defaults.
   *
   * Also migrates templates from old path (~/.track/config/templates/) if needed.
   */
  async installGlobalTemplates(): Promise<void> {
    try {
      // First, try to migrate from old path
      const migration = await this.migrateTemplatesFromOldPath();
      if (migration.migrated) {
        console.log(`  ${migration.message}`);
      }

      const globalIssueTemplatesDir = this.resolver.getGlobalIssueTemplatesPath();
      const globalTaskTemplatesDir = this.resolver.getGlobalTaskTemplatesPath();

      // Create global template directories
      await this.fileSystem.mkdir(globalIssueTemplatesDir, { recursive: true });
      await this.fileSystem.mkdir(globalTaskTemplatesDir, { recursive: true });

      // Copy bundled issue templates to global directory
      const bundledIssueTemplatesSource = path.join(this.packageRoot, "templates/issues");
      const issueTemplates = ["feature.md", "bug.md", "enhancement.md", "task.md"];

      for (const template of issueTemplates) {
        const sourcePath = path.join(bundledIssueTemplatesSource, template);
        const destPath = path.join(globalIssueTemplatesDir, template);
        await this.fileSystem.copyFile(sourcePath, destPath);
      }

      // Copy bundled task templates to global directory
      const bundledTaskTemplatesSource = path.join(this.packageRoot, "templates/tasks");
      const taskTemplates = ["feature.md", "bug.md", "enhancement.md", "task.md"];

      for (const template of taskTemplates) {
        const sourcePath = path.join(bundledTaskTemplatesSource, template);
        const destPath = path.join(globalTaskTemplatesDir, template);
        await this.fileSystem.copyFile(sourcePath, destPath);
      }
    } catch (error) {
      throw new InstallError("Failed to install global templates", error);
    }
  }

  /**
   * Configure Claude Code permissions for worktree directories.
   *
   * Creates per-project .claude/settings.json with Read and Edit permissions
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
      const dirExists = await this.fileSystem.exists(claudeDir);
      if (!dirExists) {
        await this.fileSystem.mkdir(claudeDir, { recursive: true });
      }

      // Read existing settings or create new one
      // Use Record to preserve all existing properties when we write back
      let settings: Record<string, unknown> = {};
      const fileExists = await this.fileSystem.exists(settingsPath);

      if (fileExists) {
        const content = await this.fileSystem.readFile(settingsPath);
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

      await this.fileSystem.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return { configured: true, permissions };
    } catch {
      // Don't fail if settings can't be written
      return { configured: false, permissions };
    }
  }

  /**
   * Check if this repository has an existing project in the database.
   *
   * Used to detect if this is a repair scenario (repo moved, config stale).
   *
   * @param connectionString - Database connection string
   * @returns The existing project if found, null otherwise
   */
  async findExistingProject(connectionString: string): Promise<Project | null> {
    this.validateConnectionString(connectionString);

    const dbPath = this.getDbFilePath(connectionString);

    // Check if database file exists
    const dbExists = await this.fileSystem.exists(dbPath);
    if (!dbExists) {
      return null;
    }

    // Run migrations first to ensure schema is up to date
    // This is critical for handling cases where the database exists but is out of date
    runSqliteMigrations(dbPath);

    const source = this.sourceProvider.getOrCreate({ connectionString });

    // Get gitRootHash for current directory
    const gitRootHash = this.gitOps.getInitialCommitHash(this.workingDirectory);

    // Look up by gitRootHash
    return await Effect.runPromise(source.projects.findByGitRootHash(gitRootHash));
  }

  /**
   * Repair git worktrees after repository has been moved.
   *
   * Git worktrees store absolute paths internally. When the main repo
   * moves, those paths become invalid. `git worktree repair` fixes this.
   *
   * @returns Object with repair status and any output
   */
  async repairWorktrees(): Promise<{ repaired: boolean; output: string }> {
    try {
      // Check git version (worktree repair requires Git 2.30+)
      const versionResult = spawnSync("git", ["--version"], {
        cwd: this.workingDirectory,
        encoding: "utf-8",
      });

      if (versionResult.status !== 0) {
        return { repaired: false, output: "Git not available" };
      }

      // Parse version (format: "git version 2.39.0")
      const versionMatch = versionResult.stdout.match(/git version (\d+)\.(\d+)/);
      if (versionMatch) {
        const major = parseInt(versionMatch[1]!, 10);
        const minor = parseInt(versionMatch[2]!, 10);

        if (major < 2 || (major === 2 && minor < 30)) {
          return {
            repaired: false,
            output: `Git ${major}.${minor} detected. Worktree repair requires Git 2.30+`,
          };
        }
      }

      // Run git worktree repair
      const result = spawnSync("git", ["worktree", "repair"], {
        cwd: this.workingDirectory,
        encoding: "utf-8",
      });

      if (result.status === 0) {
        const output = result.stdout.trim() || "Worktrees repaired successfully";
        return { repaired: true, output };
      } else {
        return {
          repaired: false,
          output: result.stderr.trim() || "Worktree repair failed",
        };
      }
    } catch (error) {
      return {
        repaired: false,
        output: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Set the project (used when repairing an existing project).
   *
   * @param project - The existing project from database
   */
  setProject(project: Project): void {
    this.project = project;
  }

  /**
   * Seed default types to the global database.
   *
   * Seeds the default type definitions (FEATURE, BUG, ENHANCEMENT, TASK, SPIKE)
   * if they don't already exist. This ensures users always have the standard types
   * available. Custom types can be added via the create_type MCP tool.
   *
   * Should be called after initializeDatabase().
   *
   * @param connectionString - Database connection string
   */
  async seedDefaultTypes(connectionString: string): Promise<{ seeded: number; existing: number }> {
    this.validateConnectionString(connectionString);

    try {
      const source = this.sourceProvider.getOrCreate({ connectionString });

      // Convert DEFAULT_TYPE_DEFINITIONS to CreateTypeData format
      const typesToSeed = DEFAULT_TYPE_DEFINITIONS.map((typeDef) => ({
        name: typeDef.name,
        displayName: typeDef.name.charAt(0) + typeDef.name.slice(1).toLowerCase(),
        description: typeDef.description,
        keywords: typeDef.keywords,
      }));

      // Check how many already exist
      const existingTypes = source.types.findAll(true);
      const existingNames = new Set(existingTypes.map((t) => t.name));

      const toSeed = typesToSeed.filter((t) => !existingNames.has(t.name));

      // Seed the types
      source.types.seedTypes(toSeed);

      return {
        seeded: toSeed.length,
        existing: existingTypes.length,
      };
    } catch (error) {
      throw new InstallError("Failed to seed default types", error);
    }
  }
}
