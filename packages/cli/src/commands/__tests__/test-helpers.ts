/**
 * Shared test helpers for command integration tests.
 */

import { vi } from "vitest";
import { asValue } from "awilix";
import { createCliContainer } from "../../di/container.js";
import type { TrackDirectoryResolver, ProjectConfig } from "@dev-workflow/core";

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

/**
 * Creates a test container with mocked runtime values.
 */
export function createTestContainer() {
  const container = createCliContainer();

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
