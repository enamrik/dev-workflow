import * as path from "node:path";
import { execSync } from "node:child_process";
import { FileSystem } from "../infrastructure/file-system.js";

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
 * - Update subagents to latest version
 * - Update MCP server registration
 * - Run database migrations
 */
export class UpdateService {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly workingDirectory: string,
    private readonly packageRoot: string
  ) {}

  /**
   * Check if dev-workflow is initialized in the current directory
   */
  async isInitialized(): Promise<boolean> {
    const trackDir = path.join(this.workingDirectory, ".track");
    return await this.fileSystem.exists(trackDir);
  }

  /**
   * Update skills to latest version from package
   */
  async updateSkills(): Promise<void> {
    try {
      const skillsDir = path.join(this.workingDirectory, ".claude/skills/dev-workflow");
      const skillsSource = path.join(this.packageRoot, "skills");

      // Remove old skills
      // Note: We don't have a recursive remove in FileSystem interface
      // For now, we'll copy over which will overwrite
      await this.fileSystem.copyDirectory(skillsSource, skillsDir);
    } catch (error) {
      throw new UpdateError("Failed to update skills", error);
    }
  }

  /**
   * Update subagents to latest version from package
   */
  async updateSubagents(): Promise<void> {
    try {
      const agentsDir = path.join(this.workingDirectory, ".claude/agents/dev-workflow");
      const agentsSource = path.join(this.packageRoot, "agents");

      await this.fileSystem.copyDirectory(agentsSource, agentsDir);
    } catch (error) {
      throw new UpdateError("Failed to update subagents", error);
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
          DATABASE_PATH: path.join(this.workingDirectory, ".track/data/workflow.db"),
          TEMPLATES_PATH: path.join(this.workingDirectory, ".track/config/issues/templates/"),
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
      const dbPath = path.join(this.workingDirectory, ".track/data/workflow.db");
      const templatesPath = path.join(this.workingDirectory, ".track/config/issues/templates/");
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
      const dbPath = path.join(this.workingDirectory, ".track/data/workflow.db");

      // Verify database exists
      const exists = await this.fileSystem.exists(dbPath);
      if (!exists) {
        throw new UpdateError("Database not found. Run 'dev-workflow init' first.");
      }

      // Import and run migrations with automatic native/WASM detection
      const { DatabaseService } = await import("@dev-workflow/mcp-server/infrastructure/database.js");

      const dbService = await DatabaseService.create(dbPath);
      dbService.runMigrations();
      dbService.close();
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      throw new UpdateError("Failed to run database migrations", error);
    }
  }

  /**
   * Update templates
   * (Updates default templates, preserves user templates, ensures user templates directory exists)
   */
  async updateTemplates(): Promise<void> {
    try {
      const defaultTemplatesDir = path.join(this.workingDirectory, ".track/config/issues/templates");
      const userTemplatesDir = path.join(this.workingDirectory, ".track/issues/templates");
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
}
