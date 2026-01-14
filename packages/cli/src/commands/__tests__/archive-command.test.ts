/**
 * ArchiveCommand, UnarchiveCommand, NukeCommand Behavioral Tests
 *
 * Tests actual behavior:
 * - Archive marks project as archived, removes skills, unregisters MCP
 * - Unarchive restores project and reinstalls Claude integration
 * - Nuke permanently deletes project data
 * - Error cases are handled correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { ArchiveCommand, UnarchiveCommand, NukeCommand } from "../archive-command.js";
import type { ArchiveService } from "../../application/archive.service.js";
import type { DatabaseConfigService } from "../../application/database.service.js";
import type { TrackDirectoryResolver, GitOperations, Project } from "@dev-workflow/core";

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

// Mock readline for nuke confirmation
vi.mock("node:readline", () => ({
  createInterface: vi.fn().mockReturnValue({
    question: vi.fn((_prompt, callback) => callback("test-project")),
    close: vi.fn(),
  }),
}));

/**
 * Create a mock project
 */
function createMockProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-123",
    name: "test-project",
    gitHash: "abc123",
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Project;
}

/**
 * Create a mock ArchiveService
 */
function createMockArchiveService(
  options: {
    project?: Project | null;
    archivedProject?: Project | null;
  } = {}
): ArchiveService {
  // Use 'in' check to distinguish between "not passed" and "passed as null"
  const projectValue = "project" in options ? options.project : createMockProject();
  const archivedValue = "archivedProject" in options ? options.archivedProject : null;

  return {
    getProject: vi.fn().mockResolvedValue(projectValue),
    findArchivedProjectByGitHash: vi.fn().mockResolvedValue(archivedValue),
    archive: vi.fn().mockResolvedValue(undefined),
    unarchive: vi.fn().mockResolvedValue(undefined),
    nuke: vi.fn().mockResolvedValue(undefined),
  } as unknown as ArchiveService;
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
      const archiveService = createMockArchiveService({ project });

      const command = new ArchiveCommand(archiveService);
      await command.execute();

      expect(archiveService.archive).toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith("📦 Archiving project...");
      expect(mockConsoleLog).toHaveBeenCalledWith("\n✨ Project archived successfully!");
    });

    it("should fail when project is not initialized", async () => {
      const archiveService = createMockArchiveService({ project: null });

      const command = new ArchiveCommand(archiveService);

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ dev-workflow is not initialized for this repository."
      );
      expect(archiveService.archive).not.toHaveBeenCalled();
    });

    it("should fail when project is already archived", async () => {
      const project = createMockProject({ isArchived: true });
      const archiveService = createMockArchiveService({ project });

      const command = new ArchiveCommand(archiveService);

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Project is already archived.");
      expect(archiveService.archive).not.toHaveBeenCalled();
    });
  });
});

describe("UnarchiveCommand", () => {
  let gitOps: GitOperations;

  beforeEach(() => {
    vi.clearAllMocks();
    gitOps = {
      isWorktree: vi.fn().mockReturnValue(false),
    } as unknown as GitOperations;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("should unarchive an archived project", async () => {
      const archivedProject = createMockProject({ isArchived: true });
      const archiveService = createMockArchiveService({ archivedProject });

      const command = new UnarchiveCommand(archiveService, gitOps, "/test/repo");
      await command.execute();

      expect(archiveService.unarchive).toHaveBeenCalledWith(archivedProject);
      expect(mockConsoleLog).toHaveBeenCalledWith("📦 Unarchiving project...");
      expect(mockConsoleLog).toHaveBeenCalledWith("\n✨ Project unarchived successfully!");
    });

    it("should fail when running from a worktree", async () => {
      gitOps = {
        isWorktree: vi.fn().mockReturnValue(true),
      } as unknown as GitOperations;

      const archiveService = createMockArchiveService();
      const command = new UnarchiveCommand(archiveService, gitOps, "/test/repo");

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Cannot run unarchive from a git worktree.");
      expect(archiveService.unarchive).not.toHaveBeenCalled();
    });

    it("should fail when no archived project is found", async () => {
      const archiveService = createMockArchiveService({
        archivedProject: null,
        project: null,
      });

      const command = new UnarchiveCommand(archiveService, gitOps, "/test/repo");

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ No archived project found for this repository."
      );
    });

    it("should fail when project exists but is not archived", async () => {
      const activeProject = createMockProject({ isArchived: false });
      const archiveService = createMockArchiveService({
        archivedProject: null,
        project: activeProject,
      });

      const command = new UnarchiveCommand(archiveService, gitOps, "/test/repo");

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Project is not archived.");
    });
  });
});

describe("NukeCommand", () => {
  let archiveService: ArchiveService;
  let databaseService: DatabaseConfigService;
  let trackDirectoryResolver: TrackDirectoryResolver;

  beforeEach(() => {
    vi.clearAllMocks();

    databaseService = {
      isRemote: vi.fn().mockResolvedValue(false),
      getStatus: vi.fn().mockResolvedValue({
        provider: "sqlite",
        connectionString: "sqlite:///test/.track/workflow.db",
      }),
    } as unknown as DatabaseConfigService;

    trackDirectoryResolver = {
      getTrackDirectory: vi.fn().mockReturnValue("/test/.track"),
    } as unknown as TrackDirectoryResolver;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("should nuke project when user confirms", async () => {
      const project = createMockProject({ name: "test-project" });
      archiveService = createMockArchiveService({ project });

      const command = new NukeCommand(archiveService, databaseService, trackDirectoryResolver);
      await command.execute();

      expect(archiveService.nuke).toHaveBeenCalledWith(project);
      expect(mockConsoleLog).toHaveBeenCalledWith("\n💣 Nuking project...");
      expect(mockConsoleLog).toHaveBeenCalledWith("\n✨ Project nuked successfully!");
    });

    it("should fail when project is not initialized", async () => {
      archiveService = createMockArchiveService({ project: null });

      const command = new NukeCommand(archiveService, databaseService, trackDirectoryResolver);

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ dev-workflow is not initialized for this repository."
      );
      expect(archiveService.nuke).not.toHaveBeenCalled();
    });

    it("should block nuke on remote database without --force", async () => {
      const project = createMockProject();
      archiveService = createMockArchiveService({ project });

      databaseService = {
        isRemote: vi.fn().mockResolvedValue(true),
        getStatus: vi.fn().mockResolvedValue({
          provider: "neon",
          connectionString: "postgresql://user:pass@host/db",
        }),
      } as unknown as DatabaseConfigService;

      const command = new NukeCommand(archiveService, databaseService, trackDirectoryResolver);

      await expect(command.execute()).rejects.toThrow("process.exit(1)");
      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ Cannot nuke when using a remote database.\n"
      );
      expect(archiveService.nuke).not.toHaveBeenCalled();
    });

    it("should allow nuke on remote database with --force", async () => {
      const project = createMockProject({ name: "test-project" });
      archiveService = createMockArchiveService({ project });

      databaseService = {
        isRemote: vi.fn().mockResolvedValue(true),
        getStatus: vi.fn().mockResolvedValue({
          provider: "neon",
          connectionString: "postgresql://user:pass@host/db",
        }),
      } as unknown as DatabaseConfigService;

      const command = new NukeCommand(archiveService, databaseService, trackDirectoryResolver);
      await command.execute({ force: true });

      expect(archiveService.nuke).toHaveBeenCalledWith(project);
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "⚠️  --force flag detected. Proceeding with LOCAL cleanup only."
      );
    });
  });
});
