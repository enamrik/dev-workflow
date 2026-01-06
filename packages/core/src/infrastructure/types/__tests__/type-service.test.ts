/**
 * Type Service Tests
 *
 * Tests the type parsing and intelligent type assignment from ./track/types.md
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FileSystem } from "../../file-system/file-system.js";
import { TypeService, type TypeServiceConfig } from "../type-service.js";
import { DEFAULT_TYPE_DEFINITIONS } from "../../../domain/type-definition.js";

// Sample types.md content
const SAMPLE_TYPES_MD = `# Issue Types

This file defines the issue types.

## FEATURE

New functionality that doesn't exist yet. Adding new capabilities.

## BUG

Something is broken or not working as expected. Error handling.

## ENHANCEMENT

Improvement to existing functionality. Optimization and refactoring.

## TASK

Technical work, chores, maintenance. Setup and configuration.
`;

// Partial types.md (only some types defined)
const PARTIAL_TYPES_MD = `## BUG

Critical errors and crashes that need immediate attention.

## FEATURE

Adding new user-facing functionality.
`;

// Invalid types.md (invalid type name)
const INVALID_TYPES_MD = `## FEATURE

Valid feature type.

## INVALID_TYPE

This type name is not valid.

## bug

Lowercase type names are invalid.
`;

describe("TypeService", () => {
  let mockFileSystem: FileSystem;
  let config: TypeServiceConfig;
  let service: TypeService;
  let fileContents: Map<string, string>;

  beforeEach(() => {
    fileContents = new Map();

    mockFileSystem = {
      exists: vi.fn().mockImplementation(async (path: string) => {
        return fileContents.has(path);
      }),
      readFile: vi.fn().mockImplementation(async (path: string) => {
        const content = fileContents.get(path);
        if (!content) throw new Error(`File not found: ${path}`);
        return content;
      }),
      writeFile: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdirWithFileTypes: vi.fn().mockResolvedValue([]),
    };

    config = {
      localTypesPath: "/repo/track/types.md",
      globalTypesPath: "/global/config/types.md",
    };

    service = new TypeService(mockFileSystem, config);
  });

  describe("loadTypes", () => {
    it("should return default types when no types.md exists", async () => {
      const result = await service.loadTypes();

      expect(result.isUserDefined).toBe(false);
      expect(result.types).toEqual(DEFAULT_TYPE_DEFINITIONS);
    });

    it("should load types from local types.md when present", async () => {
      fileContents.set("/repo/track/types.md", SAMPLE_TYPES_MD);

      const result = await service.loadTypes();

      expect(result.isUserDefined).toBe(true);
      expect(result.types).toHaveLength(4);
      expect(result.types.map((t) => t.name)).toEqual(["FEATURE", "BUG", "ENHANCEMENT", "TASK"]);
    });

    it("should fall back to global types.md when local not present", async () => {
      fileContents.set("/global/config/types.md", SAMPLE_TYPES_MD);

      const result = await service.loadTypes();

      expect(result.isUserDefined).toBe(true);
      expect(result.types).toHaveLength(4);
    });

    it("should prefer local types.md over global", async () => {
      fileContents.set("/repo/track/types.md", PARTIAL_TYPES_MD);
      fileContents.set("/global/config/types.md", SAMPLE_TYPES_MD);

      const result = await service.loadTypes();

      // Local only has BUG and FEATURE
      expect(result.types).toHaveLength(2);
      expect(result.types.map((t) => t.name)).toEqual(["BUG", "FEATURE"]);
    });

    it("should cache types after first load", async () => {
      fileContents.set("/repo/track/types.md", SAMPLE_TYPES_MD);

      await service.loadTypes();
      await service.loadTypes();

      // readFile should only be called once
      expect(mockFileSystem.readFile).toHaveBeenCalledTimes(1);
    });

    it("should reload types after clearCache", async () => {
      fileContents.set("/repo/track/types.md", SAMPLE_TYPES_MD);

      await service.loadTypes();
      service.clearCache();
      await service.loadTypes();

      expect(mockFileSystem.readFile).toHaveBeenCalledTimes(2);
    });

    it("should only parse valid type names", async () => {
      fileContents.set("/repo/track/types.md", INVALID_TYPES_MD);

      const result = await service.loadTypes();

      // Only FEATURE should be parsed (INVALID_TYPE and lowercase 'bug' are invalid)
      expect(result.types).toHaveLength(1);
      expect(result.types[0].name).toBe("FEATURE");
    });

    it("should extract keywords from descriptions", async () => {
      fileContents.set("/repo/track/types.md", SAMPLE_TYPES_MD);

      const result = await service.loadTypes();

      const bugType = result.types.find((t) => t.name === "BUG");
      expect(bugType).toBeDefined();
      expect(bugType!.keywords).toContain("broken");
      expect(bugType!.keywords).toContain("working");
      expect(bugType!.keywords).toContain("error");
    });
  });

  describe("selectType", () => {
    it("should select BUG for descriptions mentioning bugs", async () => {
      const result = await service.selectType("There is a bug in the login system");
      expect(result).toBe("BUG");
    });

    it("should select BUG for descriptions mentioning errors", async () => {
      const result = await service.selectType("Error when saving user data");
      expect(result).toBe("BUG");
    });

    it("should select ENHANCEMENT for descriptions mentioning improvements", async () => {
      const result = await service.selectType("Improve the search performance");
      expect(result).toBe("ENHANCEMENT");
    });

    it("should select TASK for descriptions mentioning chores", async () => {
      const result = await service.selectType("Setup CI/CD pipeline");
      expect(result).toBe("TASK");
    });

    it("should default to FEATURE when no match", async () => {
      const result = await service.selectType("Build a new dashboard widget");
      expect(result).toBe("FEATURE");
    });

    it("should use custom types when types.md is present", async () => {
      // Custom types.md with different keywords
      const customTypes = `## BUG

Critical errors, data loss, security vulnerabilities.

## FEATURE

User-facing additions, new screens, new APIs.
`;
      fileContents.set("/repo/track/types.md", customTypes);

      // "critical" should match BUG with custom types (extracted as keyword)
      const result = await service.selectType("Critical application failure");
      expect(result).toBe("BUG");
    });

    it("should handle case-insensitive matching", async () => {
      const result = await service.selectType("BUG: Login fails silently");
      expect(result).toBe("BUG");
    });

    it("should prefer higher keyword matches", async () => {
      // Description mentions both "improve" and "broken" - should pick the one with more matches
      const result = await service.selectType("The broken feature needs fixing");
      expect(result).toBe("BUG"); // "broken" is a BUG keyword
    });
  });

  describe("graceful degradation", () => {
    it("should return defaults when file read fails", async () => {
      mockFileSystem.readFile = vi.fn().mockRejectedValue(new Error("Permission denied"));
      fileContents.set("/repo/track/types.md", "exists"); // exists but can't be read

      const result = await service.loadTypes();

      expect(result.isUserDefined).toBe(false);
      expect(result.types).toEqual(DEFAULT_TYPE_DEFINITIONS);
    });

    it("should return defaults for empty types.md", async () => {
      fileContents.set("/repo/track/types.md", "");

      const result = await service.loadTypes();

      expect(result.isUserDefined).toBe(false);
      expect(result.types).toEqual(DEFAULT_TYPE_DEFINITIONS);
    });

    it("should return defaults for types.md with no valid types", async () => {
      fileContents.set("/repo/track/types.md", "# Just a header\n\nSome text without types.");

      const result = await service.loadTypes();

      expect(result.isUserDefined).toBe(false);
      expect(result.types).toEqual(DEFAULT_TYPE_DEFINITIONS);
    });
  });
});
