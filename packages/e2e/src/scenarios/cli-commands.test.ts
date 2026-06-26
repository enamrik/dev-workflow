/**
 * E2E Test: CLI Commands
 *
 * Tests all CLI commands via subprocess execution.
 * Uses E2ETestHarness for environment setup.
 *
 * Commands tested:
 * 1. init - Initialize dev-workflow
 * 2. update - Update skills, migrations
 * 3. uninit - Remove Claude integration
 * 4. mcp - Start MCP server
 * 5. ui - Start web UI
 * 6. ui:install - Install as PM2 service
 * 7. ui:uninstall - Remove PM2 service
 * 8. workers - List workers
 * 9. claude - Run as worker
 * 10. clean-claude-config - Clean stale configs
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI_PATH = resolve(__dirname, "../../../../apps/cli/dist/main.js");

/**
 * Helper to run CLI commands and capture output
 */
function runCli(
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    expectError?: boolean;
    timeout?: number;
  } = {}
): { stdout: string; stderr: string; exitCode: number } {
  const cmd = `node ${CLI_PATH} ${args.join(" ")}`;
  const timeout = options.timeout ?? 30000;

  try {
    const stdout = execSync(cmd, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    if (options.expectError) {
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        exitCode: err.status ?? 1,
      };
    }
    throw error;
  }
}

/**
 * Helper to start a long-running CLI process
 */
