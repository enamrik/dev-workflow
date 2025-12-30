/**
 * E2E Test Harness
 *
 * Creates an isolated test environment for E2E tests:
 * 1. Creates a temp directory
 * 2. Initializes git repo
 * 3. Runs dev-workflow init
 * 4. Provides utilities for running tests
 * 5. Cleans up on success, preserves on failure for investigation
 */

import { execSync, spawnSync } from "child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export interface HarnessOptions {
  /** Keep test directory even on success (for debugging) */
  keepOnSuccess?: boolean;
  /** Skip global install check (use local build) */
  useLocalBuild?: boolean;
}

export class E2ETestHarness {
  public readonly testDir: string;
  public readonly dbPath: string;
  private cleanupOnSuccess: boolean;
  private useLocalBuild: boolean;

  constructor(options: HarnessOptions = {}) {
    this.cleanupOnSuccess = !options.keepOnSuccess;
    this.useLocalBuild = options.useLocalBuild ?? false;

    // Create temp directory for this test run
    this.testDir = mkdtempSync(join(tmpdir(), "dev-workflow-e2e-"));
    this.dbPath = join(this.testDir, ".track", "data", "workflow.db");
  }

  /**
   * Setup test environment:
   * 1. Optionally ensure latest dev-workflow is installed globally
   * 2. Initialize git repo
   * 3. Run dev-workflow init
   */
  async setup(): Promise<void> {
    console.log(`\n📁 Test directory: ${this.testDir}\n`);

    // 1. Check/install dev-workflow
    if (this.useLocalBuild) {
      console.log("📦 Using local dev-workflow build...");
      // Build the project first
      try {
        execSync("pnpm build", {
          cwd: join(__dirname, "../../../.."),
          stdio: "inherit",
        });
      } catch (error) {
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

    // 3. Create a simple file and initial commit
    writeFileSync(join(this.testDir, "README.md"), "# E2E Test Project\n");
    execSync("git add .", { cwd: this.testDir, stdio: "pipe" });
    execSync('git commit -m "Initial commit"', {
      cwd: this.testDir,
      stdio: "pipe",
    });
    console.log("✓ Initial commit created");

    // 4. Run dev-workflow init
    console.log("🚀 Running dev-workflow init...");
    const devWorkflowCmd = this.useLocalBuild
      ? `node ${join(__dirname, "../../../../cli/dist/index.js")}`
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

    // 5. Verify DB was created
    if (!existsSync(this.dbPath)) {
      // Try alternate path
      const altPath = join(this.testDir, ".track/data/workflow.db");
      if (existsSync(altPath)) {
        (this as any).dbPath = altPath;
      } else {
        throw new Error(`Database not created. Expected at: ${this.dbPath}`);
      }
    }
    console.log(`✓ Database ready at ${this.dbPath}\n`);
  }

  /**
   * Get the dev-workflow command to use
   */
  getDevWorkflowCommand(): string {
    return this.useLocalBuild
      ? `node ${join(__dirname, "../../../../cli/dist/index.js")}`
      : "dev-workflow";
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
      console.log("\n🧹 Cleaning up test directory...");
      try {
        rmSync(this.testDir, { recursive: true, force: true });
        console.log("✓ Cleanup complete");
      } catch (error) {
        console.warn("⚠️ Cleanup failed:", error);
      }
    } else {
      console.log("\n⚠️ Test directory preserved for investigation:");
      console.log(`   ${this.testDir}`);
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
