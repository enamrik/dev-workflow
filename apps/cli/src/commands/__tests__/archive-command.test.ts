/**
 * ArchiveCommand, UnarchiveCommand, NukeCommand Behavioral Tests
 *
 * Tests actual behavior through the Awilix container with low-level mocks.
 * Mocks infrastructure (DbSourceProvider, GitOperations, FileSystem) while
 * letting real services and commands run.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { asValue, asFunction } from "awilix";
import { createCliContainer, type CliContainer } from "../../di/container.js";
import type { FileSystem } from "../../infrastructure/file-system.js";
import type { TrackDirectoryResolver } from "@dev-workflow/git/track-directory-resolver.js";
import type { GitOperations } from "@dev-workflow/git/operations/git-operations.js";
import {
  Issue,
  type DbSourceProvider,
  type DbSource,
  type ProjectRepository,
  type Project,
} from "@dev-workflow/tracking";
import type { DatabaseConfigService } from "../../application/database.service.js";
import { InstallService } from "../../application/install.service.js";
import { ArchiveService } from "../../application/archive.service.js";
import { ArchiveCommand, UnarchiveCommand, NukeCommand } from "../archive-command.js";
import type { UserPrompt } from "../../infrastructure/user-prompt.js";
import { Effect } from "@dev-workflow/effect";

// Mock console methods - these are at module level
let mockConsoleLog: ReturnType<typeof vi.spyOn>;
let mockConsoleError: ReturnType<typeof vi.spyOn>;

// Setup process.exit mock in beforeAll to ensure it persists
beforeAll(() => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

/**
 * Create a mock project
 */
