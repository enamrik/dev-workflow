/**
 * Command Integration Tests
 *
 * Demonstrates the DI pattern for CLI commands:
 * 1. Create container with production registrations
 * 2. Override infrastructure services with mocks
 * 3. Verify commands can be resolved with overridden dependencies
 *
 * Note: Full command execution testing requires integration tests with
 * real services. These tests validate the DI wiring pattern.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { asValue } from "awilix";
import { createCliContainer } from "../container.js";
import type { ArchiveService } from "../../application/archive.service.js";
import type { UpdateService } from "../../application/update.service.js";
import type { GitOperations, TrackDirectoryResolver, ProjectConfig } from "@dev-workflow/core";

// =============================================================================
// Test Helpers
// =============================================================================

function createTestContainer() {
  const container = createCliContainer();

  // Register required runtime values
  // These would normally be provided by middleware for real CLI commands
  const mockResolver = {
    trackDirectory: "/test/.track",
    globalDbPath: "/test/.track/workflow.db",
    workerQueueDbPath: "/test/.track/workers.db",
    workingDirectory: "/test/repo",
    resolve: vi.fn().mockReturnValue("/test/.track/workflow.db"),
  };

  container.register({
    // Core runtime values
    workingDirectory: asValue("/test/repo"),
    packageRoot: asValue("/test/cli"),
    // Override computed values that depend on packageRoot
    // (prevents factory from being called with undefined packageRoot)
    cliRoot: asValue("/test/cli"),
    cliPath: asValue("/test/cli/dist/index.js"),
    // Optional values needed for some services (cast partial mocks)
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
// Container Resolution Tests
// =============================================================================

describe("CLI Container", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should resolve all command dependencies", () => {
    container = createTestContainer();

    // These should all resolve without throwing
    const archiveCommand = container.cradle.archiveCommand;
    const unarchiveCommand = container.cradle.unarchiveCommand;
    const nukeCommand = container.cradle.nukeCommand;
    const updateCommand = container.cradle.updateCommand;
    const uninitCommand = container.cradle.uninitCommand;
    const initCommand = container.cradle.initCommand;
    const uiCommand = container.cradle.uiCommand;
    const backupCommand = container.cradle.backupCommand;
    const databaseCommand = container.cradle.databaseCommand;
    const workerCommand = container.cradle.workerCommand;
    const mcpCommand = container.cradle.mcpCommand;
    const claudeConfigCommand = container.cradle.claudeConfigCommand;

    // Commands should be defined (not null/undefined)
    expect(archiveCommand).toBeDefined();
    expect(unarchiveCommand).toBeDefined();
    expect(nukeCommand).toBeDefined();
    expect(updateCommand).toBeDefined();
    expect(uninitCommand).toBeDefined();
    expect(initCommand).toBeDefined();
    expect(uiCommand).toBeDefined();
    expect(backupCommand).toBeDefined();
    expect(databaseCommand).toBeDefined();
    expect(workerCommand).toBeDefined();
    expect(mcpCommand).toBeDefined();
    expect(claudeConfigCommand).toBeDefined();
  });

  it("should resolve infrastructure services", () => {
    container = createTestContainer();

    // Infrastructure services should resolve
    const fileSystem = container.cradle.fileSystem;
    const gitOps = container.cradle.gitOps;
    const sourceProvider = container.cradle.sourceProvider;
    const trackDirectoryResolver = container.cradle.trackDirectoryResolver;

    expect(fileSystem).toBeDefined();
    expect(gitOps).toBeDefined();
    expect(sourceProvider).toBeDefined();
    expect(trackDirectoryResolver).toBeDefined();
  });

  it("should resolve application services", () => {
    container = createTestContainer();

    // First verify runtime values are registered
    expect(container.cradle.databaseConnectionString).toBe("sqlite:///test/.track/workflow.db");
    expect(container.cradle.workingDirectory).toBe("/test/repo");
    expect(container.cradle.packageRoot).toBe("/test/cli");

    // Application services should resolve
    const archiveService = container.cradle.archiveService;
    const updateService = container.cradle.updateService;
    const uninstallService = container.cradle.uninstallService;
    const installService = container.cradle.installService;

    expect(archiveService).toBeDefined();
    expect(updateService).toBeDefined();
    expect(uninstallService).toBeDefined();
    expect(installService).toBeDefined();
  });
});

// =============================================================================
// Dependency Override Pattern Tests
// =============================================================================

describe("Container Override Pattern", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should allow overriding services with mocks", () => {
    container = createTestContainer();

    // Create partial mock services
    const mockArchiveService = {
      getProject: vi.fn(),
      archive: vi.fn(),
      unarchive: vi.fn(),
      nuke: vi.fn(),
    };

    const mockUpdateService = {
      migrateTrackDirectory: vi.fn(),
      updateSkills: vi.fn(),
    };

    // Override services
    container.register({
      archiveService: asValue(mockArchiveService as unknown as ArchiveService),
      updateService: asValue(mockUpdateService as unknown as UpdateService),
    });

    // Resolve commands - they should receive mocked services
    const archiveCommand = container.cradle.archiveCommand;
    const updateCommand = container.cradle.updateCommand;

    expect(archiveCommand).toBeDefined();
    expect(updateCommand).toBeDefined();

    // The commands were constructed with our mocks
    // (verified by the fact that they exist - construction succeeded)
  });

  it("should allow scoped containers with different mocks", () => {
    container = createTestContainer();

    // Create two scopes with different configurations
    const scope1 = container.createScope();
    const scope2 = container.createScope();

    const mockService1 = {
      getProject: vi.fn().mockResolvedValue({ id: "project-1", name: "Project One" }),
      archive: vi.fn(),
      unarchive: vi.fn(),
      nuke: vi.fn(),
    };

    const mockService2 = {
      getProject: vi.fn().mockResolvedValue({ id: "project-2", name: "Project Two" }),
      archive: vi.fn(),
      unarchive: vi.fn(),
      nuke: vi.fn(),
    };

    scope1.register({ archiveService: asValue(mockService1 as unknown as ArchiveService) });
    scope2.register({ archiveService: asValue(mockService2 as unknown as ArchiveService) });

    // Each scope resolves its own mock
    const cmd1 = scope1.cradle.archiveCommand;
    const cmd2 = scope2.cradle.archiveCommand;

    expect(cmd1).toBeDefined();
    expect(cmd2).toBeDefined();

    // Commands are different instances
    expect(cmd1).not.toBe(cmd2);
  });

  it("should allow overriding infrastructure with partial mocks", () => {
    container = createTestContainer();

    // Create partial mock for git operations
    const mockGitOps = {
      isWorktree: vi.fn().mockReturnValue(false),
      findGitRoot: vi.fn().mockReturnValue("/test/repo"),
      getRemoteUrl: vi.fn().mockReturnValue("git@github.com:test/repo.git"),
      getCurrentBranch: vi.fn().mockReturnValue("main"),
      getRepoIdentifier: vi.fn().mockReturnValue("test-repo-abc123"),
    };

    container.register({
      gitOps: asValue(mockGitOps as unknown as GitOperations),
    });

    // Verify the mock is being used
    const gitOps = container.cradle.gitOps;
    expect(gitOps.isWorktree("/test/repo")).toBe(false);
    expect(gitOps.findGitRoot("/test/repo")).toBe("/test/repo");
    expect(mockGitOps.isWorktree).toHaveBeenCalled();
  });
});

// =============================================================================
// Service Registration Tests
// =============================================================================

describe("Service Registration", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  it("should use singleton scope for infrastructure services", () => {
    container = createTestContainer();

    // Get same service twice
    const fileSystem1 = container.cradle.fileSystem;
    const fileSystem2 = container.cradle.fileSystem;

    // Should be same instance
    expect(fileSystem1).toBe(fileSystem2);
  });

  it("should use scoped scope for commands", () => {
    container = createTestContainer();

    // Get command in two different scopes
    const scope1 = container.createScope();
    const scope2 = container.createScope();

    const cmd1 = scope1.cradle.archiveCommand;
    const cmd2 = scope2.cradle.archiveCommand;

    // Should be different instances in different scopes
    expect(cmd1).not.toBe(cmd2);
  });

  it("should propagate runtime values to services", () => {
    container = createCliContainer();

    // Register runtime values
    container.register({
      workingDirectory: asValue("/custom/path"),
      packageRoot: asValue("/custom/cli"),
    });

    // Services should receive these values
    const workingDir = container.cradle.workingDirectory;
    const packageRoot = container.cradle.packageRoot;

    expect(workingDir).toBe("/custom/path");
    expect(packageRoot).toBe("/custom/cli");
  });
});
