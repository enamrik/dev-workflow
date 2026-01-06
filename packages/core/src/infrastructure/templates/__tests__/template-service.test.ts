/**
 * Template Service Tests
 *
 * Tests the cascading template resolution logic:
 * 1. Local per-type: ./.track/templates/issues/<type>.md
 * 2. Local all.md: ./.track/templates/issues/all.md
 * 3. Global per-type: ~/.track/config/templates/issues/<type>.md
 * 4. Global all.md: ~/.track/config/templates/issues/all.md
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Dirent } from "node:fs";
import type { FileSystem } from "../../file-system/file-system.js";
import { TemplateService, type TemplateServiceConfig } from "../template-service.js";

// Valid template content for testing
const makeTemplate = (type: string, priority: string = "MEDIUM") => `---
type: ${type}
priority: ${priority}
---

# ${type} Template

Description goes here.
`;

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
      const result = await service.discoverTemplates();

      expect(result.userTemplates).toEqual([]);
      expect(result.defaultTemplates).toEqual([]);
      expect(result.merged).toEqual([]);
    });

    it("should discover local templates", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      const result = await service.discoverTemplates();

      expect(result.userTemplates).toHaveLength(1);
      expect(result.userTemplates[0]?.filename).toBe("feature.md");
      expect(result.userTemplates[0]?.isUserDefined).toBe(true);
    });

    it("should discover global templates", async () => {
      addTemplate(config.globalIssueTemplatesPath, "bug.md", makeTemplate("BUG"));

      const result = await service.discoverTemplates();

      expect(result.defaultTemplates).toHaveLength(1);
      expect(result.defaultTemplates[0]?.filename).toBe("bug.md");
      expect(result.defaultTemplates[0]?.isUserDefined).toBe(false);
    });

    it("should merge local and global templates", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));
      addTemplate(config.globalIssueTemplatesPath, "bug.md", makeTemplate("BUG"));

      const result = await service.discoverTemplates();

      expect(result.merged).toHaveLength(2);
      expect(result.merged.map((t) => t.filename).sort()).toEqual(["bug.md", "feature.md"]);
    });

    it("should have local templates override global templates by filename", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "HIGH"));
      addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));

      const result = await service.discoverTemplates();

      expect(result.merged).toHaveLength(1);
      expect(result.merged[0]?.metadata.priority).toBe("HIGH");
      expect(result.merged[0]?.isUserDefined).toBe(true);
    });

    it("should cache results", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      await service.discoverTemplates();
      await service.discoverTemplates();

      // readdirWithFileTypes should only be called twice (once per directory)
      expect(mockFileSystem.readdirWithFileTypes).toHaveBeenCalledTimes(2);
    });

    it("should clear cache when clearCache() is called", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      await service.discoverTemplates();
      service.clearCache();
      await service.discoverTemplates();

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

        const result = await service.selectTemplate("Add new feature");

        expect(result.metadata.priority).toBe("HIGH");
        expect(result.isUserDefined).toBe(true);
        expect(result.filename).toBe("feature.md");
      });

      it("should fall back to local all.md when local per-type not found (priority 2)", async () => {
        addTemplate(config.localIssueTemplatesPath, "all.md", makeTemplate("TASK", "HIGH"));
        addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));
        addTemplate(config.globalIssueTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await service.selectTemplate("Add new feature");

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

        const result = await service.selectTemplate("Add new feature");

        expect(result.metadata.priority).toBe("MEDIUM");
        expect(result.isUserDefined).toBe(false);
        expect(result.filename).toBe("feature.md");
      });

      it("should fall back to global all.md as last resort (priority 4)", async () => {
        addTemplate(config.globalIssueTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await service.selectTemplate("Add new feature");

        expect(result.metadata.priority).toBe("LOW");
        expect(result.isUserDefined).toBe(false);
        expect(result.filename).toBe("all.md");
      });

      it("should throw when no templates available", async () => {
        await expect(service.selectTemplate("Add new feature")).rejects.toThrow(
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
          const result = await service.selectTemplate(`Fix ${keyword} in login`);
          expect(result.filename).toBe("bug.md");
        }
      });

      it("should detect enhancement template from keywords", async () => {
        const keywords = ["enhance", "improve", "optimize", "better"];
        for (const keyword of keywords) {
          service.clearCache();
          const result = await service.selectTemplate(`${keyword} performance`);
          expect(result.filename).toBe("enhancement.md");
        }
      });

      it("should detect task template from keywords", async () => {
        const keywords = ["task", "chore", "setup"];
        for (const keyword of keywords) {
          service.clearCache();
          const result = await service.selectTemplate(`${keyword} CI pipeline`);
          expect(result.filename).toBe("task.md");
        }
      });

      it("should default to feature template", async () => {
        const result = await service.selectTemplate("Add user authentication");
        expect(result.filename).toBe("feature.md");
      });
    });
  });

  describe("getTaskTemplate - per-type task template resolution", () => {
    it("should return null when no task templates exist", async () => {
      const result = await service.getTaskTemplate();
      expect(result).toBeNull();
    });

    it("should return null when no task templates exist (with type)", async () => {
      const result = await service.getTaskTemplate("FEATURE");
      expect(result).toBeNull();
    });

    describe("Resolution Order: local per-type -> local all.md -> global per-type -> global all.md", () => {
      it("should prefer local per-type template (priority 1)", async () => {
        addTemplate(config.localTaskTemplatesPath, "feature.md", makeTemplate("FEATURE", "HIGH"));
        addTemplate(config.localTaskTemplatesPath, "all.md", makeTemplate("TASK", "MEDIUM"));
        addTemplate(config.globalTaskTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));
        addTemplate(config.globalTaskTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await service.getTaskTemplate("FEATURE");

        expect(result?.metadata.priority).toBe("HIGH");
        expect(result?.isUserDefined).toBe(true);
        expect(result?.filename).toBe("feature.md");
      });

      it("should fall back to local all.md when local per-type not found (priority 2)", async () => {
        addTemplate(config.localTaskTemplatesPath, "all.md", makeTemplate("TASK", "HIGH"));
        addTemplate(config.globalTaskTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));
        addTemplate(config.globalTaskTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await service.getTaskTemplate("FEATURE");

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

        const result = await service.getTaskTemplate("FEATURE");

        expect(result?.metadata.priority).toBe("MEDIUM");
        expect(result?.isUserDefined).toBe(false);
        expect(result?.filename).toBe("feature.md");
      });

      it("should fall back to global all.md as last resort (priority 4)", async () => {
        addTemplate(config.globalTaskTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await service.getTaskTemplate("FEATURE");

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
        const result = await service.getTaskTemplate("FEATURE");
        expect(result?.filename).toBe("feature.md");
      });

      it("should select BUG template for BUG type", async () => {
        const result = await service.getTaskTemplate("BUG");
        expect(result?.filename).toBe("bug.md");
      });

      it("should select ENHANCEMENT template for ENHANCEMENT type", async () => {
        const result = await service.getTaskTemplate("ENHANCEMENT");
        expect(result?.filename).toBe("enhancement.md");
      });

      it("should select TASK template for TASK type", async () => {
        const result = await service.getTaskTemplate("TASK");
        expect(result?.filename).toBe("task.md");
      });

      it("should handle lowercase type names", async () => {
        const result = await service.getTaskTemplate("feature");
        expect(result?.filename).toBe("feature.md");
      });
    });

    describe("Backward compatibility (no type)", () => {
      it("should return local all.md when no type specified", async () => {
        addTemplate(config.localTaskTemplatesPath, "all.md", makeTemplate("TASK", "HIGH"));
        addTemplate(config.globalTaskTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await service.getTaskTemplate();

        expect(result?.metadata.priority).toBe("HIGH");
        expect(result?.isUserDefined).toBe(true);
      });

      it("should fall back to global all.md when no type specified and local not found", async () => {
        addTemplate(config.globalTaskTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await service.getTaskTemplate();

        expect(result?.metadata.priority).toBe("LOW");
        expect(result?.isUserDefined).toBe(false);
      });

      it("should skip per-type when no type specified", async () => {
        addTemplate(config.localTaskTemplatesPath, "feature.md", makeTemplate("FEATURE", "HIGH"));
        addTemplate(config.globalTaskTemplatesPath, "all.md", makeTemplate("TASK", "LOW"));

        const result = await service.getTaskTemplate();

        // Should skip feature.md and use global all.md since no type was provided
        expect(result?.metadata.priority).toBe("LOW");
        expect(result?.filename).toBe("all.md");
      });
    });
  });

  describe("getTemplateByFilename", () => {
    it("should return template by filename", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      const result = await service.getTemplateByFilename("feature.md");

      expect(result).not.toBeNull();
      expect(result?.filename).toBe("feature.md");
    });

    it("should return null for non-existent template", async () => {
      const result = await service.getTemplateByFilename("nonexistent.md");
      expect(result).toBeNull();
    });
  });

  describe("getTemplate - with source info", () => {
    it("should return user source for local template", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      const result = await service.getTemplate("feature.md");

      expect(result).not.toBeNull();
      expect(result?.source).toBe("user");
    });

    it("should return default source for global template", async () => {
      addTemplate(config.globalIssueTemplatesPath, "bug.md", makeTemplate("BUG"));

      const result = await service.getTemplate("bug.md");

      expect(result).not.toBeNull();
      expect(result?.source).toBe("default");
    });

    it("should prefer user over default when both exist", async () => {
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "HIGH"));
      addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));

      const result = await service.getTemplate("feature.md");

      expect(result?.source).toBe("user");
      expect(result?.template.metadata.priority).toBe("HIGH");
    });
  });

  describe("createTemplate", () => {
    it("should create a new user template", async () => {
      const content = makeTemplate("FEATURE");

      const result = await service.createTemplate("custom.md", content);

      expect(result.filename).toBe("custom.md");
      expect(result.isUserDefined).toBe(true);
      expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
        "/repo/.track/templates/issues/custom.md",
        content
      );
    });

    it("should throw if filename does not end with .md", async () => {
      await expect(service.createTemplate("custom.txt", makeTemplate("FEATURE"))).rejects.toThrow(
        "must end with .md"
      );
    });

    it("should throw if user template already exists", async () => {
      addTemplate(config.localIssueTemplatesPath, "existing.md", makeTemplate("FEATURE"));

      await expect(service.createTemplate("existing.md", makeTemplate("FEATURE"))).rejects.toThrow(
        "already exists"
      );
    });

    it("should allow creating user template that overrides default", async () => {
      addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE", "LOW"));

      const content = makeTemplate("FEATURE", "HIGH");
      const result = await service.createTemplate("feature.md", content);

      expect(result.metadata.priority).toBe("HIGH");
    });

    it("should create templates directory if it does not exist", async () => {
      // Remove directory from mock
      directoryContents.delete(config.localIssueTemplatesPath);

      const content = makeTemplate("FEATURE");
      await service.createTemplate("custom.md", content);

      expect(mockFileSystem.mkdir).toHaveBeenCalledWith(config.localIssueTemplatesPath, {
        recursive: true,
      });
    });
  });

  describe("updateTemplate", () => {
    it("should update an existing user template", async () => {
      addTemplate(config.localIssueTemplatesPath, "custom.md", makeTemplate("FEATURE", "LOW"));

      const newContent = makeTemplate("FEATURE", "HIGH");
      const result = await service.updateTemplate("custom.md", newContent);

      expect(result.metadata.priority).toBe("HIGH");
      expect(mockFileSystem.writeFile).toHaveBeenCalledWith(
        "/repo/.track/templates/issues/custom.md",
        newContent
      );
    });

    it("should throw if template does not exist", async () => {
      await expect(
        service.updateTemplate("nonexistent.md", makeTemplate("FEATURE"))
      ).rejects.toThrow("not found");
    });

    it("should throw if trying to update default template", async () => {
      addTemplate(config.globalIssueTemplatesPath, "default.md", makeTemplate("FEATURE"));

      await expect(
        service.updateTemplate("default.md", makeTemplate("FEATURE", "HIGH"))
      ).rejects.toThrow("Cannot modify default template");
    });
  });

  describe("deleteTemplate", () => {
    it("should delete a user template", async () => {
      addTemplate(config.localIssueTemplatesPath, "custom.md", makeTemplate("FEATURE"));

      await service.deleteTemplate("custom.md");

      expect(mockFileSystem.unlink).toHaveBeenCalledWith("/repo/.track/templates/issues/custom.md");
    });

    it("should throw if template does not exist", async () => {
      await expect(service.deleteTemplate("nonexistent.md")).rejects.toThrow("not found");
    });

    it("should throw if trying to delete default template", async () => {
      addTemplate(config.globalIssueTemplatesPath, "default.md", makeTemplate("FEATURE"));

      await expect(service.deleteTemplate("default.md")).rejects.toThrow(
        "Cannot delete default template"
      );
    });
  });

  describe("graceful degradation", () => {
    it("should handle missing local templates directory gracefully", async () => {
      directoryContents.delete(config.localIssueTemplatesPath);
      addTemplate(config.globalIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      const result = await service.discoverTemplates();

      expect(result.userTemplates).toEqual([]);
      expect(result.defaultTemplates).toHaveLength(1);
    });

    it("should handle missing global templates directory gracefully", async () => {
      directoryContents.delete(config.globalIssueTemplatesPath);
      addTemplate(config.localIssueTemplatesPath, "feature.md", makeTemplate("FEATURE"));

      const result = await service.discoverTemplates();

      expect(result.userTemplates).toHaveLength(1);
      expect(result.defaultTemplates).toEqual([]);
    });

    it("should skip invalid template files and continue", async () => {
      addTemplate(config.localIssueTemplatesPath, "valid.md", makeTemplate("FEATURE"));
      addTemplate(config.localIssueTemplatesPath, "invalid.md", "no frontmatter here");

      const result = await service.discoverTemplates();

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

      const result = await service.discoverTemplates();

      expect(result.userTemplates).toHaveLength(1);
      expect(result.userTemplates[0]?.filename).toBe("feature.md");
    });
  });
});
