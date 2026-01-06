import * as path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { FileSystem } from "../infrastructure/file-system.js";
import {
  TrackDirectoryResolver,
  DatabaseService,
  SqliteProjectRepository,
  ProjectService,
  NodeGitOperations,
  type Project,
} from "@dev-workflow/core";

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
    private readonly resolver: TrackDirectoryResolver
  ) {}

  /**
   * Register the project in the database.
   *
   * Uses git's initial commit hash as stable identifier.
   * Must be called after initializeDatabase().
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
      throw new InstallError("Project not registered. Call registerProject() first.");
    }
    return this.project;
  }

  async createTrackDirectory(): Promise<void> {
    try {
      // Create local ./.track/ directory structure
      const localIssueTemplatesDir = this.resolver.getLocalIssueTemplatesPath();
      const localTaskTemplatesDir = this.resolver.getLocalTaskTemplatesPath();
      const localLabelsDir = this.resolver.getLocalLabelsPath();

      await this.fileSystem.mkdir(localIssueTemplatesDir, { recursive: true });
      await this.fileSystem.mkdir(localTaskTemplatesDir, { recursive: true });
      await this.fileSystem.mkdir(localLabelsDir, { recursive: true });

      // Create README for templates
      const templatesReadme = `# Templates

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

      await this.fileSystem.writeFile(
        path.join(this.resolver.getLocalTrackDirectory(), "templates", "README.md"),
        templatesReadme
      );

      // Create README for labels
      const labelsReadme = `# Task Labels

Labels are markdown files that provide contextual guidance for tasks.
When a task has labels (e.g., \`["db", "api"]\`), the corresponding label
files (\`db.md\`, \`api.md\`) are loaded and provided as context.

## Creating Labels

Create any \`.md\` file in this directory. The filename (without extension)
becomes the label name.

Example: \`./.track/labels/testing.md\` creates a "testing" label.
`;

      await this.fileSystem.writeFile(path.join(localLabelsDir, "README.md"), labelsReadme);
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
      // Project must be registered first
      const project = this.getProject();

      const dbPath = this.resolver.getDatabasePath();
      const gitRoot = this.resolver.getGitRoot();
      const cliPath = path.join(this.packageRoot, "dist/index.js");

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

      // Register with local scope only (stored in ~/.claude.json)
      execSync(`claude ${args.join(" ")}`, {
        cwd: this.workingDirectory,
        stdio: "inherit",
        timeout: 30000,
      });
    } catch {
      // Don't fail if claude CLI is not available
      console.warn("Warning: Could not register MCP server with claude CLI");
    }
  }

  async initializeDatabase(): Promise<void> {
    try {
      const dbPath = this.resolver.getDatabasePath();
      const globalTrackDir = this.resolver.getGlobalTrackDirectory();
      await this.fileSystem.mkdir(globalTrackDir, { recursive: true });

      // Import DatabaseService from core package
      const { DatabaseService } = await import("@dev-workflow/core");

      // Create database with automatic native/WASM detection and run migrations
      const dbService = await DatabaseService.create(dbPath);
      dbService.runMigrations();
      dbService.close();
    } catch (error) {
      throw new InstallError("Failed to initialize database", error);
    }
  }

  /**
   * Install default templates to global ~/.track/config/templates/.
   *
   * Copies bundled issue templates to the global fallback location so users
   * always have default templates available. Local templates in ./.track/templates/
   * take precedence over these global defaults.
   */
  async installGlobalTemplates(): Promise<void> {
    try {
      const globalIssueTemplatesDir = this.resolver.getGlobalIssueTemplatesPath();
      const globalTaskTemplatesDir = this.resolver.getGlobalTaskTemplatesPath();

      // Create global template directories
      await this.fileSystem.mkdir(globalIssueTemplatesDir, { recursive: true });
      await this.fileSystem.mkdir(globalTaskTemplatesDir, { recursive: true });

      // Copy bundled issue templates to global directory
      const bundledTemplatesSource = path.join(this.packageRoot, "templates/issues");
      const templates = ["feature.md", "bug.md", "enhancement.md", "task.md"];

      for (const template of templates) {
        const sourcePath = path.join(bundledTemplatesSource, template);
        const destPath = path.join(globalIssueTemplatesDir, template);
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
   * @returns The existing project if found, null otherwise
   */
  async findExistingProject(): Promise<Project | null> {
    const dbPath = this.resolver.getDatabasePath();

    // Database might not exist yet
    const dbExists = await this.fileSystem.exists(dbPath);
    if (!dbExists) {
      return null;
    }

    const dbService = await DatabaseService.create(dbPath);

    try {
      const projectRepo = new SqliteProjectRepository(dbService.getDb());
      const gitOps = new NodeGitOperations();

      // Get gitRootHash for current directory
      const gitRootHash = await gitOps.getInitialCommitHash(this.workingDirectory);

      // Look up by gitRootHash
      return projectRepo.findByGitRootHash(gitRootHash);
    } finally {
      dbService.close();
    }
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
}
