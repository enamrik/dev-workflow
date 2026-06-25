/**
 * SetupCommand - Check and install external dependencies
 *
 * Validates that all required dependencies are installed and optionally
 * installs missing ones.
 */

import { execSync, spawnSync } from "node:child_process";
import { platform } from "node:os";

export interface SetupOptions {
  /** Attempt to install missing dependencies */
  fix?: boolean;
}

interface CheckResult {
  ok: boolean;
  version?: string;
  error?: string;
}

export class SetupCommand {
  /**
   * Check and optionally fix external dependencies.
   */
  async execute(options: SetupOptions = {}): Promise<void> {
    console.log("🔍 Checking dev-workflow dependencies...\n");

    const checks = [
      {
        name: "Node.js",
        check: () => this.checkNode(),
        fix: null as (() => Promise<void>) | null,
        required: true,
      },
      {
        name: "Git",
        check: () => this.checkGit(),
        fix: null,
        required: true,
      },
      {
        name: "better-sqlite3",
        check: () => this.checkSqlite(),
        fix: () => this.fixSqlite(),
        required: true,
      },
      {
        name: "Claude CLI",
        check: () => this.checkClaude(),
        fix: () => this.installClaude(),
        required: false,
      },
      {
        name: "GitHub CLI (gh)",
        check: () => this.checkGh(),
        fix: () => this.installGh(),
        required: false,
      },
    ];

    let hasErrors = false;
    let hasOptionalMissing = false;

    for (const { name, check, fix, required } of checks) {
      const result = check();

      if (result.ok) {
        console.log(`✓ ${name}: ${result.version}`);
      } else {
        const icon = required ? "✗" : "⚠";
        console.log(`${icon} ${name}: ${result.error}`);

        if (required) {
          hasErrors = true;
        } else {
          hasOptionalMissing = true;
        }

        if (options.fix && fix) {
          console.log(`  → Attempting to install ${name}...`);
          try {
            await fix();
            const recheck = check();
            if (recheck.ok) {
              console.log(`  ✓ ${name} installed: ${recheck.version}`);
              if (required) hasErrors = false;
            } else {
              console.log(`  ✗ Installation failed: ${recheck.error}`);
            }
          } catch (error) {
            console.log(`  ✗ Installation failed: ${error instanceof Error ? error.message : error}`);
          }
        } else if (fix && !options.fix) {
          console.log(`  → Run with --fix to attempt installation`);
        }
      }
    }

    console.log("");

    if (hasErrors) {
      console.log("❌ Some required dependencies are missing.");
      console.log("   Install them manually or run: dev-workflow setup --fix");
      process.exit(1);
    } else if (hasOptionalMissing) {
      console.log("⚠ Optional dependencies missing. Some features may be limited.");
      console.log("  Run: dev-workflow setup --fix to install them.");
    } else {
      console.log("✨ All dependencies are satisfied!");
    }
  }

  private checkNode(): CheckResult {
    try {
      const version = process.version;
      const major = parseInt(version.slice(1).split(".")[0] ?? "0", 10);

      if (major >= 20) {
        return { ok: true, version };
      } else {
        return { ok: false, error: `${version} (requires >= 20.0)` };
      }
    } catch {
      return { ok: false, error: "Not found" };
    }
  }

  private checkGit(): CheckResult {
    try {
      const result = spawnSync("git", ["--version"], { encoding: "utf-8" });
      if (result.status === 0) {
        const version = result.stdout.trim().replace("git version ", "");
        return { ok: true, version };
      }
      return { ok: false, error: "Not found" };
    } catch {
      return { ok: false, error: "Not found" };
    }
  }

  private checkSqlite(): CheckResult {
    try {
      // Try to require better-sqlite3 to check if native bindings work
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require("better-sqlite3");
      const db = new Database(":memory:");
      const row = db.prepare("SELECT sqlite_version() as v").get() as { v: string };
      db.close();
      return { ok: true, version: `SQLite ${row.v}` };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message.split("\n")[0] : "Failed to load",
      };
    }
  }

  private async fixSqlite(): Promise<void> {
    // Rebuild better-sqlite3 native module
    execSync("npm rebuild better-sqlite3", { stdio: "inherit" });
  }

  private checkClaude(): CheckResult {
    try {
      const result = spawnSync("claude", ["--version"], { encoding: "utf-8" });
      if (result.status === 0) {
        const version = result.stdout.trim();
        return { ok: true, version };
      }
      return { ok: false, error: "Not found" };
    } catch {
      return { ok: false, error: "Not found" };
    }
  }

  private async installClaude(): Promise<void> {
    console.log("  Installing Claude CLI via npm...");
    execSync("npm install -g @anthropic-ai/claude-code", { stdio: "inherit" });
  }

  private checkGh(): CheckResult {
    try {
      const result = spawnSync("gh", ["--version"], { encoding: "utf-8" });
      if (result.status === 0) {
        const version = result.stdout.split("\n")[0]?.trim() ?? "";
        return { ok: true, version };
      }
      return { ok: false, error: "Not found" };
    } catch {
      return { ok: false, error: "Not found" };
    }
  }

  private async installGh(): Promise<void> {
    const os = platform();

    if (os === "darwin") {
      console.log("  Installing GitHub CLI via Homebrew...");
      execSync("brew install gh", { stdio: "inherit" });
    } else if (os === "linux") {
      console.log("  Installing GitHub CLI...");
      // Try apt first, then snap
      try {
        execSync(
          "type -p curl >/dev/null || (sudo apt update && sudo apt install curl -y) && " +
            "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && " +
            'sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null && ' +
            "sudo apt update && sudo apt install gh -y",
          { stdio: "inherit" }
        );
      } catch {
        console.log("  apt installation failed, trying snap...");
        execSync("sudo snap install gh", { stdio: "inherit" });
      }
    } else if (os === "win32") {
      console.log("  Installing GitHub CLI via winget...");
      execSync("winget install --id GitHub.cli", { stdio: "inherit" });
    } else {
      throw new Error(`Unsupported platform: ${os}. Install gh manually.`);
    }
  }
}
