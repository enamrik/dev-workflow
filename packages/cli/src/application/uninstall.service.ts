import * as path from "node:path";
import { execSync } from "node:child_process";
import { FileSystem } from "../infrastructure/file-system.js";
import { TrackDirectoryResolver } from "@dev-workflow/core";

export class UninstallError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "UninstallError";
  }
}

export class UninstallService {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly workingDirectory: string,
    private readonly resolver: TrackDirectoryResolver
  ) {}

  async removeTrackDirectory(): Promise<void> {
    try {
      const trackDir = this.resolver.getTrackDirectory();
      const exists = await this.fileSystem.exists(trackDir);

      if (exists) {
        await this.fileSystem.rmdir(trackDir, { recursive: true });
      }
    } catch (error) {
      throw new UninstallError("Failed to remove track directory", error);
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
            await this.fileSystem.rmdir(path.join(skillsBaseDir, entry.name), { recursive: true });
          }
        }
      }
    } catch (error) {
      throw new UninstallError("Failed to remove skills", error);
    }
  }

  async unregisterMCPServer(): Promise<void> {
    try {
      // Remove from project scope
      try {
        execSync("claude mcp remove dev-workflow-tracker --scope project", {
          cwd: this.workingDirectory,
          stdio: "ignore",
          timeout: 30000,
        });
      } catch {
        // Ignore if doesn't exist
      }

      // Remove from local scope
      try {
        execSync("claude mcp remove dev-workflow-tracker --scope local", {
          cwd: this.workingDirectory,
          stdio: "ignore",
          timeout: 30000,
        });
      } catch {
        // Ignore if doesn't exist
      }
    } catch (error) {
      throw new UninstallError("Failed to unregister MCP server", error);
    }
  }
}
