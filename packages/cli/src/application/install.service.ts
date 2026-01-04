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
      const defaultTemplatesDir = this.resolver.getTemplatesPath();
      const userTemplatesDir = this.resolver.getUserTemplatesPath();

      // Create directory structure
      await this.fileSystem.mkdir(defaultTemplatesDir, { recursive: true });
      await this.fileSystem.mkdir(userTemplatesDir, { recursive: true });

      // Copy default templates to config directory
      const templatesSource = path.join(this.packageRoot, "templates/issues");
      const templates = ["feature.md", "bug.md", "enhancement.md", "task.md"];

      for (const template of templates) {
        await this.fileSystem.copyFile(
          path.join(templatesSource, template),
          path.join(defaultTemplatesDir, template)
        );
      }

      // Create README in user templates directory
      const userTemplatesReadme = `# User Templates

This directory is for your custom issue templates.

## How it works
- Templates here override default templates in the config/issues/templates/ directory
- If a template with the same filename exists here, it takes precedence
- Templates must be markdown files with YAML frontmatter

## Frontmatter Format
\`\`\`yaml
---
type: FEATURE | BUG | ENHANCEMENT | TASK
priority: LOW | MEDIUM | HIGH | CRITICAL
---
\`\`\`

## Template Metadata
When a template is selected, its frontmatter values will be used as defaults for creating issues:
- \`type\`: Issue type (FEATURE, BUG, ENHANCEMENT, or TASK)
- \`priority\`: Issue priority (LOW, MEDIUM, HIGH, or CRITICAL)

These values can still be overridden when creating an issue explicitly.
`;

      await this.fileSystem.writeFile(
        path.join(userTemplatesDir, "README.md"),
        userTemplatesReadme
      );
    } catch (error) {
      throw new InstallError("Failed to create track directory", error);
    }
  }

  /**
   * Create local config file with machine-specific settings.
   *
   * This file stores data that varies per machine (like gitRoot) and is NOT
   * synced when using a shared remote database. Each developer has their own.
   *
   * Must be called after registerProject() since it needs the project UUID.
   */
  async createLocalConfig(): Promise<void> {
    try {
      const project = this.getProject();

      // Local-only config - not synced to remote database
      const config = {
        projectId: project.id,
        gitRoot: this.resolver.getGitRoot(),
      };

      await this.fileSystem.writeFile(
        this.resolver.getConfigPath(),
        JSON.stringify(config, null, 2)
      );
    } catch (error) {
      throw new InstallError("Failed to create local config", error);
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
      const templatesPath = this.resolver.getTemplatesPath();
      const gitRoot = this.resolver.getGitRoot();
      const cliPath = path.join(this.packageRoot, "dist/index.js");

      // Remove existing registration if it exists (from both scopes)
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

      // Build the command args (--scope goes after 'mcp add')
      const buildArgs = (scope: string) => [
        "mcp",
        "add",
        "--scope",
        scope,
        "--transport",
        "stdio",
        "dev-workflow-tracker",
        "--env",
        `DATABASE_PATH=${dbPath}`,
        "--env",
        `PROJECT_ID=${project.id}`,
        "--env",
        `TEMPLATES_PATH=${templatesPath}`,
        "--env",
        `GIT_ROOT=${gitRoot}`,
        "--",
        "node",
        cliPath,
        "mcp",
      ];

      // Register with project scope (writes to .claude/config/mcp-servers.json)
      execSync(`claude ${buildArgs("project").join(" ")}`, {
        cwd: this.workingDirectory,
        stdio: "inherit",
        timeout: 30000,
      });

      // Also register with local scope for claude --print to work
      execSync(`claude ${buildArgs("local").join(" ")}`, {
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
   * Create default task labels in ~/.track/<project-id>/labels/
   *
   * Labels are markdown files that provide contextual guidance for tasks.
   * When a task has labels, the corresponding label files are loaded
   * and provided to Claude as context when executing the task.
   */
  async createTaskLabels(): Promise<void> {
    try {
      const labelsDir = this.resolver.getLabelsPath();
      await this.fileSystem.mkdir(labelsDir, { recursive: true });

      // Create README
      const readme = `# Task Labels

Labels are markdown files that provide contextual guidance for tasks.
When a task has labels (e.g., \`["db", "api"]\`), the corresponding label
files (\`db.md\`, \`api.md\`) are loaded and provided as context.

## How it works

1. Create a label file: \`.track/labels/my-label.md\`
2. When generating a plan, tasks are automatically labeled based on matching label names
3. When starting a task, labels are loaded and provided as guidance

## Creating custom labels

Create any \`.md\` file in this directory. The filename (without extension)
becomes the label name.

Example: \`.track/labels/testing.md\` creates a "testing" label that can be
assigned to tasks via the \`labels\` field.
`;

      await this.fileSystem.writeFile(path.join(labelsDir, "README.md"), readme);
    } catch (error) {
      throw new InstallError("Failed to create task labels", error);
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
   * Check if the local config needs repair (missing or has wrong gitRoot).
   *
   * @returns true if config is missing or stale
   */
  async needsConfigRepair(): Promise<boolean> {
    const configPath = this.resolver.getConfigPath();
    const configExists = await this.fileSystem.exists(configPath);

    if (!configExists) {
      return true;
    }

    try {
      const content = await this.fileSystem.readFile(configPath);
      const config = JSON.parse(content);
      const currentGitRoot = this.resolver.getGitRoot();

      // Config is stale if gitRoot doesn't match current location
      return config.gitRoot !== currentGitRoot;
    } catch {
      // Invalid JSON or other error - needs repair
      return true;
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
