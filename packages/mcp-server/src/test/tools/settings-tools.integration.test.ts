/**
 * Settings Tools Integration Tests
 *
 * Tests settings-related MCP tool handlers with real database operations.
 * Focuses on column mapping configuration functionality.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import {
  MockGitHubCLI,
  SqliteProjectRepository,
  DEFAULT_COLUMN_MAPPING,
  ProviderRegistry,
  type Project,
} from "@dev-workflow/core";
import { handleUpdateSettings, type SettingsToolContext } from "../../tools/settings-tools.js";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@dev-workflow/core/schema";

type DbType = BetterSQLite3Database<typeof schema>;
const TEST_GIT_ROOT_HASH = "abc123def456";
const TEST_GIT_ROOT = "/test/repo";

/**
 * Create a SettingsToolContext for testing
 */
function createSettingsToolContext(
  testDb: TestDatabase,
  mockGitHubCLI?: MockGitHubCLI,
  project?: Project
): SettingsToolContext {
  const db = testDb.db as DbType;
  const projectRepository = new SqliteProjectRepository(db);
  const githubCLI = mockGitHubCLI ?? new MockGitHubCLI();

  // Create project if not provided
  const testProject =
    project ??
    projectRepository.create({
      name: "test-project",
      gitRootHash: TEST_GIT_ROOT_HASH,
      gitRoot: TEST_GIT_ROOT,
    });

  return {
    project: testProject,
    projectRepository,
    githubCLI,
    gitRoot: TEST_GIT_ROOT,
    providerRegistry: ProviderRegistry.getInstance(),
  };
}

describe("update_settings - configure_column_mapping", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  describe("when GitHub sync is not enabled", () => {
    it("should return error when trying to configure column mapping", async () => {
      // Arrange
      const ctx = createSettingsToolContext(testDb);

      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: { IN_PROGRESS: "Working" },
        },
      });

      // Assert
      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("GitHub issue sync is not enabled");
    });
  });

  describe("when GitHub sync is enabled", () => {
    let ctx: SettingsToolContext;

    beforeEach(async () => {
      ctx = createSettingsToolContext(testDb);

      // Enable GitHub sync first
      await handleUpdateSettings(ctx, {
        action: "enable_github",
      });
    });

    it("should return current mapping when no changes provided", async () => {
      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.message).toBe("Current column mapping");
      expect(content.columnMapping).toEqual(DEFAULT_COLUMN_MAPPING);
      expect(content.isDefault).toBe(true);
    });

    it("should update single column mapping", async () => {
      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: { PR_REVIEW: "Code Review" },
        },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.message).toBe("Column mapping updated");
      expect(content.isDefault).toBe(false);

      // Effective mapping should have the update
      expect(content.columnMapping.PR_REVIEW).toBe("Code Review");
      // Other values should remain default
      expect(content.columnMapping.IN_PROGRESS).toBe("In Progress");
      expect(content.columnMapping.BACKLOG).toBe("Backlog");

      // Custom mapping should only contain the override
      expect(content.customMapping).toEqual({ PR_REVIEW: "Code Review" });
    });

    it("should update multiple column mappings", async () => {
      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: {
            BACKLOG: "To Do",
            READY: "Up Next",
            IN_PROGRESS: "Working On",
            PR_REVIEW: "In Code Review",
            COMPLETED: "Finished",
            ABANDONED: "Cancelled",
          },
        },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.columnMapping.BACKLOG).toBe("To Do");
      expect(content.columnMapping.READY).toBe("Up Next");
      expect(content.columnMapping.IN_PROGRESS).toBe("Working On");
      expect(content.columnMapping.PR_REVIEW).toBe("In Code Review");
      expect(content.columnMapping.COMPLETED).toBe("Finished");
      expect(content.columnMapping.ABANDONED).toBe("Cancelled");
    });

    it("should merge with existing custom mapping", async () => {
      // Arrange - first set one mapping
      await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: { PR_REVIEW: "Code Review" },
        },
      });

      // Act - update a different mapping
      const result = await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: { IN_PROGRESS: "Active" },
        },
      });

      // Assert - both mappings should be preserved
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.customMapping).toEqual({
        PR_REVIEW: "Code Review",
        IN_PROGRESS: "Active",
      });
      expect(content.columnMapping.PR_REVIEW).toBe("Code Review");
      expect(content.columnMapping.IN_PROGRESS).toBe("Active");
    });

    it("should reset column mapping to defaults", async () => {
      // Arrange - first set some custom mappings
      await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: {
            PR_REVIEW: "Code Review",
            IN_PROGRESS: "Active",
          },
        },
      });

      // Act - reset to defaults
      const result = await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        resetColumnMapping: true,
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.message).toBe("Column mapping reset to defaults");
      expect(content.columnMapping).toEqual(DEFAULT_COLUMN_MAPPING);
      expect(content.isDefault).toBe(true);
    });

    it("should persist column mapping in database", async () => {
      // Act
      await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: { PR_REVIEW: "Review" },
        },
      });

      // Assert - verify persisted in database
      const project = ctx.projectRepository.findById(ctx.project.id);
      expect(project?.githubSync?.columnMapping).toEqual({ PR_REVIEW: "Review" });
    });
  });
});

describe("update_settings - get_settings", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  it("should include column mapping in get_settings response", async () => {
    // Arrange
    const ctx = createSettingsToolContext(testDb);

    // Enable GitHub and configure custom mapping
    await handleUpdateSettings(ctx, { action: "enable_github" });
    await handleUpdateSettings(ctx, {
      action: "configure_column_mapping",
      github: {
        columnMapping: { PR_REVIEW: "In Review" },
      },
    });

    // Act
    const result = await handleUpdateSettings(ctx, {
      action: "get_settings",
    });

    // Assert
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0].text);
    expect(content.github.columnMapping).toBeDefined();
    expect(content.github.columnMapping.effective).toEqual({
      ...DEFAULT_COLUMN_MAPPING,
      PR_REVIEW: "In Review",
    });
    expect(content.github.columnMapping.custom).toEqual({ PR_REVIEW: "In Review" });
    expect(content.github.columnMapping.isDefault).toBe(false);
  });

  it("should show default column mapping when none configured", async () => {
    // Arrange
    const ctx = createSettingsToolContext(testDb);
    await handleUpdateSettings(ctx, { action: "enable_github" });

    // Act
    const result = await handleUpdateSettings(ctx, {
      action: "get_settings",
    });

    // Assert
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0].text);
    expect(content.github.columnMapping.effective).toEqual(DEFAULT_COLUMN_MAPPING);
    expect(content.github.columnMapping.custom).toBeUndefined();
    expect(content.github.columnMapping.isDefault).toBe(true);
  });
});
