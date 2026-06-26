import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { FileSystem } from "../infrastructure/file-system.js";
import {
  TrackDirectoryResolver,
  resolveGlobalTrackDir,
} from "@dev-workflow/git/track-directory-resolver.js";
import { globalSkillsDir } from "../infrastructure/skills-installer.js";

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
        // Remove dfl-* prefixed skill folders
        const entries = await this.fileSystem.readdirWithFileTypes(skillsBaseDir);
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith("dfl-")) {
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
      for (const scope of ["user", "local", "project"]) {
        try {
          execSync(`claude mcp remove dev-workflow-tracker --scope ${scope}`, {
            cwd: this.workingDirectory,
            stdio: "ignore",
            timeout: 30000,
          });
        } catch {
          // Ignore if doesn't exist in this scope
        }
      }
    } catch (error) {
      throw new UninstallError("Failed to unregister MCP server", error);
    }
  }

  async removeGlobalSkills(): Promise<void> {
    try {
      const skillsDir = globalSkillsDir();
      const exists = await this.fileSystem.exists(skillsDir);

      if (exists) {
        const entries = await this.fileSystem.readdirWithFileTypes(skillsDir);
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith("dfl-")) {
            await this.fileSystem.rmdir(path.join(skillsDir, entry.name), { recursive: true });
          }
        }
      }
    } catch (error) {
      throw new UninstallError("Failed to remove global skills", error);
    }
  }

  async removeLauncher(): Promise<void> {
    try {
      const binDir = process.env["DFL_BIN_DIR"] ?? path.join(os.homedir(), ".local", "bin");
      const launcher = path.join(binDir, "dfl");

      const exists = await this.fileSystem.exists(launcher);
      if (exists) {
        await this.fileSystem.rmFile(launcher);
      }
    } catch (error) {
      throw new UninstallError("Failed to remove launcher", error);
    }
  }

  async removeInstallDir(): Promise<void> {
    try {
      const dflDir = process.env["DFL_INSTALL_DIR"] ?? path.join(os.homedir(), ".dfl");
      const installDir = path.join(dflDir, "install");

      if (process.platform === "win32") {
        console.log(
          "Note: On Windows the install directory cannot be removed while dfl is running."
        );
        console.log(`  Delete it manually: ${installDir}`);
        return;
      }

      const exists = await this.fileSystem.exists(installDir);
      if (exists) {
        await this.fileSystem.rmdir(installDir, { recursive: true });
      }
    } catch (error) {
      throw new UninstallError("Failed to remove install directory", error);
    }
  }

  async removeGlobalTrackDirectory(): Promise<void> {
    try {
      const trackRoot = resolveGlobalTrackDir();
      const exists = await this.fileSystem.exists(trackRoot);
      if (exists) {
        await this.fileSystem.rmdir(trackRoot, { recursive: true });
      }
    } catch (error) {
      throw new UninstallError("Failed to remove global track directory", error);
    }
  }

  async uninstall(options: { purge: boolean }): Promise<void> {
    await this.removeLauncher();
    await this.removeInstallDir();
    await this.removeGlobalSkills();
    await this.unregisterMCPServer();
    if (options.purge) {
      await this.removeGlobalTrackDirectory();
    }
  }
}
