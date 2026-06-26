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
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createTrackDirectoryResolver } from "@dev-workflow/git/track-directory-resolver.js";

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
  /** Isolated track directory for this test (testDir/.track) */
  public trackDir: string = "";
  /** Project-specific directory within trackDir */
  public projectTrackDir: string = "";
  /** Folder-based project ID (for track directory naming) - set after setup */
  public projectId: string = "";
  /** Database project UUID (used in issues.project_id) - set after init */
  public databaseProjectId: string = "";
  private cleanupOnSuccess: boolean;
  private useLocalBuild: boolean;
  private skipSampleProject: boolean;

  constructor(options: HarnessOptions = {}) {
    this.cleanupOnSuccess = !options.keepOnSuccess;
    this.useLocalBuild = options.useLocalBuild ?? true; // Default to local build
    this.skipSampleProject = options.skipSampleProject ?? false;

    // Create temp directory for this test run
    // Use realpathSync to resolve symlinks (e.g., /var -> /private/var on macOS)
    // This ensures the path matches what Claude CLI uses when registering MCP servers
    this.testDir = realpathSync(mkdtempSync(join(tmpdir(), "dev-workflow-e2e-")));
    // Use isolated .track directory within the test directory
    this.trackDir = join(this.testDir, ".track");
    // dbPath will be updated in setup() after we know the project ID
    this.dbPath = "";
  }

  /**
   * Get environment variables with DFL_HOME set for isolated testing
   */
  getEnv(): Record<string, string | undefined> {
    return {
      ...process.env,
      DFL_HOME: this.trackDir,
      // Ensure we don't inherit any existing DATABASE_PATH
      DATABASE_PATH: undefined,
    };
  }

  /**
   * Get path to MCP config file for passing to Claude via --mcp-config
   * Creates a JSON file in the test directory with the MCP server configuration
   * This ensures Claude can find the MCP server even in test environments
   */
  getMcpConfig(): string {
    const cliPath = this.getCliPath();
    const config = {
      mcpServers: {
        "dev-workflow-tracker": {
          type: "stdio",
          command: "node",
          args: [cliPath, "mcp"],
          env: {
            DFL_PROJECT_SLUG: this.projectId,
            GIT_ROOT: this.testDir,
            DFL_HOME: this.trackDir,
          },
        },
      },
    };
    // Write to a file to avoid shell escaping issues
    const configPath = join(this.testDir, ".mcp-test-config.json");
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return configPath;
  }

  /**
   * Get path to CLI executable
   */
  private getCliPath(): string {
    // Navigate from packages/e2e/dist/harness to apps/cli/dist/main.js
    return resolve(__dirname, "../../../../apps/cli/dist/main.js");
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
      const result = spawnSync("dfl", ["--version"], {
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

    // 3. Create sample project files
    if (!this.skipSampleProject) {
      await this.createSampleProject();
    } else {
      // Create minimal README
      writeFileSync(join(this.testDir, "README.md"), "# E2E Test Project\n");
    }

    // 4. Initial commit (must happen BEFORE computing projectId)
    execSync("git add .", { cwd: this.testDir, stdio: "pipe" });
    execSync('git commit -m "Initial commit"', {
      cwd: this.testDir,
      stdio: "pipe",
    });
    console.log("✓ Initial commit created");

    // Create isolated .track directory for this test
    mkdirSync(this.trackDir, { recursive: true });
    console.log(`✓ Created isolated track directory: ${this.trackDir}`);

    // Set DFL_HOME in environment so resolver uses our isolated directory
    process.env["DFL_HOME"] = this.trackDir;

    // Use the same resolver as production code to compute paths
    // Must be AFTER initial commit since we use git first commit hash
    const resolver = createTrackDirectoryResolver(this.testDir);
    this.projectId = resolver.getProjectId();
    this.projectTrackDir = resolver.getTrackDirectory();
    this.dbPath = resolver.getDatabasePath();

    // 5. Run dev-workflow init with isolated DFL_HOME
    console.log("🚀 Running dev-workflow init...");
    const devWorkflowCmd = this.useLocalBuild ? `node ${this.getCliPath()}` : "dfl";

    try {
      execSync(`${devWorkflowCmd} init`, {
        cwd: this.testDir,
        stdio: "inherit",
        env: this.getEnv(),
      });
    } catch (error) {
      console.error("❌ dev-workflow init failed");
      throw error;
    }

    // 6. Verify DB was created in isolated storage
    if (!existsSync(this.dbPath)) {
      throw new Error(`Database not created. Expected at: ${this.dbPath}`);
    }

    // 7. Look up the database project UUID (needed for filtering issues in tests)
    // Use git_root_hash (first commit SHA) as stable identifier
    const gitRootHash = resolver.getGitRootHash();
    const db = new Database(this.dbPath);
    const project = db
      .prepare("SELECT id FROM projects WHERE git_root_hash = ?")
      .get(gitRootHash) as { id: string } | undefined;
    db.close();

    if (!project) {
      throw new Error(`Project not found in database for git root hash: ${gitRootHash}`);
    }
    this.databaseProjectId = project.id;

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
    return this.useLocalBuild ? `node ${this.getCliPath()}` : "dfl";
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
    // Restore environment
    delete process.env["DFL_HOME"];

    if (testPassed && this.cleanupOnSuccess) {
      console.log("\n🧹 Cleaning up test environment...");
      try {
        // Run uninit to properly unregister MCP server and remove skills/subagents
        const devWorkflowCmd = this.useLocalBuild ? `node ${this.getCliPath()}` : "dfl";
        execSync(`${devWorkflowCmd} uninit`, {
          cwd: this.testDir,
          stdio: "pipe",
          env: this.getEnv(),
        });
        console.log("✓ Ran dev-workflow uninit");

        // Clean up test directory (includes the isolated .track directory)
        rmSync(this.testDir, { recursive: true, force: true });
        console.log("✓ Removed test directory");

        console.log("✓ Cleanup complete");
      } catch (error) {
        console.warn("⚠️ Cleanup failed:", error);
        // Still try to clean up directories even if uninit failed
        try {
          rmSync(this.testDir, { recursive: true, force: true });
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
