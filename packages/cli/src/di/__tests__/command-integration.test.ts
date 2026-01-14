/**
 * Command Integration Tests
 *
 * Tests each CLI command using the DI pattern:
 * 1. Create test container with mocked services
 * 2. Use createTestCliCommand to bind handler to test container
 * 3. Execute command and verify mocked service was called correctly
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { asValue } from "awilix";

// Mock @dev-workflow/core to prevent middleware from detecting worktree
vi.mock("@dev-workflow/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dev-workflow/core")>();
  return {
    ...actual,
    resolveConfigFromGit: vi.fn().mockResolvedValue({
      gitRoot: "/test/repo",
      slug: "test-project",
      database: "sqlite:///test/.track/workflow.db",
    }),
    createTrackDirectoryResolver: vi.fn().mockReturnValue({
      trackDirectory: "/test/.track",
      globalDbPath: "/test/.track/workflow.db",
      workerQueueDbPath: "/test/.track/workers.db",
      workingDirectory: "/test/repo",
      resolve: vi.fn().mockReturnValue("/test/.track/workflow.db"),
    }),
    TrackDirectoryResolver: vi.fn().mockImplementation(() => ({
      trackDirectory: "/test/.track",
      globalDbPath: "/test/.track/workflow.db",
      workerQueueDbPath: "/test/.track/workers.db",
      workingDirectory: "/test/repo",
      resolve: vi.fn().mockReturnValue("/test/.track/workflow.db"),
    })),
  };
});
import { createCliContainer } from "../container.js";
import { createTestCliCommand } from "../bootstrap.js";

// Import handlers from command definition files
import { handleArchive, handleUnarchive, handleNuke } from "../../commands/archive-command-def.js";
import { handleUpdate } from "../../commands/update-command-def.js";
import { handleUninit } from "../../commands/uninit-command-def.js";
import { handleInit } from "../../commands/init-command-def.js";
import { handleUI, handleUIInstall, handleUIUninstall } from "../../commands/ui-command-def.js";
import { handleWorkers, handleClaudeWorker } from "../../commands/worker-command-def.js";
import { handleMCP } from "../../commands/mcp-command-def.js";
import {
  handleBackupCreate,
  handleBackupConfigure,
  handleBackupStatus,
  handleBackupList,
  handleBackupUnconfigure,
  handleRestore,
} from "../../commands/backup-command-def.js";
import {
  handleDatabaseConfigure,
  handleDatabaseStatus,
} from "../../commands/database-command-def.js";
import { handleCleanClaudeConfig } from "../../commands/claude-config-command-def.js";

// Import types for mocking
import type {
  ArchiveCommand,
  UnarchiveCommand,
  NukeCommand,
} from "../../commands/archive-command.js";
import type { UpdateCommand } from "../../commands/update-command.js";
import type { UninitCommand } from "../../commands/uninit-command.js";
import type { InitCommand } from "../../commands/init-command.js";
import type { UICommand } from "../../commands/ui-command.js";
import type { WorkerCommand } from "../../commands/worker-command.js";
import type { MCPCommand } from "../../commands/mcp-command.js";
import type { BackupCommand } from "../../commands/backup-command.js";
import type { DatabaseCommand } from "../../commands/database-command.js";
import type { ClaudeConfigCommand } from "../../commands/claude-config-command.js";
import type { TrackDirectoryResolver, ProjectConfig } from "@dev-workflow/core";

// =============================================================================
// Test Container Setup
// =============================================================================

function createTestContainer() {
  const container = createCliContainer();

  // Register runtime values that middleware would normally provide
  const mockResolver = {
    trackDirectory: "/test/.track",
    globalDbPath: "/test/.track/workflow.db",
    workerQueueDbPath: "/test/.track/workers.db",
    workingDirectory: "/test/repo",
    resolve: vi.fn().mockReturnValue("/test/.track/workflow.db"),
  };

  container.register({
    workingDirectory: asValue("/test/repo"),
    packageRoot: asValue("/test/cli"),
    cliRoot: asValue("/test/cli"),
    cliPath: asValue("/test/cli/dist/index.js"),
    trackDirectoryResolver: asValue(mockResolver as unknown as TrackDirectoryResolver),
    databaseConnectionString: asValue("sqlite:///test/.track/workflow.db"),
    config: asValue({
      slug: "test-project",
      connectionString: "sqlite:///test/.track/workflow.db",
    } as unknown as ProjectConfig),
  });

  return container;
}

// =============================================================================
// Archive Commands
// =============================================================================

describe("ArchiveCommand", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should call archiveService.archive when executed", async () => {
    container = createTestContainer();

    const mockArchiveCommand = {
      execute: vi.fn().mockResolvedValue(undefined),
    };

    container.register({
      archiveCommand: asValue(mockArchiveCommand as unknown as ArchiveCommand),
    });

    const runArchive = createTestCliCommand(handleArchive, container);
    await runArchive({});

    expect(mockArchiveCommand.execute).toHaveBeenCalled();
  });
});

describe("UnarchiveCommand", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should call unarchiveCommand.execute when executed", async () => {
    container = createTestContainer();

    const mockUnarchiveCommand = {
      execute: vi.fn().mockResolvedValue(undefined),
    };

    container.register({
      unarchiveCommand: asValue(mockUnarchiveCommand as unknown as UnarchiveCommand),
    });

    const runUnarchive = createTestCliCommand(handleUnarchive, container);
    await runUnarchive({});

    expect(mockUnarchiveCommand.execute).toHaveBeenCalled();
  });
});

describe("NukeCommand", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should call nukeCommand.execute with options when executed", async () => {
    container = createTestContainer();

    const mockNukeCommand = {
      execute: vi.fn().mockResolvedValue(undefined),
    };

    container.register({
      nukeCommand: asValue(mockNukeCommand as unknown as NukeCommand),
    });

    const runNuke = createTestCliCommand(handleNuke, container);
    await runNuke({ force: true });

    expect(mockNukeCommand.execute).toHaveBeenCalledWith({ force: true });
  });
});

// =============================================================================
// Update Command
// =============================================================================

describe("UpdateCommand", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should call updateCommand.execute when executed", async () => {
    container = createTestContainer();

    const mockUpdateCommand = {
      execute: vi.fn().mockResolvedValue(undefined),
    };

    container.register({
      updateCommand: asValue(mockUpdateCommand as unknown as UpdateCommand),
    });

    const runUpdate = createTestCliCommand(handleUpdate, container);
    await runUpdate({});

    expect(mockUpdateCommand.execute).toHaveBeenCalled();
  });
});

// =============================================================================
// Uninit Command
// =============================================================================

describe("UninitCommand", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should call uninitCommand.execute when executed", async () => {
    container = createTestContainer();

    const mockUninitCommand = {
      execute: vi.fn().mockResolvedValue(undefined),
    };

    container.register({
      uninitCommand: asValue(mockUninitCommand as unknown as UninitCommand),
    });

    const runUninit = createTestCliCommand(handleUninit, container);
    await runUninit({});

    expect(mockUninitCommand.execute).toHaveBeenCalled();
  });
});

// =============================================================================
// Init Command
// =============================================================================

describe("InitCommand", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should call initCommand.execute with options when executed", async () => {
    container = createTestContainer();

    const mockInitCommand = {
      execute: vi.fn().mockResolvedValue(undefined),
    };

    container.register({
      initCommand: asValue(mockInitCommand as unknown as InitCommand),
    });

    const runInit = createTestCliCommand(handleInit, container);
    await runInit({ local: true });

    expect(mockInitCommand.execute).toHaveBeenCalledWith({ local: true });
  });
});

// =============================================================================
// UI Commands
// =============================================================================

describe("UICommand", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should call uiCommand.start when ui command executed", async () => {
    container = createTestContainer();

    const mockUICommand = {
      start: vi.fn().mockResolvedValue(undefined),
      install: vi.fn(),
      uninstall: vi.fn(),
    };

    container.register({
      uiCommand: asValue(mockUICommand as unknown as UICommand),
    });

    const runUI = createTestCliCommand(handleUI, container);
    await runUI({});

    expect(mockUICommand.start).toHaveBeenCalled();
  });

  it("should call uiCommand.install when ui:install command executed", async () => {
    container = createTestContainer();

    const mockUICommand = {
      start: vi.fn(),
      install: vi.fn().mockResolvedValue(undefined),
      uninstall: vi.fn(),
    };

    container.register({
      uiCommand: asValue(mockUICommand as unknown as UICommand),
    });

    const runUIInstall = createTestCliCommand(handleUIInstall, container);
    await runUIInstall({});

    expect(mockUICommand.install).toHaveBeenCalled();
  });

  it("should call uiCommand.uninstall when ui:uninstall command executed", async () => {
    container = createTestContainer();

    const mockUICommand = {
      start: vi.fn(),
      install: vi.fn(),
      uninstall: vi.fn().mockResolvedValue(undefined),
    };

    container.register({
      uiCommand: asValue(mockUICommand as unknown as UICommand),
    });

    const runUIUninstall = createTestCliCommand(handleUIUninstall, container);
    await runUIUninstall({});

    expect(mockUICommand.uninstall).toHaveBeenCalled();
  });
});

// =============================================================================
// Worker Commands
// =============================================================================

describe("WorkerCommand", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should call workerCommand.list when workers command executed", async () => {
    container = createTestContainer();

    const mockWorkerCommand = {
      list: vi.fn().mockResolvedValue(undefined),
      start: vi.fn(),
    };

    container.register({
      workerCommand: asValue(mockWorkerCommand as unknown as WorkerCommand),
    });

    const runWorkers = createTestCliCommand(handleWorkers, container);
    await runWorkers({});

    expect(mockWorkerCommand.list).toHaveBeenCalled();
  });

  it("should call workerCommand.start with options when claude command executed", async () => {
    container = createTestContainer();

    const mockWorkerCommand = {
      list: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
    };

    container.register({
      workerCommand: asValue(mockWorkerCommand as unknown as WorkerCommand),
    });

    const runClaudeWorker = createTestCliCommand(handleClaudeWorker, container);
    await runClaudeWorker({ name: "worker-1", autoClaim: true });

    expect(mockWorkerCommand.start).toHaveBeenCalledWith({ name: "worker-1", autoClaim: true });
  });
});

// =============================================================================
// MCP Command
// =============================================================================

describe("MCPCommand", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should call mcpCommand.execute when executed", async () => {
    container = createTestContainer();

    const mockMCPCommand = {
      execute: vi.fn(),
    };

    container.register({
      mcpCommand: asValue(mockMCPCommand as unknown as MCPCommand),
    });

    const runMCP = createTestCliCommand(handleMCP, container);
    await runMCP({});

    expect(mockMCPCommand.execute).toHaveBeenCalled();
  });
});

// =============================================================================
// Backup Commands
// =============================================================================

describe("BackupCommand", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should call backupCommand.create when backup create executed", async () => {
    container = createTestContainer();

    const mockBackupCommand = {
      create: vi.fn().mockResolvedValue(undefined),
      configure: vi.fn(),
      setup: vi.fn(),
      status: vi.fn(),
      list: vi.fn(),
      unconfigure: vi.fn(),
      restore: vi.fn(),
    };

    container.register({
      backupCommand: asValue(mockBackupCommand as unknown as BackupCommand),
    });

    const runBackupCreate = createTestCliCommand(handleBackupCreate, container);
    await runBackupCreate({});

    expect(mockBackupCommand.create).toHaveBeenCalled();
  });

  it("should call backupCommand.configure with options when backup configure executed", async () => {
    container = createTestContainer();

    const mockBackupCommand = {
      create: vi.fn(),
      configure: vi.fn().mockResolvedValue(undefined),
      setup: vi.fn(),
      status: vi.fn(),
      list: vi.fn(),
      unconfigure: vi.fn(),
      restore: vi.fn(),
    };

    container.register({
      backupCommand: asValue(mockBackupCommand as unknown as BackupCommand),
    });

    const runBackupConfigure = createTestCliCommand(handleBackupConfigure, container);
    await runBackupConfigure({ bucket: "my-bucket", region: "us-east-1" });

    expect(mockBackupCommand.configure).toHaveBeenCalledWith({
      bucket: "my-bucket",
      region: "us-east-1",
    });
  });

  it("should call backupCommand.status when backup status executed", async () => {
    container = createTestContainer();

    const mockBackupCommand = {
      create: vi.fn(),
      configure: vi.fn(),
      setup: vi.fn(),
      status: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
      unconfigure: vi.fn(),
      restore: vi.fn(),
    };

    container.register({
      backupCommand: asValue(mockBackupCommand as unknown as BackupCommand),
    });

    const runBackupStatus = createTestCliCommand(handleBackupStatus, container);
    await runBackupStatus({});

    expect(mockBackupCommand.status).toHaveBeenCalled();
  });

  it("should call backupCommand.list when backup list executed", async () => {
    container = createTestContainer();

    const mockBackupCommand = {
      create: vi.fn(),
      configure: vi.fn(),
      setup: vi.fn(),
      status: vi.fn(),
      list: vi.fn().mockResolvedValue(undefined),
      unconfigure: vi.fn(),
      restore: vi.fn(),
    };

    container.register({
      backupCommand: asValue(mockBackupCommand as unknown as BackupCommand),
    });

    const runBackupList = createTestCliCommand(handleBackupList, container);
    await runBackupList({});

    expect(mockBackupCommand.list).toHaveBeenCalled();
  });

  it("should call backupCommand.unconfigure when backup unconfigure executed", async () => {
    container = createTestContainer();

    const mockBackupCommand = {
      create: vi.fn(),
      configure: vi.fn(),
      setup: vi.fn(),
      status: vi.fn(),
      list: vi.fn(),
      unconfigure: vi.fn().mockResolvedValue(undefined),
      restore: vi.fn(),
    };

    container.register({
      backupCommand: asValue(mockBackupCommand as unknown as BackupCommand),
    });

    const runBackupUnconfigure = createTestCliCommand(handleBackupUnconfigure, container);
    await runBackupUnconfigure({});

    expect(mockBackupCommand.unconfigure).toHaveBeenCalled();
  });

  it("should call backupCommand.restore with options when restore executed", async () => {
    container = createTestContainer();

    const mockBackupCommand = {
      create: vi.fn(),
      configure: vi.fn(),
      setup: vi.fn(),
      status: vi.fn(),
      list: vi.fn(),
      unconfigure: vi.fn(),
      restore: vi.fn().mockResolvedValue(undefined),
    };

    container.register({
      backupCommand: asValue(mockBackupCommand as unknown as BackupCommand),
    });

    const runRestore = createTestCliCommand(handleRestore, container);
    await runRestore({ backup: "backup-123", yes: true });

    expect(mockBackupCommand.restore).toHaveBeenCalledWith("backup-123", {
      backup: "backup-123",
      yes: true,
    });
  });
});

// =============================================================================
// Database Commands
// =============================================================================

describe("DatabaseCommand", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should call databaseCommand.configure with options when database configure executed", async () => {
    container = createTestContainer();

    const mockDatabaseCommand = {
      configure: vi.fn().mockResolvedValue(undefined),
      status: vi.fn(),
    };

    container.register({
      databaseCommand: asValue(mockDatabaseCommand as unknown as DatabaseCommand),
    });

    const runDatabaseConfigure = createTestCliCommand(handleDatabaseConfigure, container);
    await runDatabaseConfigure({ url: "postgresql://localhost/db" });

    expect(mockDatabaseCommand.configure).toHaveBeenCalledWith({
      url: "postgresql://localhost/db",
    });
  });

  it("should call databaseCommand.status when database status executed", async () => {
    container = createTestContainer();

    const mockDatabaseCommand = {
      configure: vi.fn(),
      status: vi.fn().mockResolvedValue(undefined),
    };

    container.register({
      databaseCommand: asValue(mockDatabaseCommand as unknown as DatabaseCommand),
    });

    const runDatabaseStatus = createTestCliCommand(handleDatabaseStatus, container);
    await runDatabaseStatus({});

    expect(mockDatabaseCommand.status).toHaveBeenCalled();
  });
});

// =============================================================================
// Claude Config Command
// =============================================================================

describe("ClaudeConfigCommand", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should call claudeConfigCommand.clean with options when clean-claude-config executed", async () => {
    container = createTestContainer();

    const mockClaudeConfigCommand = {
      clean: vi.fn().mockResolvedValue(undefined),
    };

    container.register({
      claudeConfigCommand: asValue(mockClaudeConfigCommand as unknown as ClaudeConfigCommand),
    });

    const runCleanClaudeConfig = createTestCliCommand(handleCleanClaudeConfig, container);
    await runCleanClaudeConfig({ dryRun: true });

    expect(mockClaudeConfigCommand.clean).toHaveBeenCalledWith({ dryRun: true });
  });
});
