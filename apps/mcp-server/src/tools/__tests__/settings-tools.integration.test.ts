/**
 * Settings Tools Integration Tests
 *
 * Tests settings-related MCP tool handlers with real database operations.
 * Focuses on column mapping configuration functionality.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createContainer, asValue, InjectionMode } from "awilix";
import { createTestDatabase, type TestDatabase } from "../../test/setup.js";
import {
  MockGitHubCLI,
  TypeService,
  DEFAULT_COLUMN_MAPPING,
  ProjectManagementRegistry,
  UpdateSettingsSchema,
  type Project,
} from "@dev-workflow/tracking";
import { handleUpdateSettings } from "../../tools/settings-tools.js";
import { createMcpTool } from "../../di/bootstrap.js";

const TEST_GIT_ROOT_HASH = "abc123def456";
const TEST_GIT_ROOT = "/test/repo";

/**
 * Test context returned by createSettingsTestContext
 */
interface SettingsTestContext {
  updateSettings: ReturnType<typeof createMcpTool>;
  project: Project;
  dbSource: TestDatabase["source"];
}

/**
 * Create a test context for settings tools.
 * Returns a bound tool function + raw deps for assertions.
 */
async function createSettingsTestContext(
  testDb: TestDatabase,
  mockGitHubCLI?: MockGitHubCLI,
  project?: Project
): Promise<SettingsTestContext> {
  const githubCLI = mockGitHubCLI ?? new MockGitHubCLI();
  const typeService = new TypeService(testDb.source.types);

  // Create project if not provided
  const testProject =
    project ??
    (await testDb.source.projects.create({
      name: "test-project",
      gitRootHash: TEST_GIT_ROOT_HASH,
    }));

  const providerRegistry = ProjectManagementRegistry.getInstance();

  // Create test container with dependencies
  const testContainer = createContainer({
    injectionMode: InjectionMode.CLASSIC,
  });

  testContainer.register({
    dbSource: asValue(testDb.source),
    project: asValue(testProject),
    githubCLI: asValue(githubCLI),
    providerRegistry: asValue(providerRegistry),
    typeService: asValue(typeService),
    projectRoot: asValue(TEST_GIT_ROOT),
  });

  // Bind handler to test container
  const updateSettings = createMcpTool(handleUpdateSettings, testContainer);

  return {
    updateSettings,
    project: testProject,
    dbSource: testDb.source,
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
      const ctx = await createSettingsTestContext(testDb);

      // Act
      const result = await ctx.updateSettings({
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
    let ctx: SettingsTestContext;

    beforeEach(async () => {
      ctx = await createSettingsTestContext(testDb);

      // Enable GitHub sync first
      await ctx.updateSettings({
        action: "enable_github",
      });
    });

    it("should return current mapping when no changes provided", async () => {
      // Act
      const result = await ctx.updateSettings({
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
      const result = await ctx.updateSettings({
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
      const result = await ctx.updateSettings({
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
      await ctx.updateSettings({
        action: "configure_column_mapping",
        github: {
          columnMapping: { PR_REVIEW: "Code Review" },
        },
      });

      // Act - update a different mapping
      const result = await ctx.updateSettings({
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
      await ctx.updateSettings({
        action: "configure_column_mapping",
        github: {
          columnMapping: {
            PR_REVIEW: "Code Review",
            IN_PROGRESS: "Active",
          },
        },
      });

      // Act - reset to defaults
      const result = await ctx.updateSettings({
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
      await ctx.updateSettings({
        action: "configure_column_mapping",
        github: {
          columnMapping: { PR_REVIEW: "Review" },
        },
      });

      // Assert - verify persisted in database
      const project = await ctx.dbSource.projects.findById(ctx.project.id);
      expect(project?.syncConfig?.columnMapping).toEqual({ PR_REVIEW: "Review" });
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
    const ctx = await createSettingsTestContext(testDb);

    // Enable GitHub and configure custom mapping
    await ctx.updateSettings({ action: "enable_github" });
    await ctx.updateSettings({
      action: "configure_column_mapping",
      github: {
        columnMapping: { PR_REVIEW: "In Review" },
      },
    });

    // Act
    const result = await ctx.updateSettings({
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
    const ctx = await createSettingsTestContext(testDb);
    await ctx.updateSettings({ action: "enable_github" });

    // Act
    const result = await ctx.updateSettings({
      action: "get_settings",
    });

    // Assert
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0].text);
    expect(content.github.columnMapping.effective).toEqual(DEFAULT_COLUMN_MAPPING);
    expect(content.github.columnMapping.custom).toBeUndefined();
    expect(content.github.columnMapping.isDefault).toBe(true);
  });

  it("should include assignee in get_settings response when configured", async () => {
    // Arrange
    const ctx = await createSettingsTestContext(testDb);
    await ctx.updateSettings({
      action: "enable_github",
      github: { assignee: "testuser" },
    });

    // Act
    const result = await ctx.updateSettings({
      action: "get_settings",
    });

    // Assert
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0].text);
    expect(content.github.assignee).toBe("testuser");
    expect(content.github.syncIssues.assignee).toBe("testuser");
  });

  it("should show null assignee when not configured", async () => {
    // Arrange
    const ctx = await createSettingsTestContext(testDb);
    await ctx.updateSettings({ action: "enable_github" });

    // Act
    const result = await ctx.updateSettings({
      action: "get_settings",
    });

    // Assert
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0].text);
    expect(content.github.assignee).toBeNull();
  });
});

describe("update_settings - assignee configuration", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  describe("enable_github with assignee", () => {
    it("should store assignee when provided with enable_github", async () => {
      // Arrange
      const ctx = await createSettingsTestContext(testDb);

      // Act
      const result = await ctx.updateSettings({
        action: "enable_github",
        github: { assignee: "octocat" },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.config.syncIssues.assignee).toBe("octocat");

      // Verify persisted in database
      const project = await ctx.dbSource.projects.findById(ctx.project.id);
      expect(project?.syncConfig?.assignee).toBe("octocat");
    });

    it("should reject assignee with @ prefix", async () => {
      // Arrange
      const ctx = await createSettingsTestContext(testDb);

      // Act
      const result = await ctx.updateSettings({
        action: "enable_github",
        github: { assignee: "@octocat" },
      });

      // Assert
      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("should not include @ prefix");
    });

    it("should reject invalid username format", async () => {
      // Arrange
      const ctx = await createSettingsTestContext(testDb);

      // Act
      const result = await ctx.updateSettings({
        action: "enable_github",
        github: { assignee: "user--name" }, // consecutive hyphens
      });

      // Assert
      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("Invalid GitHub username format");
    });

    it("should accept valid usernames with hyphens", async () => {
      // Arrange
      const ctx = await createSettingsTestContext(testDb);

      // Act
      const result = await ctx.updateSettings({
        action: "enable_github",
        github: { assignee: "my-username-123" },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.config.syncIssues.assignee).toBe("my-username-123");
    });
  });

  describe("configure_github with assignee", () => {
    let ctx: SettingsTestContext;

    beforeEach(async () => {
      ctx = await createSettingsTestContext(testDb);
      // Enable GitHub sync first
      await ctx.updateSettings({ action: "enable_github" });
    });

    it("should update assignee via configure_github", async () => {
      // Act
      const result = await ctx.updateSettings({
        action: "configure_github",
        github: { assignee: "newuser" },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.config.syncIssues.assignee).toBe("newuser");
    });

    it("should clear assignee when empty string provided", async () => {
      // Arrange - first set an assignee
      await ctx.updateSettings({
        action: "configure_github",
        github: { assignee: "existinguser" },
      });

      // Act - clear with empty string
      const result = await ctx.updateSettings({
        action: "configure_github",
        github: { assignee: "" },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.config.syncIssues.assignee).toBeUndefined();

      // Verify in database
      const project = await ctx.dbSource.projects.findById(ctx.project.id);
      expect(project?.syncConfig?.assignee).toBeUndefined();
    });

    it("should preserve assignee when not provided in configure_github", async () => {
      // Arrange - first set an assignee
      await ctx.updateSettings({
        action: "configure_github",
        github: { assignee: "existinguser" },
      });

      // Act - update something else, don't provide assignee
      await ctx.updateSettings({
        action: "configure_column_mapping",
        github: { columnMapping: { PR_REVIEW: "Review" } },
      });

      // Assert - assignee should still be there
      const project = await ctx.dbSource.projects.findById(ctx.project.id);
      expect(project?.syncConfig?.assignee).toBe("existinguser");
    });

    it("should reject assignee with @ prefix via configure_github", async () => {
      // Act
      const result = await ctx.updateSettings({
        action: "configure_github",
        github: { assignee: "@baduser" },
      });

      // Assert
      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("should not include @ prefix");
    });
  });
});

describe("update_settings - list_available_labels", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  it("should return error when GitHub sync is not enabled", async () => {
    // Arrange
    const ctx = await createSettingsTestContext(testDb);

    // Act
    const result = await ctx.updateSettings({
      action: "list_available_labels",
    });

    // Assert
    expect(result.isError).toBe(true);
    const content = JSON.parse(result.content[0].text);
    expect(content.error).toContain("GitHub issue sync is not enabled");
  });

  it("should return labels from GitHub Project (excluding Status)", async () => {
    // Arrange
    const mockGitHubCLI = new MockGitHubCLI({
      projectFields: [
        {
          id: "PVTF_1",
          name: "Status",
          type: "SINGLE_SELECT" as const,
          options: [{ id: "opt1", name: "Done" }],
        },
        {
          id: "PVTF_2",
          name: "Product",
          type: "SINGLE_SELECT" as const,
          options: [
            { id: "opt2", name: "Case Workflow" },
            { id: "opt3", name: "Web Platform" },
          ],
        },
        { id: "PVTF_3", name: "Notes", type: "TEXT" as const },
      ],
    });
    const ctx = await createSettingsTestContext(testDb, mockGitHubCLI);

    // Enable GitHub with a projectId
    await ctx.updateSettings({
      action: "enable_github",
      github: { projectId: "PVT_test123" },
    });

    // Act
    const result = await ctx.updateSettings({
      action: "list_available_labels",
    });

    // Assert
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0].text);
    expect(content.success).toBe(true);
    expect(content.supported).toBe(true);
    // Status field should be excluded
    expect(content.labels).toHaveLength(2);
    // Product should have constrained values
    expect(content.labels[0]).toEqual({
      name: "Product",
      validValues: ["Case Workflow", "Web Platform"],
    });
    // Notes (TEXT field) should allow any value
    expect(content.labels[1]).toEqual({
      name: "Notes",
      validValues: null,
    });
  });

  it("should return not supported when no projectId is configured", async () => {
    // Arrange
    const ctx = await createSettingsTestContext(testDb);
    await ctx.updateSettings({ action: "enable_github" });

    // Act
    const result = await ctx.updateSettings({
      action: "list_available_labels",
    });

    // Assert
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0].text);
    expect(content.success).toBe(true);
    expect(content.supported).toBe(false);
    expect(content.labels).toEqual([]);
    expect(content.message).toContain("No project configured");
  });
});

describe("update_settings - typeLabels validation", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  describe("enable_github with typeLabels", () => {
    it("should accept valid typeLabels (uses default types when DB empty)", async () => {
      // Arrange
      const ctx = await createSettingsTestContext(testDb);

      // Act - use default types (FEATURE, BUG, etc.)
      const result = await ctx.updateSettings({
        action: "enable_github",
        github: {
          labels: {
            typeLabels: {
              FEATURE: "feat",
              BUG: "bug-fix",
            },
          },
        },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.config.syncIssues.labels.typeLabels.FEATURE).toBe("feat");
      expect(content.config.syncIssues.labels.typeLabels.BUG).toBe("bug-fix");
    });

    it("should reject invalid typeLabels", async () => {
      // Arrange
      const ctx = await createSettingsTestContext(testDb);

      // Act - use an invalid type name
      const result = await ctx.updateSettings({
        action: "enable_github",
        github: {
          labels: {
            typeLabels: {
              FEATURE: "feat",
              INVALID_TYPE: "invalid",
            },
          },
        },
      });

      // Assert
      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("Invalid type(s) in typeLabels");
      expect(content.error).toContain("'INVALID_TYPE'");
      expect(content.error).toContain("Valid types:");
      expect(content.error).toContain("FEATURE");
    });

    it("should list multiple invalid types in error message", async () => {
      // Arrange
      const ctx = await createSettingsTestContext(testDb);

      // Act - use multiple invalid type names
      const result = await ctx.updateSettings({
        action: "enable_github",
        github: {
          labels: {
            typeLabels: {
              SPKE: "spike-typo", // typo of SPIKE
              FEATUR: "feature-typo", // typo of FEATURE
            },
          },
        },
      });

      // Assert
      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("'SPKE'");
      expect(content.error).toContain("'FEATUR'");
    });
  });

  describe("configure_github with typeLabels", () => {
    let ctx: SettingsTestContext;

    beforeEach(async () => {
      ctx = await createSettingsTestContext(testDb);
      // Enable GitHub sync first
      await ctx.updateSettings({ action: "enable_github" });
    });

    it("should accept valid typeLabels via configure_github", async () => {
      // Act
      const result = await ctx.updateSettings({
        action: "configure_github",
        github: {
          labels: {
            typeLabels: {
              TASK: "chore",
              ENHANCEMENT: "improvement",
            },
          },
        },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.config.syncIssues.labels.typeLabels.TASK).toBe("chore");
      expect(content.config.syncIssues.labels.typeLabels.ENHANCEMENT).toBe("improvement");
    });

    it("should reject invalid typeLabels via configure_github", async () => {
      // Act
      const result = await ctx.updateSettings({
        action: "configure_github",
        github: {
          labels: {
            typeLabels: {
              NOT_A_TYPE: "invalid",
            },
          },
        },
      });

      // Assert
      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("Invalid type(s) in typeLabels");
      expect(content.error).toContain("'NOT_A_TYPE'");
    });

    it("should validate against database types when seeded", async () => {
      // Arrange - seed a custom type in DB
      testDb.source.types.create({
        name: "CUSTOM",
        displayName: "Custom",
        description: "A custom type",
        keywords: ["custom"],
      });

      // Re-create context with fresh TypeService to pick up seeded types
      // Pass existing project to avoid UNIQUE constraint violation
      const newCtx = await createSettingsTestContext(testDb, undefined, ctx.project);
      await newCtx.updateSettings({ action: "enable_github" });

      // Act - use the custom type
      const result = await newCtx.updateSettings({
        action: "configure_github",
        github: {
          labels: {
            typeLabels: {
              CUSTOM: "custom-label",
            },
          },
        },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
    });

    it("should reject default types when only custom types exist in DB", async () => {
      // Arrange - seed ONLY custom types, no defaults
      testDb.source.types.create({
        name: "CUSTOM",
        displayName: "Custom",
        description: "A custom type",
        keywords: ["custom"],
      });

      // Re-create context with fresh TypeService to pick up seeded types
      // Pass existing project to avoid UNIQUE constraint violation
      const newCtx = await createSettingsTestContext(testDb, undefined, ctx.project);
      await newCtx.updateSettings({ action: "enable_github" });

      // Act - try to use a default type that's not in the seeded DB
      const result = await newCtx.updateSettings({
        action: "configure_github",
        github: {
          labels: {
            typeLabels: {
              FEATURE: "feature", // Not in DB when custom types are seeded
            },
          },
        },
      });

      // Assert - should reject since only CUSTOM exists in DB
      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("Invalid type(s) in typeLabels");
      expect(content.error).toContain("'FEATURE'");
      expect(content.error).toContain("CUSTOM"); // Valid types should show CUSTOM
    });

    it("should allow mix of valid types", async () => {
      // Act - mix of default types
      const result = await ctx.updateSettings({
        action: "configure_github",
        github: {
          labels: {
            typeLabels: {
              FEATURE: "feat",
              BUG: "bug",
              ENHANCEMENT: "enhance",
              TASK: "task",
            },
          },
        },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
    });
  });
});

/**
 * Schema Validation Tests for Settings Tools
 */
describe("Settings Tool Schema Validation", () => {
  describe("UpdateSettingsSchema", () => {
    it("should accept get_settings action", () => {
      const result = UpdateSettingsSchema.safeParse({ action: "get_settings", gitRoot: "/repo" });
      expect(result.success).toBe(true);
    });

    it("should accept enable_github action", () => {
      const result = UpdateSettingsSchema.safeParse({ action: "enable_github", gitRoot: "/repo" });
      expect(result.success).toBe(true);
    });

    it("should accept disable_github action", () => {
      const result = UpdateSettingsSchema.safeParse({ action: "disable_github", gitRoot: "/repo" });
      expect(result.success).toBe(true);
    });

    it("should accept configure_github with options", () => {
      const input = {
        action: "configure_github",
        gitRoot: "/repo",
        github: {
          projectId: "PVT_test123",
          assignee: "username",
          labels: {
            customLabels: ["custom-label"],
            typeLabels: { FEATURE: "feature", BUG: "bug" },
          },
        },
      };
      const result = UpdateSettingsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept configure_column_mapping action", () => {
      const input = {
        action: "configure_column_mapping",
        gitRoot: "/repo",
        github: {
          columnMapping: {
            BACKLOG: "Backlog",
            READY: "Ready",
            IN_PROGRESS: "In Progress",
            PR_REVIEW: "In Review",
            COMPLETED: "Done",
          },
        },
      };
      const result = UpdateSettingsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept resetColumnMapping flag", () => {
      const input = {
        action: "configure_column_mapping",
        gitRoot: "/repo",
        resetColumnMapping: true,
      };
      const result = UpdateSettingsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject invalid action", () => {
      const result = UpdateSettingsSchema.safeParse({ action: "invalid_action", gitRoot: "/repo" });
      expect(result.success).toBe(false);
    });

    it("should reject missing action", () => {
      const result = UpdateSettingsSchema.safeParse({ gitRoot: "/repo" });
      expect(result.success).toBe(false);
    });
  });
});