function createMockProject(overrides: Record<string, unknown> = {}): Project {
  return {
    id: "proj-123",
    name: "test-project",
    gitHash: "abc123",
    gitRootHash: "abc123",
    slug: "test-project",
    isArchived: false,
    syncConfig: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Project;
}

/**
 * Create mock FileSystem
 */
function createMockFileSystem(): FileSystem {
  return {
    exists: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
    readdirWithFileTypes: vi.fn().mockResolvedValue([]),
  } as unknown as FileSystem;
}

/**
 * Create mock TrackDirectoryResolver
 */
function createMockResolver(): TrackDirectoryResolver {
  return {
    getTrackDirectory: vi.fn().mockReturnValue("/test/.track"),
    getDatabasePath: vi.fn().mockReturnValue("/test/.track/workflow.db"),
    getProjectId: vi.fn().mockReturnValue("test-slug"),
  } as unknown as TrackDirectoryResolver;
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
 * Create mock ProjectRepository
 */
function createMockProjectsRepository(
  options: {
    project?: Project | null | undefined;
    archivedProject?: Project | null | undefined;
  } = {}
) {
  // Use 'in' check to distinguish "not passed" vs "passed as null"
  const projectValue = "project" in options ? options.project : createMockProject();
  const archivedValue = "archivedProject" in options ? options.archivedProject : null;

  return {
    findByGitRootHash: vi.fn().mockImplementation(() => {
      // Return archived project if looking for archived, otherwise regular project
      return Effect.succeed(archivedValue ?? projectValue);
    }),
    archive: vi
      .fn()
      .mockReturnValue(Effect.succeed(projectValue ? { ...projectValue, isArchived: true } : null)),
    unarchive: vi
      .fn()
      .mockReturnValue(
        Effect.succeed(projectValue ? { ...projectValue, isArchived: false } : null)
      ),
    hardDelete: vi.fn().mockReturnValue(Effect.succeed(undefined)),
  } as unknown as ProjectRepository;
}

/**
 * Create mock DbSourceProvider with configurable repositories
 */
function createMockSourceProvider(
  options: {
    projectsRepo?: ProjectRepository;
    tasks?: unknown[];
    issues?: unknown[];
  } = {}
) {
  const projectsRepo = options.projectsRepo ?? createMockProjectsRepository();
  const tasks = options.tasks ?? [];
  const issues = options.issues ?? [];

  const mockClient = {
    tasks: {
      findMany: vi.fn().mockImplementation(({ status }: { status?: string }) => {
        return Effect.succeed(
          tasks.filter((t: unknown) => !status || (t as { status: string }).status === status)
        );
      }),
    },
    issues: {
      findMany: vi.fn().mockImplementation(() => Effect.succeed(issues)),
    },
  };

  const mockSource: DbSource = {
    projects: projectsRepo,
    createClient: vi.fn().mockReturnValue(mockClient),
  } as unknown as DbSource;

  return {
    getOrCreate: vi.fn().mockReturnValue(mockSource),
    closeAll: vi.fn(),
  } as unknown as DbSourceProvider;
}

/**
 * Create mock DatabaseConfigService
 */
function createMockDatabaseService(options: { isRemote?: boolean } = {}) {
  return {
    isRemote: vi.fn().mockResolvedValue(options.isRemote ?? false),
    getStatus: vi.fn().mockResolvedValue({
      provider: options.isRemote ? "neon" : "sqlite",
      connectionString: options.isRemote
        ? "postgresql://user:pass@host/db"
        : "sqlite:///test/.track/workflow.db",
    }),
  } as unknown as DatabaseConfigService;
}

/**
 * Setup test container with mocked infrastructure
 */
function setupTestContainer(
  options: {
    project?: Project | null;
    archivedProject?: Project | null;
    tasks?: unknown[];
    issues?: unknown[];
    isWorktree?: boolean;
    isRemote?: boolean;
    fileSystemExists?: boolean;
  } = {}
): CliContainer {
  const container = createCliContainer();

  const mockFileSystem = createMockFileSystem();
  if ("fileSystemExists" in options) {
    (mockFileSystem.exists as ReturnType<typeof vi.fn>).mockResolvedValue(options.fileSystemExists);
  }

  const mockResolver = createMockResolver();
  const mockGitOps = createMockGitOps({ isWorktree: options.isWorktree });
  const mockProjectsRepo = createMockProjectsRepository({
    project: "project" in options ? options.project : undefined,
    archivedProject: "archivedProject" in options ? options.archivedProject : undefined,
  });
  const mockSourceProvider = createMockSourceProvider({
    projectsRepo: mockProjectsRepo,
    tasks: options.tasks,
    issues: options.issues,
  });
  const mockDatabaseService = createMockDatabaseService({ isRemote: options.isRemote });

  // Register mocked infrastructure
  container.register({
    workingDirectory: asValue("/test/repo"),
    packageRoot: asValue("/test/cli"),
    fileSystem: asValue(mockFileSystem),
    trackDirectoryResolver: asValue(mockResolver),
    gitOps: asValue(mockGitOps),
    sourceProvider: asValue(mockSourceProvider),
    databaseService: asValue(mockDatabaseService),
    userPrompt: asValue({ ask: vi.fn(async () => "test-project") }),
  });

  // Register services that use injected dependencies
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

  // Register commands
  container.register({
    archiveCommand: asFunction(({ archiveService }) => {
      return new ArchiveCommand(archiveService as ArchiveService);
    }).scoped(),

    unarchiveCommand: asFunction(({ archiveService, gitOps, workingDirectory }) => {
      return new UnarchiveCommand(
        archiveService as ArchiveService,
        gitOps as GitOperations,
        workingDirectory as string
      );
    }).scoped(),

    nukeCommand: asFunction(
      ({ archiveService, databaseService, trackDirectoryResolver, userPrompt }) => {
        return new NukeCommand(
          archiveService as ArchiveService,
          databaseService as DatabaseConfigService,
          trackDirectoryResolver as TrackDirectoryResolver,
          userPrompt as UserPrompt
        );
      }
    ).scoped(),
  });

  return container;
}

describe("ArchiveCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("should archive an active project", async () => {
      const project = createMockProject({ isArchived: false });
      const container = setupTestContainer({ project });

      const command = container.cradle.archiveCommand;
      await command.execute();

      // Verify service called through to repository
      const sourceProvider = container.cradle.sourceProvider;
      expect(sourceProvider.getOrCreate).toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("Archiving project"));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("archived successfully"));
    });

    it("should fail when project is not initialized (database does not exist)", async () => {
      const container = setupTestContainer({ fileSystemExists: false });

      const command = container.cradle.archiveCommand;

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ dev-workflow is not initialized for this repository."
      );
    });

    it("should fail when project is already archived", async () => {
      const project = createMockProject({ isArchived: true });
      const container = setupTestContainer({ project });

      const command = container.cradle.archiveCommand;

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Project is already archived.");
    });

    it("should fail when there are in-progress tasks", async () => {
      const project = createMockProject({ isArchived: false });
      const tasks = [{ id: "task-1", status: "IN_PROGRESS" }];
      const container = setupTestContainer({ project, tasks });

      const command = container.cradle.archiveCommand;

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("Cannot archive project")
      );
    });
  });
});

