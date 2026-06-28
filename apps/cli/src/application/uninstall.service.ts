import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { FileSystem } from "../infrastructure/file-system.js";
import { resolveGlobalTrackDir } from "@dev-workflow/git/track-directory-resolver.js";
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

export interface UninstallResult {
  steps: string[];
  windowsInstallDirNote?: string;
}

export class UninstallService {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly workingDirectory: string
  ) {}

  async removeSkills(): Promise<void> {
    try {
      const skillsBaseDir = path.join(this.workingDirectory, ".claude/skills");
      const exists = await this.fileSystem.exists(skillsBaseDir);

      if (exists) {
        const entries = await this.fileSystem.readdirWithFileTypes(skillsBaseDir);
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith("dfl-")) {
            await this.fileSystem.rmdir(path.join(skillsBaseDir, entry.name), { recursive: true });
          }
        }
        // Drop the now-empty skills/ dir so uninit leaves no dangling dev-workflow scaffolding
        // behind (only when WE emptied it — never remove a dir that still holds other skills).
        const remaining = await this.fileSystem.readdirWithFileTypes(skillsBaseDir);
        if (remaining.length === 0) {
          await this.fileSystem.rmdir(skillsBaseDir, { recursive: true });
        }
      }
    } catch (error) {
      throw new UninstallError("Failed to remove skills", error);
    }
  }

  async unregisterMCPServer(): Promise<void> {
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

  async removeInstallDir(): Promise<{ skipped: boolean; path: string }> {
    try {
      const dflDir = process.env["DFL_INSTALL_DIR"] ?? path.join(os.homedir(), ".dfl");
      const installDir = path.join(dflDir, "install");

      if (process.platform === "win32") {
        return { skipped: true, path: installDir };
      }

      const exists = await this.fileSystem.exists(installDir);
      if (exists) {
        await this.fileSystem.rmdir(installDir, { recursive: true });
      }
      return { skipped: false, path: installDir };
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

      // Attempt to clean up the parent ~/.dfl dir if it is now empty
      const dflDir = process.env["DFL_INSTALL_DIR"] ?? path.join(os.homedir(), ".dfl");
      try {
        await this.fileSystem.rmdir(dflDir);
      } catch {
        // Not empty or already gone — ignore
      }
    } catch (error) {
      throw new UninstallError("Failed to remove global track directory", error);
    }
  }

  async uninstall(options: { purge: boolean }): Promise<UninstallResult> {
    const steps: string[] = [];
    let windowsInstallDirNote: string | undefined;

    await this.removeLauncher();
    steps.push("Removed launcher");

    const installDirResult = await this.removeInstallDir();
    if (installDirResult.skipped) {
      windowsInstallDirNote = installDirResult.path;
    } else {
      steps.push("Removed install dir");
    }

    await this.removeGlobalSkills();
    steps.push("Removed global dfl-* skills");

    await this.unregisterMCPServer();
    steps.push("Removed MCP registration");

    if (options.purge) {
      await this.removeGlobalTrackDirectory();
      steps.push(`Purged data (${resolveGlobalTrackDir()})`);
    }

    return { steps, windowsInstallDirNote };
  }
}
