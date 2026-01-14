/**
 * InitCommand Behavioral Tests
 *
 * Tests actual behavior of the init command validation logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { InitCommand } from "../init-command.js";
import type { FileSystem } from "../../infrastructure/file-system.js";
import type { GitOperations } from "@dev-workflow/core";

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

// Mock child_process
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
 * Simple mock FileSystem for testing
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
function createMockGitOperations(
  options: {
    isWorktree?: boolean;
    gitRoot?: string;
  } = {}
): GitOperations {
  return {
    isGitRepository: vi.fn().mockReturnValue(true),
    isWorktree: vi.fn().mockReturnValue(options.isWorktree ?? false),
    findGitRoot: vi.fn().mockReturnValue(options.gitRoot ?? "/test/repo"),
    readSlugFromGitConfig: vi.fn().mockReturnValue(null),
    writeSlugToGitConfig: vi.fn(),
    getInitialCommitHash: vi.fn().mockReturnValue("abc123"),
  } as unknown as GitOperations;
}

describe("InitCommand", () => {
  let fileSystem: FileSystem;
  let gitOps: GitOperations;

  beforeEach(() => {
    vi.clearAllMocks();
    fileSystem = createMockFileSystem();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("validation", () => {
    it("should exit when running from a worktree", async () => {
      gitOps = createMockGitOperations({ isWorktree: true });

      const command = new InitCommand(fileSystem, gitOps, "/test/repo", "/test/cli");

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Cannot run init from a git worktree.");
    });

    it("should exit when --local and --url are both provided", async () => {
      gitOps = createMockGitOperations();

      const command = new InitCommand(fileSystem, gitOps, "/test/repo", "/test/cli");

      await expect(
        command.execute({ local: true, url: "postgresql://localhost/db" })
      ).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Cannot use --local and --url together.");
    });

    it("should exit when --url has invalid format", async () => {
      gitOps = createMockGitOperations();

      const command = new InitCommand(fileSystem, gitOps, "/test/repo", "/test/cli");

      await expect(command.execute({ url: "mysql://localhost/db" })).rejects.toThrow(
        "process.exit(1)"
      );
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Invalid connection string format.");
    });

    it("should accept valid postgresql:// URL and not fail on validation", async () => {
      gitOps = createMockGitOperations();

      const command = new InitCommand(fileSystem, gitOps, "/test/repo", "/test/cli");
      // This will fail later in the flow (e.g., database connection), but NOT on URL validation
      try {
        await command.execute({ url: "postgresql://localhost/db" });
      } catch {
        // May throw for other reasons (database, etc.) - we just check URL validation didn't fail
      }

      expect(mockConsoleError).not.toHaveBeenCalledWith("❌ Invalid connection string format.");
    });

    it("should accept valid postgres:// URL and not fail on validation", async () => {
      gitOps = createMockGitOperations();

      const command = new InitCommand(fileSystem, gitOps, "/test/repo", "/test/cli");
      // This will fail later in the flow (e.g., database connection), but NOT on URL validation
      try {
        await command.execute({ url: "postgres://localhost/db" });
      } catch {
        // May throw for other reasons (database, etc.) - we just check URL validation didn't fail
      }

      expect(mockConsoleError).not.toHaveBeenCalledWith("❌ Invalid connection string format.");
    });
  });
});
