/**
 * InitCommand Behavioral Tests
 *
 * Tests actual behavior through the Awilix container with low-level mocks.
 * Mocks infrastructure (GitOperations, FileSystem) while letting the real
 * InitCommand run its validation logic.
 *
 * Note: Full testing of installation flows would require refactoring InitCommand
 * to accept InstallService and ArchiveService via constructor injection.
 * These tests focus on validation logic that can be tested with current dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { asValue, asFunction } from "awilix";
import { createCliContainer, type CliContainer } from "../../di/container.js";
import type { FileSystem } from "../../infrastructure/file-system.js";
import type { GitOperations } from "@dev-workflow/core";
import { InitCommand } from "../init-command.js";

// Mock console methods - these are at module level
let mockConsoleError: ReturnType<typeof vi.spyOn>;

// Setup process.exit mock in beforeAll to ensure it persists
beforeAll(() => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Mock child_process for git commands
vi.mock("node:child_process", () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd === "git rev-parse HEAD") {
      return "abc123\n";
    }
    if (cmd === "git rev-parse --git-dir") {
      return ".git\n";
    }
    return "";
  }),
}));

/**
 * Create mock FileSystem
 */
function createMockFileSystem(): FileSystem {
  return {
    exists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdirWithFileTypes: vi.fn().mockResolvedValue([]),
  } as unknown as FileSystem;
}

/**
 * Create mock GitOperations
 */
function createMockGitOps(options: { isWorktree?: boolean } = {}): GitOperations {
  return {
    isGitRepository: vi.fn().mockReturnValue(true),
    isWorktree: vi.fn().mockReturnValue(options.isWorktree ?? false),
    findGitRoot: vi.fn().mockReturnValue("/test/repo"),
    readSlugFromGitConfig: vi.fn().mockReturnValue(null),
    writeSlugToGitConfig: vi.fn(),
    getInitialCommitHash: vi.fn().mockReturnValue("abc123"),
  } as unknown as GitOperations;
}

/**
 * Setup test container with mocked infrastructure
 */
function setupTestContainer(options: { isWorktree?: boolean } = {}): CliContainer {
  const container = createCliContainer();

  const mockFileSystem = createMockFileSystem();
  const mockGitOps = createMockGitOps({ isWorktree: options.isWorktree });

  // Register mocked infrastructure
  container.register({
    workingDirectory: asValue("/test/repo"),
    packageRoot: asValue("/test/cli"),
    fileSystem: asValue(mockFileSystem),
    gitOps: asValue(mockGitOps),
  });

  // Register the command with injected dependencies
  container.register({
    initCommand: asFunction(({ fileSystem, gitOps, workingDirectory, packageRoot }) => {
      return new InitCommand(
        fileSystem as FileSystem,
        gitOps as GitOperations,
        workingDirectory as string,
        packageRoot as string
      );
    }).scoped(),
  });

  return container;
}

describe("InitCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("validation", () => {
    it("should exit when running from a worktree", async () => {
      const container = setupTestContainer({ isWorktree: true });

      const command = container.cradle.initCommand;

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Cannot run init from a git worktree.");
    });

    it("should exit when --local and --url are both provided", async () => {
      const container = setupTestContainer();

      const command = container.cradle.initCommand;

      await expect(
        command.execute({ local: true, url: "postgresql://localhost/db" })
      ).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Cannot use --local and --url together.");
    });

    it("should exit when --url has invalid format", async () => {
      const container = setupTestContainer();

      const command = container.cradle.initCommand;

      await expect(command.execute({ url: "mysql://localhost/db" })).rejects.toThrow(
        "process.exit(1)"
      );
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Invalid connection string format.");
    });

    it("should accept valid postgresql:// URL and not fail on validation", async () => {
      const container = setupTestContainer();

      const command = container.cradle.initCommand;
      // This will fail later in the flow (e.g., database connection), but NOT on URL validation
      try {
        await command.execute({ url: "postgresql://localhost/db" });
      } catch {
        // May throw for other reasons (database, etc.) - we just check URL validation didn't fail
      }

      expect(mockConsoleError).not.toHaveBeenCalledWith("❌ Invalid connection string format.");
    });

    it("should accept valid postgres:// URL and not fail on validation", async () => {
      const container = setupTestContainer();

      const command = container.cradle.initCommand;
      // This will fail later in the flow (e.g., database connection), but NOT on URL validation
      try {
        await command.execute({ url: "postgres://localhost/db" });
      } catch {
        // May throw for other reasons (database, etc.) - we just check URL validation didn't fail
      }

      expect(mockConsoleError).not.toHaveBeenCalledWith("❌ Invalid connection string format.");
    });

    it("should verify gitOps.isWorktree is called with working directory", async () => {
      const container = setupTestContainer({ isWorktree: true });
      const gitOps = container.cradle.gitOps;

      const command = container.cradle.initCommand;

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(gitOps.isWorktree).toHaveBeenCalledWith("/test/repo");
    });
  });
});