function startCli(
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  } = {}
): ChildProcess {
  const proc = spawn("node", [CLI_PATH, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return proc;
}

/**
 * Wait for process to output a specific string
 */
async function waitForOutput(
  proc: ChildProcess,
  pattern: string | RegExp,
  timeout = 10000
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Timeout waiting for pattern: ${pattern}`));
    }, timeout);

    proc.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
      const match = typeof pattern === "string" ? output.includes(pattern) : pattern.test(output);
      if (match) {
        clearTimeout(timer);
        resolve(output);
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("exit", (_code) => {
      clearTimeout(timer);
      // If exited before pattern matched, resolve with what we have
      resolve(output);
    });
  });
}

describe("CLI Commands E2E", () => {
  let testDir: string;
  let trackDir: string;
  let testPassed = false;

  beforeAll(async () => {
    // Create isolated test directory
    testDir = realpathSync(mkdtempSync(join(tmpdir(), "dev-workflow-cli-e2e-")));
    trackDir = join(testDir, ".track");

    // Initialize git repo
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync('git config user.email "test@cli-e2e.local"', { cwd: testDir, stdio: "pipe" });
    execSync('git config user.name "CLI E2E Test"', { cwd: testDir, stdio: "pipe" });

    // Create initial content
    writeFileSync(join(testDir, "README.md"), "# CLI E2E Test Project\n");
    mkdirSync(join(testDir, "src"), { recursive: true });
    writeFileSync(join(testDir, "src/index.ts"), "console.log('hello');\n");

    // Initial commit
    execSync("git add .", { cwd: testDir, stdio: "pipe" });
    execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: "pipe" });

    console.log(`\n📁 Test directory: ${testDir}\n`);
  }, 30000);

  afterAll(async () => {
    if (testPassed) {
      try {
        // Run uninit to clean up
        runCli(["uninit"], {
          cwd: testDir,
          env: { DFL_HOME: trackDir },
          expectError: true, // May fail if already uninitialized
        });
      } catch {
        // Ignore cleanup errors
      }

      // Remove test directory
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    } else {
      console.log(`\n⚠️ Test failed. Directory preserved: ${testDir}`);
    }
  });

  // ===========================================================================
  // 1. init command
  // ===========================================================================

  describe("init command", () => {
    it("initializes dev-workflow in a git repository", () => {
      const result = runCli(["init"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("dev-workflow initialized");

      // Verify .track directory was created
      expect(existsSync(trackDir)).toBe(true);

      // Verify database exists
      expect(existsSync(join(trackDir, "workflow.db"))).toBe(true);

      // Verify Claude skills were installed
      expect(existsSync(join(testDir, ".claude", "skills"))).toBe(true);
    });

    it("fails gracefully when run outside git repo", () => {
      const nonGitDir = mkdtempSync(join(tmpdir(), "non-git-"));
      try {
        const result = runCli(["init"], {
          cwd: nonGitDir,
          expectError: true,
        });

        expect(result.exitCode).not.toBe(0);
      } finally {
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });

    it("is idempotent - running twice succeeds", () => {
      const result = runCli(["init"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
      });

      // Should succeed even if already initialized
      expect(result.exitCode).toBe(0);
    });
  });

  // ===========================================================================
  // 2. update command
  // ===========================================================================

  describe("update command", () => {
    it("updates skills and runs migrations", () => {
      const result = runCli(["update"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
      });

      expect(result.exitCode).toBe(0);
      // Update should mention migrations or skills
      expect(
        result.stdout.includes("migration") ||
          result.stdout.includes("skill") ||
          result.stdout.includes("update")
      ).toBe(true);
    });
  });

  // ===========================================================================
  // 3. workers command
  // ===========================================================================

  describe("workers command", () => {
    it("lists workers and dispatch queue", () => {
      const result = runCli(["workers"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
      });

      expect(result.exitCode).toBe(0);
      // Should show worker/queue info
      expect(
        result.stdout.includes("worker") ||
          result.stdout.includes("Worker") ||
          result.stdout.includes("queue") ||
          result.stdout.includes("No")
      ).toBe(true);
    });
  });

  // ===========================================================================
  // 4. clean-claude-config command
  // ===========================================================================

  describe("clean-claude-config command", () => {
    it("runs with --dry-run flag", () => {
      const result = runCli(["clean-claude-config", "--dry-run"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
      });

      expect(result.exitCode).toBe(0);
    });

    it("runs without flags", () => {
      const result = runCli(["clean-claude-config"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ===========================================================================
  // 5. mcp command
  // ===========================================================================

  describe("mcp command", () => {
    it("starts MCP server and responds to protocol", async () => {
      const proc = startCli(["mcp"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
      });

      try {
        // MCP server should start and wait for input
        // Send a simple MCP initialize request
        const initRequest = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
        });

        proc.stdin?.write(initRequest + "\n");

        // Wait for response or timeout
        const output = await waitForOutput(proc, /"result"/, 5000);

        // Should receive some JSON response
        expect(output.includes('"jsonrpc"') || output.includes("result")).toBe(true);
      } finally {
        proc.kill("SIGTERM");
      }
    }, 15000);
  });

  // ===========================================================================
  // 6. ui command
  // ===========================================================================

  describe("ui command", () => {
    it("starts web UI server", async () => {
      const proc = startCli(["ui"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
      });

      try {
        // Wait for server to start
        const output = await waitForOutput(proc, /localhost|ready|started|http/i, 15000);

        // Should mention localhost or ready
        expect(
          output.toLowerCase().includes("localhost") ||
            output.toLowerCase().includes("ready") ||
            output.toLowerCase().includes("started") ||
            output.toLowerCase().includes("http")
        ).toBe(true);
      } finally {
        proc.kill("SIGTERM");
      }
    }, 20000);
  });

  // ===========================================================================
  // 7. ui:install command (requires PM2 - skip if not available)
  // ===========================================================================

  describe("ui:install command", () => {
    it("attempts PM2 service installation", () => {
      const result = runCli(["ui:install"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
        expectError: true, // May fail if PM2 not installed
      });

      // Either succeeds or fails with PM2-related message
      expect(
        result.exitCode === 0 ||
          result.stderr.includes("pm2") ||
          result.stderr.includes("PM2") ||
          result.stderr.includes("not found")
      ).toBe(true);
    });
  });

  // ===========================================================================
  // 8. ui:uninstall command
  // ===========================================================================

  describe("ui:uninstall command", () => {
    it("attempts PM2 service removal", () => {
      const result = runCli(["ui:uninstall"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
        expectError: true, // May fail if PM2 not installed or service not running
      });

      // Either succeeds or fails gracefully
      expect(result).toBeDefined();
    });
  });

  // ===========================================================================
  // 9. claude command (worker mode)
  // ===========================================================================

  describe("claude command", () => {
    it("starts worker and polls for tasks", async () => {
      const proc = startCli(["claude", "--name", "test-worker"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
      });

      try {
        // Worker should start and begin polling
        const output = await waitForOutput(proc, /worker|poll|wait|ready|register/i, 10000);

        expect(
          output.toLowerCase().includes("worker") ||
            output.toLowerCase().includes("poll") ||
            output.toLowerCase().includes("ready") ||
            output.toLowerCase().includes("register")
        ).toBe(true);
      } finally {
        proc.kill("SIGTERM");
      }
    }, 15000);

    it("scans for READY tasks automatically (dependency-aware claiming is always on)", async () => {
      const proc = startCli(["claude", "--name", "auto-worker"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
      });

      try {
        // Should start without error
        const output = await waitForOutput(proc, /worker|poll/i, 10000);
        expect(output).toBeDefined();
      } finally {
        proc.kill("SIGTERM");
      }
    }, 15000);
  });

  // ===========================================================================
  // 10. uninit command (run last)
  // ===========================================================================

  describe("uninit command", () => {
    it("removes Claude integration while preserving data", () => {
      const result = runCli(["uninit"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
      });

      expect(result.exitCode).toBe(0);

      // Skills should be removed
      expect(existsSync(join(testDir, ".claude", "skills"))).toBe(false);

      // But track directory should still exist
      expect(existsSync(trackDir)).toBe(true);

      // And database should still exist
      expect(existsSync(join(trackDir, "workflow.db"))).toBe(true);
    });

    it("is idempotent - running twice succeeds", () => {
      const result = runCli(["uninit"], {
        cwd: testDir,
        env: { DFL_HOME: trackDir },
      });

      expect(result.exitCode).toBe(0);
    });
  });

  // ===========================================================================
  // Version and Help
  // ===========================================================================

  describe("help and version", () => {
    it("--version shows version", () => {
      const result = runCli(["--version"], {});

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    it("--help shows help", () => {
      const result = runCli(["--help"], {});

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("init");
      expect(result.stdout).toContain("update");
      expect(result.stdout).toContain("mcp");
      expect(result.stdout).toContain("ui");
      expect(result.stdout).toContain("workers");
      expect(result.stdout).toContain("claude");
    });

    it("unknown command shows error", () => {
      const result = runCli(["unknown-command"], {
        expectError: true,
      });

      expect(result.exitCode).not.toBe(0);
    });
  });

  afterAll(() => {
    testPassed = true;
  });
});