describe("UnarchiveCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("should fail when running from a worktree", async () => {
      const container = setupTestContainer({ isWorktree: true });

      const command = container.cradle.unarchiveCommand;

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Cannot run unarchive from a git worktree.");
    });

    it("should fail when no archived project is found", async () => {
      // Both project and archivedProject are null
      const container = setupTestContainer({ project: null, archivedProject: null });

      const command = container.cradle.unarchiveCommand;

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ No archived project found for this repository."
      );
    });

    it("should fail when project exists but is not archived", async () => {
      const activeProject = createMockProject({ isArchived: false });
      const container = setupTestContainer({ project: activeProject, archivedProject: null });

      const command = container.cradle.unarchiveCommand;

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Project is not archived.");
    });
  });
});

describe("NukeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("should nuke project when user confirms", async () => {
      const project = createMockProject({ name: "test-project" });
      // All issues must be CLOSED for nuke validation
      const issues = [
        Issue.from({
          id: "issue-1",
          projectId: "proj-123",
          number: 1,
          title: "Test",
          description: "",
          acceptanceCriteria: [],
          type: "TASK",
          priority: "MEDIUM",
          status: "CLOSED",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        }),
      ];
      const container = setupTestContainer({ project, issues });

      const command = container.cradle.nukeCommand;
      await command.execute();

      // Verify repository hardDelete was called
      const sourceProvider = container.cradle.sourceProvider;
      const source = sourceProvider.getOrCreate({ connectionString: "/test/.track/workflow.db" });
      expect(source.projects.hardDelete).toHaveBeenCalledWith("proj-123");
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("Nuking project"));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("nuked successfully"));
    });

    it("should fail when project is not initialized", async () => {
      const container = setupTestContainer({ fileSystemExists: false });

      const command = container.cradle.nukeCommand;

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ dev-workflow is not initialized for this repository."
      );
    });

    it("should block nuke on remote database without --force", async () => {
      const project = createMockProject();
      const container = setupTestContainer({ project, isRemote: true });

      const command = container.cradle.nukeCommand;

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ Cannot nuke when using a remote database.\n"
      );
    });

    it("should allow nuke on remote database with --force", async () => {
      const project = createMockProject({ name: "test-project" });
      const issues = [
        Issue.from({
          id: "issue-1",
          projectId: "proj-123",
          number: 1,
          title: "Test",
          description: "",
          acceptanceCriteria: [],
          type: "TASK",
          priority: "MEDIUM",
          status: "CLOSED",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        }),
      ];
      const container = setupTestContainer({ project, isRemote: true, issues });

      const command = container.cradle.nukeCommand;
      await command.execute({ force: true });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        "⚠️  --force flag detected. Proceeding with LOCAL cleanup only."
      );
      const sourceProvider = container.cradle.sourceProvider;
      const source = sourceProvider.getOrCreate({ connectionString: "/test/.track/workflow.db" });
      expect(source.projects.hardDelete).toHaveBeenCalled();
    });

    it("should fail when there are open issues", async () => {
      const project = createMockProject();
      // OPEN issue will block nuke
      const issues = [
        Issue.from({
          id: "issue-1",
          projectId: "proj-123",
          number: 1,
          title: "Test",
          description: "",
          acceptanceCriteria: [],
          type: "TASK",
          priority: "MEDIUM",
          status: "OPEN",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        }),
      ];
      const container = setupTestContainer({ project, issues });

      const command = container.cradle.nukeCommand;

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining("Cannot nuke project"));
    });
  });
});
