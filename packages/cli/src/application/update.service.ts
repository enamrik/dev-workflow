import * as path from "node:path";
import { execSync } from "node:child_process";
import { FileSystem } from "../infrastructure/file-system.js";
import { TrackDirectoryResolver } from "@dev-workflow/core";
import { UIService } from "./ui.service.js";

export class UpdateError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
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
 */
export class UpdateService {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly workingDirectory: string,
    private readonly packageRoot: string,
    private readonly resolver: TrackDirectoryResolver
  ) {}

  /**
   * Check if dev-workflow is initialized for this project
   */
  async isInitialized(): Promise<boolean> {
    const trackDir = this.resolver.getTrackDirectory();
    return await this.fileSystem.exists(trackDir);
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
   */
  async updateMCPServer(): Promise<void> {
    try {
      const mcpConfigDir = path.join(this.workingDirectory, ".claude/config");
      const mcpConfigPath = path.join(mcpConfigDir, "mcp-servers.json");

      const exists = await this.fileSystem.exists(mcpConfigPath);
      if (!exists) {
        throw new UpdateError("MCP config not found. Run 'dev-workflow init' first.");
      }

      const content = await this.fileSystem.readFile(mcpConfigPath);
      const config = JSON.parse(content);

      // Update dev-workflow MCP server registration
      config.mcpServers["dev-workflow-tracker"] = {
        command: "npx",
        args: ["dev-workflow", "mcp"],
        env: {
          DATABASE_PATH: this.resolver.getDatabasePath(),
          PROJECT_ID: this.resolver.getProjectId(),
          TEMPLATES_PATH: this.resolver.getTemplatesPath(),
        },
      };

      await this.fileSystem.writeFile(mcpConfigPath, JSON.stringify(config, null, 2));

      // Also update claude CLI registration
      await this.updateClaudeCLI();
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      throw new UpdateError("Failed to update MCP server", error);
    }
  }

  /**
   * Update claude CLI MCP registration
   */
  private async updateClaudeCLI(): Promise<void> {
    try {
      const dbPath = this.resolver.getDatabasePath();
      const projectId = this.resolver.getProjectId();
      const templatesPath = this.resolver.getTemplatesPath();
      const cliPath = path.join(this.packageRoot, "dist/index.js");

      // Remove existing registration
      try {
        execSync("claude mcp remove dev-workflow-tracker", { stdio: "ignore" });
      } catch {
        // Ignore if doesn't exist
      }

      // Re-register
      const command = [
        "claude",
        "mcp",
        "add",
        "--transport",
        "stdio",
        "dev-workflow-tracker",
        "--env",
        `DATABASE_PATH=${dbPath}`,
        "--env",
        `PROJECT_ID=${projectId}`,
        "--env",
        `TEMPLATES_PATH=${templatesPath}`,
        "--",
        "node",
        cliPath,
        "mcp",
      ].join(" ");

      execSync(command, { stdio: "inherit" });
    } catch (error) {
      // Don't fail update if claude CLI is not installed
      console.warn("Warning: Could not update claude CLI registration (this is optional)");
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
   * Update task labels directory
   * (Creates README if missing)
   */
  async updateTaskLabels(): Promise<void> {
    try {
      const labelsDir = this.resolver.getLabelsPath();
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
        await this.fileSystem.writeFile(readmePath, readme);
      }
    } catch (error) {
      throw new UpdateError("Failed to update task labels", error);
    }
  }

  /**
   * Update templates
   * (Updates default templates, preserves user templates, ensures user templates directory exists)
   */
  async updateTemplates(): Promise<void> {
    try {
      const defaultTemplatesDir = this.resolver.getTemplatesPath();
      const userTemplatesDir = this.resolver.getUserTemplatesPath();
      const templatesSource = path.join(this.packageRoot, "templates/issues");
      const templates = ["feature.md", "bug.md", "enhancement.md", "task.md"];

      // Ensure user templates directory exists (for existing installations)
      const userDirExists = await this.fileSystem.exists(userTemplatesDir);
      if (!userDirExists) {
        await this.fileSystem.mkdir(userTemplatesDir, { recursive: true });

        // Create README in user templates directory
        const userTemplatesReadme = `# User Templates

This directory is for your custom issue templates.

## How it works
- Templates here override default templates in \`.track/config/issues/templates/\`
- If a template with the same filename exists here, it takes precedence
- Templates must be markdown files with YAML frontmatter

## Example
Copy a default template and customize it:
\`\`\`bash
cp .track/config/issues/templates/feature.md .track/issues/templates/my-feature.md
\`\`\`

Then edit \`my-feature.md\` to match your needs.

## Frontmatter Format
\`\`\`yaml
---
type: FEATURE | BUG | ENHANCEMENT | TASK
priority: LOW | MEDIUM | HIGH | CRITICAL
labels: [label1, label2]
---
\`\`\`

## Template Metadata
When a template is selected, its frontmatter values will be used as defaults for creating issues:
- \`type\`: Issue type (FEATURE, BUG, ENHANCEMENT, or TASK)
- \`priority\`: Issue priority (LOW, MEDIUM, HIGH, or CRITICAL)
- \`labels\`: Array of labels to apply to the issue

These values can still be overridden when creating an issue explicitly.
`;

        await this.fileSystem.writeFile(
          path.join(userTemplatesDir, "README.md"),
          userTemplatesReadme
        );

        console.log("✓ Created user templates directory");
      }

      // Update default templates (always overwrite to get latest versions)
      for (const template of templates) {
        const sourcePath = path.join(templatesSource, template);
        const destPath = path.join(defaultTemplatesDir, template);
        await this.fileSystem.copyFile(sourcePath, destPath);
      }

      console.log("✓ Default templates updated");
      console.log("  User templates in .track/issues/templates/ are preserved");
    } catch (error) {
      throw new UpdateError("Failed to update templates", error);
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
}
