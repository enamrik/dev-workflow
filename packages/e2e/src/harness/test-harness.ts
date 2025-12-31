/**
 * E2E Test Harness
 *
 * Creates an isolated test environment for E2E tests:
 * 1. Creates a temp directory
 * 2. Initializes git repo
 * 3. Creates a sample project structure
 * 4. Runs dev-workflow init
 * 5. Provides utilities for running tests
 * 6. Cleans up on success, preserves on failure for investigation
 */

import { execSync, spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export interface HarnessOptions {
  /** Keep test directory even on success (for debugging) */
  keepOnSuccess?: boolean;
  /** Skip global install check (use local build) */
  useLocalBuild?: boolean;
  /** Skip creating sample project files */
  skipSampleProject?: boolean;
}

export class E2ETestHarness {
  public readonly testDir: string;
  public dbPath: string;
  /** Global track directory (~/.track/<project-id>) - set after init */
  public trackDir: string = "";
  private cleanupOnSuccess: boolean;
  private useLocalBuild: boolean;
  private skipSampleProject: boolean;

  constructor(options: HarnessOptions = {}) {
    this.cleanupOnSuccess = !options.keepOnSuccess;
    this.useLocalBuild = options.useLocalBuild ?? true; // Default to local build
    this.skipSampleProject = options.skipSampleProject ?? false;

    // Create temp directory for this test run
    this.testDir = mkdtempSync(join(tmpdir(), "dev-workflow-e2e-"));
    // dbPath will be updated in setup() after we know the project ID
    this.dbPath = "";
  }

  /**
   * Compute project ID from git root path (matches TrackDirectoryResolver logic)
   * Format: <repo-folder-name>-<6-char-hash>
   */
  private computeProjectId(gitRoot: string): string {
    const folderName = basename(gitRoot);
    const hash = crypto.createHash("sha256").update(gitRoot).digest("hex").slice(0, 6);
    return `${folderName}-${hash}`;
  }

  /**
   * Get path to CLI executable
   */
  private getCliPath(): string {
    // Navigate from e2e/src/harness to cli/dist/index.js
    return resolve(__dirname, "../../../cli/dist/index.js");
  }

  /**
   * Setup test environment:
   * 1. Optionally ensure latest dev-workflow is installed globally
   * 2. Initialize git repo
   * 3. Create sample project files
   * 4. Run dev-workflow init
   */
  async setup(): Promise<void> {
    console.log(`\n📁 Test directory: ${this.testDir}\n`);

    // 1. Check/install dev-workflow
    if (this.useLocalBuild) {
      console.log("📦 Using local dev-workflow build...");
      // Build the project first
      try {
        execSync("pnpm build", {
          cwd: resolve(__dirname, "../../.."),
          stdio: "inherit",
        });
      } catch {
        console.warn("⚠️ Build failed, continuing with existing build");
      }
    } else {
      console.log("📦 Checking dev-workflow installation...");
      const result = spawnSync("dev-workflow", ["--version"], {
        encoding: "utf-8",
      });
      if (result.error || result.status !== 0) {
        console.log("⚠️ dev-workflow not found globally, using local build");
        this.useLocalBuild = true;
      } else {
        console.log(`✓ dev-workflow ${result.stdout.trim()} available`);
      }
    }

    // 2. Initialize git repo
    console.log("🔧 Initializing git repo...");
    execSync("git init", { cwd: this.testDir, stdio: "pipe" });
    execSync('git config user.email "test@e2e-test.local"', {
      cwd: this.testDir,
      stdio: "pipe",
    });
    execSync('git config user.name "E2E Test"', {
      cwd: this.testDir,
      stdio: "pipe",
    });
    console.log("✓ Git repo initialized");

    // Compute the global track directory path (matches TrackDirectoryResolver)
    // Need to get the resolved git root (may differ from testDir due to symlinks)
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd: this.testDir,
      encoding: "utf-8",
    }).trim();
    const projectId = this.computeProjectId(gitRoot);
    this.trackDir = join(homedir(), ".track", projectId);
    this.dbPath = join(this.trackDir, "data", "workflow.db");

    // 3. Create sample project files
    if (!this.skipSampleProject) {
      await this.createSampleProject();
    } else {
      // Create minimal README
      writeFileSync(join(this.testDir, "README.md"), "# E2E Test Project\n");
    }

    // 4. Initial commit
    execSync("git add .", { cwd: this.testDir, stdio: "pipe" });
    execSync('git commit -m "Initial commit"', {
      cwd: this.testDir,
      stdio: "pipe",
    });
    console.log("✓ Initial commit created");

    // 5. Run dev-workflow init
    console.log("🚀 Running dev-workflow init...");
    const devWorkflowCmd = this.useLocalBuild
      ? `node ${this.getCliPath()}`
      : "dev-workflow";

    try {
      execSync(`${devWorkflowCmd} init`, {
        cwd: this.testDir,
        stdio: "inherit",
        env: {
          ...process.env,
          // Ensure we don't inherit any existing DATABASE_PATH
          DATABASE_PATH: undefined,
        },
      });
    } catch (error) {
      console.error("❌ dev-workflow init failed");
      throw error;
    }

    // 6. Verify DB was created in global storage
    if (!existsSync(this.dbPath)) {
      throw new Error(`Database not created. Expected at: ${this.dbPath}`);
    }
    console.log(`✓ Database ready at ${this.dbPath}\n`);
  }

  /**
   * Create a realistic sample project for testing
   */
  async createSampleProject(): Promise<void> {
    console.log("📝 Creating sample project...");

    // Create directory structure
    mkdirSync(join(this.testDir, "src"), { recursive: true });

    // Create package.json
    writeFileSync(
      join(this.testDir, "package.json"),
      JSON.stringify(
        {
          name: "e2e-test-project",
          version: "1.0.0",
          type: "module",
          scripts: {
            test: "echo 'Tests passed'",
          },
        },
        null,
        2
      )
    );

    // Create README.md
    writeFileSync(
      join(this.testDir, "README.md"),
      `# E2E Test Project

A sample project for testing dev-workflow E2E scenarios.

## Files

- \`src/utils.ts\` - Utility functions
- \`src/index.ts\` - Main entry point
`
    );

    // Create src/utils.ts - this is what we'll rename in tests
    writeFileSync(
      join(this.testDir, "src/utils.ts"),
      `/**
 * Utility functions
 */

export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0] ?? "";
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/\\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
`
    );

    // Create src/index.ts
    writeFileSync(
      join(this.testDir, "src/index.ts"),
      `import { formatDate, capitalize } from "./utils.js";

console.log("Hello from E2E test project!");
console.log("Today is:", formatDate(new Date()));
console.log("Capitalized:", capitalize("hello"));
`
    );

    console.log("✓ Sample project created");
  }

  /**
   * Get the dev-workflow command to use
   */
  getDevWorkflowCommand(): string {
    return this.useLocalBuild
      ? `node ${this.getCliPath()}`
      : "dev-workflow";
  }

  /**
   * Get a database connection
   */
  getDb(): Database.Database {
    return new Database(this.dbPath);
  }

  /**
   * Check if a file exists relative to test directory
   */
  fileExists(relativePath: string): boolean {
    return existsSync(join(this.testDir, relativePath));
  }

  /**
   * Read file contents relative to test directory
   */
  readFile(relativePath: string): string {
    return readFileSync(join(this.testDir, relativePath), "utf-8");
  }

  /**
   * Write file contents relative to test directory
   */
  writeFile(relativePath: string, content: string): void {
    const fullPath = join(this.testDir, relativePath);
    const dir = join(fullPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, content);
  }

  /**
   * Mark test as failed (prevents cleanup)
   */
  markFailed(): void {
    this.cleanupOnSuccess = false;
  }

  /**
   * Cleanup test environment
   * @param testPassed - Whether the test passed
   */
  cleanup(testPassed: boolean): void {
    if (testPassed && this.cleanupOnSuccess) {
      console.log("\n🧹 Cleaning up test environment...");
      try {
        // Run uninit to properly unregister MCP server and remove skills/subagents
        const devWorkflowCmd = this.useLocalBuild
          ? `node ${this.getCliPath()}`
          : "dev-workflow";
        execSync(`${devWorkflowCmd} uninit`, {
          cwd: this.testDir,
          stdio: "pipe",
        });
        console.log("✓ Ran dev-workflow uninit");

        // Clean up local test directory
        rmSync(this.testDir, { recursive: true, force: true });
        console.log("✓ Removed test directory");

        // Clean up global track directory (uninit should have done this, but ensure it's gone)
        if (this.trackDir && existsSync(this.trackDir)) {
          rmSync(this.trackDir, { recursive: true, force: true });
          console.log("✓ Removed track directory");
        }

        console.log("✓ Cleanup complete");
      } catch (error) {
        console.warn("⚠️ Cleanup failed:", error);
        // Still try to clean up directories even if uninit failed
        try {
          rmSync(this.testDir, { recursive: true, force: true });
          if (this.trackDir && existsSync(this.trackDir)) {
            rmSync(this.trackDir, { recursive: true, force: true });
          }
        } catch {
          // Ignore secondary cleanup errors
        }
      }
    } else {
      console.log("\n⚠️ Test directories preserved for investigation:");
      console.log(`   Test dir: ${this.testDir}`);
      console.log(`   Track dir: ${this.trackDir}`);
      console.log(`   Database: ${this.dbPath}`);
    }
  }

  /**
   * Print test directory contents (for debugging)
   */
  printContents(): void {
    console.log("\n📂 Test directory contents:");
    try {
      const result = execSync("find . -type f | head -50", {
        cwd: this.testDir,
        encoding: "utf-8",
      });
      console.log(result);
    } catch {
      console.log("(unable to list contents)");
    }
  }
}
