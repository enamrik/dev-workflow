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
   * (Copies latest default templates, preserving user customizations)
   */
  async updateTemplates(): Promise<void> {
    try {
      const templatesDir = path.join(this.workingDirectory, ".track/config/issues/templates");
      const templatesSource = path.join(this.packageRoot, "templates/issues");
      const templates = ["feature.md", "bug.md", "enhancement.md", "task.md"];

      for (const template of templates) {
        const sourcePath = path.join(templatesSource, template);
        const destPath = path.join(templatesDir, template);

        // Only update if template doesn't exist (preserve user customizations)
        const exists = await this.fileSystem.exists(destPath);
        if (!exists) {
          await this.fileSystem.copyFile(sourcePath, destPath);
        }
      }
    } catch (error) {
      throw new UpdateError("Failed to update templates", error);
    }
  }
}
