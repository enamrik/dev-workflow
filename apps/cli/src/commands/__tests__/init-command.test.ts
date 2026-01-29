/**
 * InitCommand Behavioral Tests
 *
 * Tests actual behavior through the Awilix container with low-level mocks.
 * Mocks infrastructure (GitOperations, FileSystem, DbSourceProvider) while letting
 * the real InitCommand run its validation logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { asValue, asFunction } from "awilix";
import { createCliContainer, type CliContainer } from "../../di/container.js";
import type { FileSystem } from "../../infrastructure/file-system.js";
import type { TrackDirectoryResolver } from "@dev-workflow/git/track-directory-resolver.js";
import type { GitOperations } from "@dev-workflow/git/operations/git-operations.js";
import type { DbSourceProvider, DbSource } from "@dev-workflow/tracking";
import { InstallService } from "../../application/install.service.js";
import { ArchiveService } from "../../application/archive.service.js";
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
    rmdir: vi.fn().mockResolvedValue(undefined),
    readdirWithFileTypes: vi.fn().mockResolvedValue([]),
    copyDirectory: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
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
 * Create mock TrackDirectoryResolver
 */
function createMockResolver(): TrackDirectoryResolver {
  return {
    getTrackDirectory: vi.fn().mockReturnValue("/test/.track"),
    getLocalTrackDirectory: vi.fn().mockReturnValue("/test/repo/.track"),
    getGlobalTrackDirectory: vi.fn().mockReturnValue("/home/user/.track"),
    getDatabasePath: vi.fn().mockReturnValue("/test/.track/workflow.db"),
    getProjectId: vi.fn().mockReturnValue("test-slug"),
    getGitRoot: vi.fn().mockReturnValue("/test/repo"),
    getLocalIssueTemplatesPath: vi.fn().mockReturnValue("/test/repo/.track/templates/issues"),
    getLocalTaskTemplatesPath: vi.fn().mockReturnValue("/test/repo/.track/templates/tasks"),
    getGlobalIssueTemplatesPath: vi.fn().mockReturnValue("/home/user/.track/templates/issues"),
    getGlobalTaskTemplatesPath: vi.fn().mockReturnValue("/home/user/.track/templates/tasks"),
    getOldGlobalConfigDirectory: vi.fn().mockReturnValue("/home/user/.track/config"),
  } as unknown as TrackDirectoryResolver;
}

/**
 * Create mock DbSourceProvider
 */
function createMockSourceProvider() {
  const mockSource: DbSource = {
    projects: {
      findByGitRootHash: vi.fn().mockReturnValue(null),
    },
    types: {
      findAll: vi.fn().mockReturnValue([]),
      seedTypes: vi.fn(),
    },
  } as unknown as DbSource;

  return {
    getOrCreate: vi.fn().mockReturnValue(mockSource),
    closeAll: vi.fn(),
  } as unknown as DbSourceProvider;
}

/**
 * Setup test container with mocked infrastructure
 */
function setupTestContainer(options: { isWorktree?: boolean } = {}): CliContainer {
  const container = createCliContainer();

  const mockFileSystem = createMockFileSystem();
  const mockGitOps = createMockGitOps({ isWorktree: options.isWorktree });
  const mockResolver = createMockResolver();
  const mockSourceProvider = createMockSourceProvider();

  // Register mocked infrastructure
  container.register({
    workingDirectory: asValue("/test/repo"),
    packageRoot: asValue("/test/cli"),
    fileSystem: asValue(mockFileSystem),
    gitOps: asValue(mockGitOps),
    trackDirectoryResolver: asValue(mockResolver),
    sourceProvider: asValue(mockSourceProvider),
  });

  // Register services with injected dependencies
  container.register({
    installService: asFunction(
      ({
        fileSystem,
        workingDirectory,
        packageRoot,
        trackDirectoryResolver,
        sourceProvider,
        gitOps,
      }) => {
        return new InstallService(
          fileSystem as FileSystem,
          workingDirectory as string,
          packageRoot as string,
          trackDirectoryResolver as TrackDirectoryResolver,
          sourceProvider as DbSourceProvider,
          gitOps as GitOperations
        );
      }
    ).scoped(),

    archiveService: asFunction(
      ({
        fileSystem,
        workingDirectory,
        trackDirectoryResolver,
        sourceProvider,
        gitOps,
        installService,
      }) => {
        return new ArchiveService(
          fileSystem as FileSystem,
          workingDirectory as string,
          trackDirectoryResolver as TrackDirectoryResolver,
          sourceProvider as DbSourceProvider,
          gitOps as GitOperations,
          installService as InstallService
        );
      }
    ).scoped(),
  });

  // Register the command with injected dependencies
  container.register({
    initCommand: asFunction(({ gitOps, workingDirectory, installService, archiveService }) => {
      return new InitCommand(
        gitOps as GitOperations,
        workingDirectory as string,
        installService as InstallService,
        archiveService as ArchiveService
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
