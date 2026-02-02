/**
 * Template Service Tests
 *
 * Tests the cascading template resolution logic:
 * 1. Local per-type: ./.track/templates/issues/<type>.md
 * 2. Local all.md: ./.track/templates/issues/all.md
 * 3. Global per-type: ~/.track/templates/issues/<type>.md
 * 4. Global all.md: ~/.track/templates/issues/all.md
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Dirent } from "node:fs";
import type { FileSystem } from "../../file-system/file-system.js";
import { Effect } from "@dev-workflow/effect";
import { TemplateService, type TemplateServiceConfig } from "../template-service.js";

// Valid template content for testing
const makeTemplate = (type: string, priority: string = "MEDIUM", description?: string) => {
  const descriptionLine = description ? `description: ${description}\n` : "";
  return `---
type: ${type}
priority: ${priority}
${descriptionLine}---

# ${type} Template

Description goes here.
`;
};

// Create a mock Dirent entry
const mockDirent = (name: string, isFile: boolean = true): Dirent =>
  ({
    name,
    isFile: () => isFile,
    isDirectory: () => !isFile,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    parentPath: "",
    path: "",
  }) as Dirent;

describe("TemplateService", () => {
  let mockFileSystem: FileSystem;
  let config: TemplateServiceConfig;
  let service: TemplateService;

  // Track which files "exist" and their contents
  let fileContents: Map<string, string>;
  let directoryContents: Map<string, string[]>;

  beforeEach(() => {
    fileContents = new Map();
    directoryContents = new Map();

    // Initialize empty directories
    directoryContents.set("/repo/.track/templates/issues", []);
    directoryContents.set("/repo/.track/templates/tasks", []);
    directoryContents.set("/global/config/templates/issues", []);
    directoryContents.set("/global/config/templates/tasks", []);

    mockFileSystem = {
      exists: vi.fn().mockImplementation(async (path: string) => {
        return fileContents.has(path) || directoryContents.has(path);
      }),
      readFile: vi.fn().mockImplementation(async (path: string) => {
        const content = fileContents.get(path);
        if (!content) throw new Error(`File not found: ${path}`);
        return content;
      }),
      writeFile: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdirWithFileTypes: vi.fn().mockImplementation(async (path: string) => {
        const files = directoryContents.get(path) ?? [];
        return files.map((name) => mockDirent(name));
      }),
    };

    config = {
      localIssueTemplatesPath: "/repo/.track/templates/issues",
      localTaskTemplatesPath: "/repo/.track/templates/tasks",
      globalIssueTemplatesPath: "/global/config/templates/issues",
      globalTaskTemplatesPath: "/global/config/templates/tasks",
    };

    service = new TemplateService(mockFileSystem, config);
  });

  // Helper to add a template file
  const addTemplate = (dir: string, filename: string, content: string) => {
    const path = `${dir}/${filename}`;
    fileContents.set(path, content);
    const files = directoryContents.get(dir) ?? [];
    if (!files.includes(filename)) {
      files.push(filename);
      directoryContents.set(dir, files);
    }
  };

  describe("discoverTemplates", () => {
    it("should return empty arrays when no templates exist", async () => {
      const result = await Effect.runPromise(service.discoverTemplates());

      expect(result.userTemplates).toEqual([]);
      expect(result.defaultTemplates).toEqual([]);
      expect(result.merged).toEqual([]);
    });

    it("should discover local templates", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      const result = await Effect.runPromise(service.discoverTemplates());

      expect(result.userTemplates).toHaveLength(1);
      expect(result.userTemplates[0]?.filename).toBe("feature.md");
      expect(result.userTemplates[0]?.isUserDefined).toBe(true);
    });

    it("should discover global templates", async () => {
      addTemplate(config.globalIssueTemplatesPath, "bug.md", makeTemplate("BUG"));

      const result = await Effect.runPromise(service.discoverTemplates());

      expect(result.defaultTemplates).toHaveLength(1);
      expect(result.defaultTemplates[0]?.filename).toBe("bug.md");
      expect(result.defaultTemplates[0]?.isUserDefined).toBe(false);
    });

    it("should merge local and global templates", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));
      addTemplate(config.globalIssueTemplatesPath, "bug.md", makeTemplate("BUG"));

      const result = await Effect.runPromise(service.discoverTemplates());

      expect(result.merged).toHaveLength(2);
      expect(result.merged.map((t) => t.filename).sort()).toEqual(["bug.md", "feature.md"]);
    });

    it("should have local templates override global templates by filename", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "HIGH"));
      addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));

      const result = await Effect.runPromise(service.discoverTemplates());

      expect(result.merged).toHaveLength(1);
      expect(result.merged[0]?.metadata.priority).toBe("HIGH");
      expect(result.merged[0]?.isUserDefined).toBe(true);
    });

    it("should cache results", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      await Effect.runPromise(service.discoverTemplates());
      await Effect.runPromise(service.discoverTemplates());

      // readdirWithFileTypes should only be called twice (once per directory)
      expect(mockFileSystem.readdirWithFileTypes).toHaveBeenCalledTimes(2);
    });

    it("should clear cache when clearCache() is called", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      await Effect.runPromise(service.discoverTemplates());
      service.clearCache();
      await Effect.runPromise(service.discoverTemplates());

      // readdirWithFileTypes should be called 4 times (twice per discovery)
      expect(mockFileSystem.readdirWithFileTypes).toHaveBeenCalledTimes(4);
    });
  });

  describe("selectTemplate - cascading resolution", () => {
    describe("Resolution Order: local per-type -> local all.md -> global per-type -> global all.md", () => {
      it("should prefer local per-type template (priority 1)", async () => {
        addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "HIGH"));
        addTemplate(config.localIssueTemplatesPath, "all.md", makeTemplate("TASK", "MEDIUM"));
        addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));
        addTemplate(config.globalIssueTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await Effect.runPromise(service.selectTemplate("Add new feature"));

        expect(result.metadata.priority).toBe("HIGH");
        expect(result.isUserDefined).toBe(true);
        expect(result.filename).toBe("feature.md");
      });

      it("should fall back to local all.md when local per-type not found (priority 2)", async () => {
        addTemplate(config.localIssueTemplatesPath, "all.md", makeTemplate("TASK", "HIGH"));
        addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));
        addTemplate(config.globalIssueTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await Effect.runPromise(service.selectTemplate("Add new feature"));

        expect(result.metadata.priority).toBe("HIGH");
        expect(result.isUserDefined).toBe(true);
        expect(result.filename).toBe("all.md");
      });

      it("should fall back to global per-type when local templates not found (priority 3)", async () => {
        addTemplate(
          config.globalIssueTemplatesPath,
          "feature.md",
          makeTemplate("FEATURE", "MEDIUM")
        );
        addTemplate(config.globalIssueTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await Effect.runPromise(service.selectTemplate("Add new feature"));

        expect(result.metadata.priority).toBe("MEDIUM");
        expect(result.isUserDefined).toBe(false);
        expect(result.filename).toBe("feature.md");
      });

      it("should fall back to global all.md as last resort (priority 4)", async () => {
        addTemplate(config.globalIssueTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await Effect.runPromise(service.selectTemplate("Add new feature"));

        expect(result.metadata.priority).toBe("LOW");
        expect(result.isUserDefined).toBe(false);
        expect(result.filename).toBe("all.md");
      });

      it("should throw when no templates available", async () => {
        await expect(Effect.runPromise(service.selectTemplate("Add new feature"))).rejects.toThrow(
          "No templates available"
        );
      });
    });

    describe("Type detection from description", () => {
      beforeEach(() => {
        // Add all per-type templates in global for testing type detection
        addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));
        addTemplate(config.globalIssueTemplatesPath, "bug.md", makeTemplate("BUG"));
        addTemplate(config.globalIssueTemplatesPath, "enhancement.md", makeTemplate("ENHANCEMENT"));
        addTemplate(config.globalIssueTemplatesPath, "task.md", makeTemplate("TASK"));
      });

      it("should detect bug template from keywords", async () => {
        const keywords = ["bug", "error", "broken", "failing"];
        for (const keyword of keywords) {
          service.clearCache();
          const result = await Effect.runPromise(service.selectTemplate(`Fix ${keyword} in login`));
          expect(result.filename).toBe("bug.md");
        }
      });

      it("should detect enhancement template from keywords", async () => {
        const keywords = ["enhance", "improve", "optimize", "better"];
        for (const keyword of keywords) {
          service.clearCache();
          const result = await Effect.runPromise(service.selectTemplate(`${keyword} performance`));
          expect(result.filename).toBe("enhancement.md");
        }
      });

      it("should detect task template from keywords", async () => {
        const keywords = ["task", "chore", "setup"];
        for (const keyword of keywords) {
          service.clearCache();
          const result = await Effect.runPromise(service.selectTemplate(`${keyword} CI pipeline`));
          expect(result.filename).toBe("task.md");
        }
      });

      it("should default to feature template", async () => {
        const result = await Effect.runPromise(service.selectTemplate("Add user authentication"));
        expect(result.filename).toBe("feature.md");
      });
    });
  });

  describe("getTaskTemplate - per-type task template resolution", () => {
    it("should return null when no task templates exist", async () => {
      const result = await Effect.runPromise(service.getTaskTemplate());
      expect(result).toBeNull();
    });

    it("should return null when no task templates exist (with type)", async () => {
      const result = await Effect.runPromise(service.getTaskTemplate("FEATURE"));
      expect(result).toBeNull();
    });

    describe("Resolution Order: local per-type -> local all.md -> global per-type -> global all.md", () => {
      it("should prefer local per-type template (priority 1)", async () => {
        addTemplate(config.localTaskTemplatesPath, "feature.md", makeTemplate("FEATURE", "HIGH"));
        addTemplate(config.localTaskTemplatesPath, "all.md", makeTemplate("TASK", "MEDIUM"));
        addTemplate(config.globalTaskTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));
        addTemplate(config.globalTaskTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await Effect.runPromise(service.getTaskTemplate("FEATURE"));

        expect(result?.metadata.priority).toBe("HIGH");
        expect(result?.isUserDefined).toBe(true);
        expect(result?.filename).toBe("feature.md");
      });

      it("should fall back to local all.md when local per-type not found (priority 2)", async () => {
        addTemplate(config.localTaskTemplatesPath, "all.md", makeTemplate("TASK", "HIGH"));
        addTemplate(config.globalTaskTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));
        addTemplate(config.globalTaskTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await Effect.runPromise(service.getTaskTemplate("FEATURE"));

        expect(result?.metadata.priority).toBe("HIGH");
        expect(result?.isUserDefined).toBe(true);
        expect(result?.filename).toBe("all.md");
      });

      it("should fall back to global per-type when local templates not found (priority 3)", async () => {
        addTemplate(
          config.globalTaskTemplatesPath,
          "feature.md",
          makeTemplate("FEATURE", "MEDIUM")
        );
        addTemplate(config.globalTaskTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await Effect.runPromise(service.getTaskTemplate("FEATURE"));

        expect(result?.metadata.priority).toBe("MEDIUM");
        expect(result?.isUserDefined).toBe(false);
        expect(result?.filename).toBe("feature.md");
      });

      it("should fall back to global all.md as last resort (priority 4)", async () => {
        addTemplate(config.globalTaskTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await Effect.runPromise(service.getTaskTemplate("FEATURE"));

        expect(result?.metadata.priority).toBe("LOW");
        expect(result?.isUserDefined).toBe(false);
        expect(result?.filename).toBe("all.md");
      });
    });

    describe("Type-specific template selection", () => {
      beforeEach(() => {
        // Add all per-type templates in global
        addTemplate(config.globalTaskTemplatesPath, "feature.md", makeTemplate("FEATURE"));
        addTemplate(config.globalTaskTemplatesPath, "bug.md", makeTemplate("BUG"));
        addTemplate(config.globalTaskTemplatesPath, "enhancement.md", makeTemplate("ENHANCEMENT"));
        addTemplate(config.globalTaskTemplatesPath, "task.md", makeTemplate("TASK"));
      });

      it("should select FEATURE template for FEATURE type", async () => {
        const result = await Effect.runPromise(service.getTaskTemplate("FEATURE"));
        expect(result?.filename).toBe("feature.md");
      });

      it("should select BUG template for BUG type", async () => {
        const result = await Effect.runPromise(service.getTaskTemplate("BUG"));
        expect(result?.filename).toBe("bug.md");
      });

      it("should select ENHANCEMENT template for ENHANCEMENT type", async () => {
        const result = await Effect.runPromise(service.getTaskTemplate("ENHANCEMENT"));
        expect(result?.filename).toBe("enhancement.md");
      });

      it("should select TASK template for TASK type", async () => {
        const result = await Effect.runPromise(service.getTaskTemplate("TASK"));
        expect(result?.filename).toBe("task.md");
      });

      it("should handle lowercase type names", async () => {
        const result = await Effect.runPromise(service.getTaskTemplate("feature"));
        expect(result?.filename).toBe("feature.md");
      });
    });

    describe("Backward compatibility (no type)", () => {
      it("should return local all.md when no type specified", async () => {
        addTemplate(config.localTaskTemplatesPath, "all.md", makeTemplate("TASK", "HIGH"));
        addTemplate(config.globalTaskTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await Effect.runPromise(service.getTaskTemplate());

        expect(result?.metadata.priority).toBe("HIGH");
        expect(result?.isUserDefined).toBe(true);
      });

      it("should fall back to global all.md when no type specified and local not found", async () => {
        addTemplate(config.globalTaskTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await Effect.runPromise(service.getTaskTemplate());

        expect(result?.metadata.priority).toBe("LOW");
        expect(result?.isUserDefined).toBe(false);
      });

      it("should skip per-type when no type specified", async () => {
        addTemplate(config.localTaskTemplatesPath, "feature.md", makeTemplate("FEATURE", "HIGH"));
        addTemplate(config.globalTaskTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await Effect.runPromise(service.getTaskTemplate());

        // Should skip feature.md and use global all.md since no type was provided
        expect(result?.metadata.priority).toBe("LOW");
        expect(result?.filename).toBe("all.md");
      });
    });
  });

  describe("getTemplateByFilename", () => {
    it("should return template by filename", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      const result = await Effect.runPromise(service.getTemplateByFilename("feature.md"));

      expect(result).not.toBeNull();
      expect(result?.filename).toBe("feature.md");
    });

    it("should return null for non-existent template", async () => {
      const result = await Effect.runPromise(service.getTemplateByFilename("nonexistent.md"));
      expect(result).toBeNull();
    });
  });

  describe("getTemplate - with source info", () => {
    it("should return user source for local template", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      const result = await Effect.runPromise(service.getTemplate("feature.md"));

      expect(result).not.toBeNull();
      expect(result?.source).toBe("user");
    });

    it("should return default source for global template", async () => {
      addTemplate(config.globalIssueTemplatesPath, "bug.md", makeTemplate("BUG"));

      const result = await Effect.runPromise(service.getTemplate("bug.md"));

      expect(result).not.toBeNull();
      expect(result?.source).toBe("default");
    });

    it("should prefer user over default when both exist", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "HIGH"));
      addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));

      const result = await Effect.runPromise(service.getTemplate("feature.md"));

      expect(result?.source).toBe("user");
      expect(result?.template.metadata.priority).toBe("HIGH");
    });
  });

  describe("createTemplate", () => {
    it("should create a new user template", async () => {
      const content = makeTemplate("FEATURE");

      const result = await Effect.runPromise(service.createTemplate("custom.md", content));

      expect(result.filename).toBe("custom.md");
      expect(result.isUserDefined).toBe(true);
      expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
        "/repo/.track/templates/issues/custom.md",
        content
      );
    });

    it("should throw if filename does not end with .md", () => {
      expect(() => service.createTemplate("custom.txt", makeTemplate("FEATURE"))).toThrow(
        "must end with .md"
      );
    });

    it("should throw if user template already exists", async () => {
      addTemplate(config.localIssueTemplatesPath, "existing.md", makeTemplate("FEATURE"));

      await expect(
        Effect.runPromise(service.createTemplate("existing.md", makeTemplate("FEATURE")))
      ).rejects.toThrow("already exists");
    });

    it("should allow creating user template that overrides default", async () => {
      addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));

      const content = makeTemplate("FEATURE", "HIGH");
      const result = await Effect.runPromise(service.createTemplate("feature.md", content));

      expect(result.metadata.priority).toBe("HIGH");
    });

    it("should create templates directory if it does not exist", async () => {
      // Remove directory from mock
      directoryContents.delete(config.localIssueTemplatesPath);

      const content = makeTemplate("FEATURE");
      await Effect.runPromise(service.createTemplate("custom.md", content));

      expect(mockFileSystem.mkdir).toHaveBeenCalledWith(config.localIssueTemplatesPath, {
        recursive: true,
      });
    });
  });

  describe("updateTemplate", () => {
    it("should update an existing user template", async () => {
      addTemplate(config.localIssueTemplatesPath, "custom.md", makeTemplate("FEATURE", "LOW"));

      const newContent = makeTemplate("FEATURE", "HIGH");
      const result = await Effect.runPromise(service.updateTemplate("custom.md", newContent));

      expect(result.metadata.priority).toBe("HIGH");
      expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
        "/repo/.track/templates/issues/custom.md",
        newContent
      );
    });

    it("should throw if template does not exist", async () => {
      await expect(
        Effect.runPromise(service.updateTemplate("nonexistent.md", makeTemplate("FEATURE")))
      ).rejects.toThrow("not found");
    });

    // Note: With scope-aware operations, global templates can be updated by specifying scope="global"
    // The old behavior of "Cannot modify default template" is no longer applicable
    // See scope-aware operations tests for the new behavior
  });

  describe("deleteTemplate", () => {
    it("should delete a user template", async () => {
      addTemplate(config.localIssueTemplatesPath, "custom.md", makeTemplate("FEATURE"));

      await Effect.runPromise(service.deleteTemplate("custom.md"));

      expect(mockFileSystem.unlink).toHaveBeenCalledWith("/repo/.track/templates/issues/custom.md");
    });

    it("should throw if template does not exist", async () => {
      await expect(Effect.runPromise(service.deleteTemplate("nonexistent.md"))).rejects.toThrow(
        "not found"
      );
    });

    // Note: With scope-aware operations, global templates can be deleted by specifying scope="global"
    // The old behavior of "Cannot delete default template" is no longer applicable
    // See scope-aware operations tests for the new behavior
  });

  describe("graceful degradation", () => {
    it("should handle missing local templates directory gracefully", async () => {
      directoryContents.delete(config.localIssueTemplatesPath);
      addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      const result = await Effect.runPromise(service.discoverTemplates());

      expect(result.userTemplates).toEqual([]);
      expect(result.defaultTemplates).toHaveLength(1);
    });

    it("should handle missing global templates directory gracefully", async () => {
      directoryContents.delete(config.globalIssueTemplatesPath);
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      const result = await Effect.runPromise(service.discoverTemplates());

      expect(result.userTemplates).toHaveLength(1);
      expect(result.defaultTemplates).toEqual([]);
    });

    it("should skip invalid template files and continue", async () => {
      addTemplate(config.localIssueTemplatesPath, "valid.md", makeTemplate("FEATURE"));
      addTemplate(config.localIssueTemplatesPath, "invalid.md", "no frontmatter here");

      const result = await Effect.runPromise(service.discoverTemplates());

      expect(result.userTemplates).toHaveLength(1);
      expect(result.userTemplates[0]?.filename).toBe("valid.md");
    });

    it("should skip non-markdown files", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));
      // Add a non-markdown file
      const dir = config.localIssueTemplatesPath;
      const files = directoryContents.get(dir) ?? [];
      files.push("readme.txt");
      directoryContents.set(dir, files);

      const result = await Effect.runPromise(service.discoverTemplates());

      expect(result.userTemplates).toHaveLength(1);
      expect(result.userTemplates[0]?.filename).toBe("feature.md");
    });
  });

  describe("description field parsing", () => {
    it("should parse description from frontmatter", async () => {
      addTemplate(
        config.localIssueTemplatesPath,
        "feature.md",
        makeTemplate("FEATURE", "MEDIUM", "New functionality that doesn't exist yet")
      );

      const result = await Effect.runPromise(service.discoverTemplates());

      expect(result.userTemplates).toHaveLength(1);
      expect(result.userTemplates[0]?.metadata.description).toBe(
        "New functionality that doesn't exist yet"
      );
    });

    it("should handle missing description field", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      const result = await Effect.runPromise(service.discoverTemplates());

      expect(result.userTemplates).toHaveLength(1);
      expect(result.userTemplates[0]?.metadata.description).toBeUndefined();
    });

    it("should handle empty description field", async () => {
      addTemplate(
        config.localIssueTemplatesPath,
        "feature.md",
        `---
type: FEATURE
priority: MEDIUM
description:
---

# Feature Template
`
      );

      const result = await Effect.runPromise(service.discoverTemplates());

      expect(result.userTemplates).toHaveLength(1);
      expect(result.userTemplates[0]?.metadata.description).toBeUndefined();
    });

    it("should preserve description in getTemplate response", async () => {
      addTemplate(
        config.localIssueTemplatesPath,
        "bug.md",
        makeTemplate("BUG", "HIGH", "Defects, crashes, or incorrect behavior")
      );

      const result = await Effect.runPromise(service.getTemplate("bug.md"));

      expect(result).not.toBeNull();
      expect(result?.template.metadata.description).toBe("Defects, crashes, or incorrect behavior");
    });

    it("should preserve description in task templates", async () => {
      addTemplate(
        config.localTaskTemplatesPath,
        "feature.md",
        makeTemplate("FEATURE", "MEDIUM", "Task for implementing new functionality")
      );

      const result = await Effect.runPromise(service.discoverTaskTemplates());

      expect(result.userTemplates).toHaveLength(1);
      expect(result.userTemplates[0]?.metadata.description).toBe(
        "Task for implementing new functionality"
      );
    });

    it("should preserve description in getTaskTemplateInfo response", async () => {
      addTemplate(
        config.globalTaskTemplatesPath,
        "bug.md",
        makeTemplate("BUG", "HIGH", "Task for fixing defects")
      );

      const result = await Effect.runPromise(service.getTaskTemplateInfo("bug.md"));

      expect(result).not.toBeNull();
      expect(result?.template.metadata.description).toBe("Task for fixing defects");
    });
  });

  describe("scope-aware operations", () => {
    describe("getTemplate with scope parameter", () => {
      it("should find template in local scope when scope=local", async () => {
        addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "HIGH"));
        addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));

        const result = await Effect.runPromise(service.getTemplate("feature.md", "issue", "local"));

        expect(result).not.toBeNull();
        expect(result?.source).toBe("user");
        expect(result?.template.metadata.priority).toBe("HIGH");
      });

      it("should find template in global scope when scope=global", async () => {
        addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "HIGH"));
        addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));

        const result = await Effect.runPromise(
          service.getTemplate("feature.md", "issue", "global")
        );

        expect(result).not.toBeNull();
        expect(result?.source).toBe("default");
        expect(result?.template.metadata.priority).toBe("LOW");
      });

      it("should return null when template not found in specified scope", async () => {
        addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

        const result = await Effect.runPromise(service.getTemplate("feature.md", "issue", "local"));

        expect(result).toBeNull();
      });

      it("should search both scopes when no scope specified (local first)", async () => {
        addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));

        const result = await Effect.runPromise(service.getTemplate("feature.md", "issue"));

        expect(result).not.toBeNull();
        expect(result?.source).toBe("default");
      });

      it("should work with task category", async () => {
        addTemplate(config.localTaskTemplatesPath, "feature.md", makeTemplate("FEATURE", "HIGH"));

        const result = await Effect.runPromise(service.getTemplate("feature.md", "task", "local"));

        expect(result).not.toBeNull();
        expect(result?.source).toBe("user");
      });
    });

    describe("createTemplate with scope parameter", () => {
      it("should create template in local scope by default", async () => {
        const content = makeTemplate("FEATURE");
        const result = await Effect.runPromise(service.createTemplate("custom.md", content));

        expect(result.filename).toBe("custom.md");
        expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
          "/repo/.track/templates/issues/custom.md",
          content
        );
      });

      it("should create template in global scope when specified", async () => {
        const content = makeTemplate("FEATURE");
        const result = await Effect.runPromise(
          service.createTemplate("custom.md", content, "issue", "global")
        );

        expect(result.filename).toBe("custom.md");
        expect(result.isUserDefined).toBe(false); // global templates are not user-defined
        expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
          "/global/config/templates/issues/custom.md",
          content
        );
      });

      it("should create task template in specified scope", async () => {
        const content = makeTemplate("TASK");
        await Effect.runPromise(service.createTemplate("custom.md", content, "task", "local"));

        expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
          "/repo/.track/templates/tasks/custom.md",
          content
        );
      });

      it("should throw if template already exists at target scope", async () => {
        addTemplate(config.globalIssueTemplatesPath, "existing.md", makeTemplate("FEATURE"));

        await expect(
          Effect.runPromise(
            service.createTemplate("existing.md", makeTemplate("FEATURE"), "issue", "global")
          )
        ).rejects.toThrow("Global issue template 'existing.md' already exists");
      });

      it("should allow creating local template that shadows global", async () => {
        addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));

        const result = await Effect.runPromise(
          service.createTemplate("feature.md", makeTemplate("FEATURE", "HIGH"), "issue", "local")
        );

        expect(result.metadata.priority).toBe("HIGH");
      });
    });

    describe("updateTemplate with scope parameter", () => {
      it("should update local template by default", async () => {
        addTemplate(config.localIssueTemplatesPath, "custom.md", makeTemplate("FEATURE", "LOW"));

        const newContent = makeTemplate("FEATURE", "HIGH");
        const result = await Effect.runPromise(service.updateTemplate("custom.md", newContent));

        expect(result.metadata.priority).toBe("HIGH");
        expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
          "/repo/.track/templates/issues/custom.md",
          newContent
        );
      });

      it("should update global template when scope=global", async () => {
        addTemplate(config.globalIssueTemplatesPath, "custom.md", makeTemplate("FEATURE", "LOW"));

        const newContent = makeTemplate("FEATURE", "HIGH");
        const result = await Effect.runPromise(
          service.updateTemplate("custom.md", newContent, "issue", "global")
        );

        expect(result.metadata.priority).toBe("HIGH");
        expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
          "/global/config/templates/issues/custom.md",
          newContent
        );
      });

      it("should throw if template not found at specified scope", async () => {
        addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

        await expect(
          Effect.runPromise(
            service.updateTemplate("feature.md", makeTemplate("FEATURE"), "issue", "local")
          )
        ).rejects.toThrow("Local issue template 'feature.md' not found");
      });
    });

    describe("deleteTemplate with scope parameter", () => {
      it("should delete local template by default", async () => {
        addTemplate(config.localIssueTemplatesPath, "custom.md", makeTemplate("FEATURE"));

        await Effect.runPromise(service.deleteTemplate("custom.md"));

        expect(mockFileSystem.unlink).toHaveBeenCalledWith(
          "/repo/.track/templates/issues/custom.md"
        );
      });

      it("should delete global template when scope=global", async () => {
        addTemplate(config.globalIssueTemplatesPath, "custom.md", makeTemplate("FEATURE"));

        await Effect.runPromise(service.deleteTemplate("custom.md", "issue", "global"));

        expect(mockFileSystem.unlink).toHaveBeenCalledWith(
          "/global/config/templates/issues/custom.md"
        );
      });

      it("should throw if template not found at specified scope", async () => {
        addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

        await expect(
          Effect.runPromise(service.deleteTemplate("feature.md", "issue", "local"))
        ).rejects.toThrow("Local issue template 'feature.md' not found");
      });
    });

    describe("copyTemplate", () => {
      it("should copy template from global to local", async () => {
        const content = makeTemplate("FEATURE", "MEDIUM");
        addTemplate(config.globalIssueTemplatesPath, "feature.md", content);

        const result = await Effect.runPromise(
          service.copyTemplate("feature.md", "issue", "global", "local")
        );

        expect(result.filename).toBe("feature.md");
        expect(result.isUserDefined).toBe(true);
        expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
          "/repo/.track/templates/issues/feature.md",
          content
        );
      });

      it("should copy template from local to global", async () => {
        const content = makeTemplate("FEATURE", "HIGH");
        addTemplate(config.localIssueTemplatesPath, "custom.md", content);

        const result = await Effect.runPromise(
          service.copyTemplate("custom.md", "issue", "local", "global")
        );

        expect(result.filename).toBe("custom.md");
        expect(result.isUserDefined).toBe(false);
        expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
          "/global/config/templates/issues/custom.md",
          content
        );
      });

      it("should throw if source template not found", async () => {
        await expect(
          Effect.runPromise(service.copyTemplate("nonexistent.md", "issue", "global", "local"))
        ).rejects.toThrow("Global issue template 'nonexistent.md' not found");
      });

      it("should throw if destination already exists", async () => {
        addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));
        addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "HIGH"));

        await expect(
          Effect.runPromise(service.copyTemplate("feature.md", "issue", "global", "local"))
        ).rejects.toThrow("Local issue template 'feature.md' already exists");
      });

      it("should throw if trying to copy to same scope", () => {
        addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

        expect(() => service.copyTemplate("feature.md", "issue", "local", "local")).toThrow(
          "Cannot copy template to the same scope"
        );
      });

      it("should work with task templates", async () => {
        const content = makeTemplate("TASK", "LOW");
        addTemplate(config.globalTaskTemplatesPath, "task.md", content);

        const result = await Effect.runPromise(
          service.copyTemplate("task.md", "task", "global", "local")
        );

        expect(result.filename).toBe("task.md");
        expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
          "/repo/.track/templates/tasks/task.md",
          content
        );
      });
    });
  });
});
