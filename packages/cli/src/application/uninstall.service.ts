import * as path from "node:path";
import { execSync } from "node:child_process";
import { FileSystem } from "../infrastructure/file-system.js";

export class UninstallError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "UninstallError";
  }
}

interface MCPServerConfig {
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env: Record<string, string>;
  }>;
}

export class UninstallService {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly workingDirectory: string
  ) {}

  async removeTrackDirectory(): Promise<void> {
    try {
      const trackDir = path.join(this.workingDirectory, ".track");
      const exists = await this.fileSystem.exists(trackDir);

      if (exists) {
        await this.fileSystem.rmdir(trackDir, { recursive: true });
      }
    } catch (error) {
      throw new UninstallError("Failed to remove .track directory", error);
    }
  }

  async removeSkills(): Promise<void> {
    try {
      const skillsBaseDir = path.join(this.workingDirectory, ".claude/skills");
      const exists = await this.fileSystem.exists(skillsBaseDir);

      if (exists) {
        // Remove dwf-* prefixed skill folders
        const entries = await this.fileSystem.readdirWithFileTypes(skillsBaseDir);
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith("dwf-")) {
            await this.fileSystem.rmdir(
              path.join(skillsBaseDir, entry.name),
              { recursive: true }
            );
          }
        }
      }

    } catch (error) {
      throw new UninstallError("Failed to remove skills", error);
    }
  }

  async removeSubagents(): Promise<void> {
    try {
      const agentsDir = path.join(this.workingDirectory, ".claude/agents/dev-workflow");
      const exists = await this.fileSystem.exists(agentsDir);

      if (exists) {
        await this.fileSystem.rmdir(agentsDir, { recursive: true });
      }
    } catch (error) {
      throw new UninstallError("Failed to remove subagents", error);
    }
  }

  async unregisterMCPServer(): Promise<void> {
    try {
      const mcpConfigPath = path.join(this.workingDirectory, ".claude/config/mcp-servers.json");
      const exists = await this.fileSystem.exists(mcpConfigPath);

      if (exists) {
        // Read existing config
        const content = await this.fileSystem.readFile(mcpConfigPath);
        const config: MCPServerConfig = JSON.parse(content);

        // Remove dev-workflow-tracker entry
        if (config.mcpServers && config.mcpServers["dev-workflow-tracker"]) {
          delete config.mcpServers["dev-workflow-tracker"];

          // Write back the config
          await this.fileSystem.writeFile(
            mcpConfigPath,
            JSON.stringify(config, null, 2)
          );
        }
      }

      // Also unregister from claude CLI
      await this.unregisterFromClaudeCLI();
    } catch (error) {
      throw new UninstallError("Failed to unregister MCP server", error);
    }
  }

  private async unregisterFromClaudeCLI(): Promise<void> {
    try {
      // Try to remove the MCP server registration
      execSync("claude mcp remove dev-workflow-tracker", { stdio: "ignore" });
    } catch {
      // Ignore error if claude CLI is not installed or server doesn't exist
    }
  }
}
