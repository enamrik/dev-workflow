/**
 * Type Tools Integration Tests
 *
 * Tests actual MCP tool handlers with real TypeService backed by database.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TypeService } from "@dev-workflow/core";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import { handleListTypes, type TypeToolContext } from "../../tools/type-tools.js";
import {
  ListTypesSchema,
  CreateTypeSchema,
  UpdateTypeSchema,
  DeleteTypeSchema,
} from "../../tools/schemas.js";

/**
 * Test database instance
 */
let testDb: TestDatabase;

/**
 * Create a TypeToolContext for testing
 */
function createTypeToolContext(testDb: TestDatabase): TypeToolContext {
  const typeService = new TypeService(testDb.source.types);

  return {
    typeService,
  };
}

describe("Type Tools Integration", () => {
  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("handleListTypes", () => {
    it("should return default types when database is empty", async () => {
      const ctx = createTypeToolContext(testDb);

      const result = await handleListTypes(ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.types).toBeDefined();
      expect(content.types.length).toBeGreaterThan(0);

      // Check default types are present
      const typeNames = content.types.map((t: { name: string }) => t.name);
      expect(typeNames).toContain("FEATURE");
      expect(typeNames).toContain("BUG");
      expect(typeNames).toContain("ENHANCEMENT");
      expect(typeNames).toContain("TASK");
    });

    it("should return database types when seeded", async () => {
      // Seed types using testDb.source.types
      testDb.source.types.create({
        name: "CUSTOM",
        displayName: "Custom",
        description: "Custom type for testing",
        keywords: ["custom"],
      });

      const ctx = createTypeToolContext(testDb);
      const result = await handleListTypes(ctx);

      const content = JSON.parse(result.content[0].text);

      // Should only have the custom type
      expect(content.types).toHaveLength(1);
      expect(content.types[0].name).toBe("CUSTOM");
    });

    it("should include name, description, and remoteLabel for each type", async () => {
      const ctx = createTypeToolContext(testDb);

      const result = await handleListTypes(ctx);

      const content = JSON.parse(result.content[0].text);

      for (const type of content.types) {
        expect(type.name).toBeDefined();
        expect(type.description).toBeDefined();
        expect(type.remoteLabel).toBeDefined();
      }

      // Check specific type details (from defaults)
      const featureType = content.types.find((t: { name: string }) => t.name === "FEATURE");
      expect(featureType).toBeDefined();
      expect(featureType.remoteLabel).toBe("feature");

      const bugType = content.types.find((t: { name: string }) => t.name === "BUG");
      expect(bugType).toBeDefined();
      expect(bugType.remoteLabel).toBe("bug");
    });

    it("should include helpful message about usage", async () => {
      const ctx = createTypeToolContext(testDb);

      const result = await handleListTypes(ctx);

      const content = JSON.parse(result.content[0].text);

      expect(content.message).toBeDefined();
      expect(content.message).toContain("type");
      expect(content.message).toContain("generate_plan");
    });
  });
});

/**
 * Schema Validation Tests for Type Tools
 */
describe("Type Tool Schema Validation", () => {
  describe("ListTypesSchema", () => {
    it("should accept empty object", () => {
      const result = ListTypesSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("CreateTypeSchema", () => {
    it("should accept valid type creation", () => {
      const input = {
        name: "EPIC",
        displayName: "Epic",
        description: "Large feature spanning multiple issues",
      };
      const result = CreateTypeSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept optional fields", () => {
      const input = {
        name: "EPIC",
        displayName: "Epic",
        description: "Large feature",
        keywords: ["epic", "large"],
        color: "#ff0000",
      };
      const result = CreateTypeSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject missing name", () => {
      const input = {
        displayName: "Epic",
        description: "Large feature",
      };
      const result = CreateTypeSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing displayName", () => {
      const input = {
        name: "EPIC",
        description: "Large feature",
      };
      const result = CreateTypeSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing description", () => {
      const input = {
        name: "EPIC",
        displayName: "Epic",
      };
      const result = CreateTypeSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("UpdateTypeSchema", () => {
    it("should accept valid type update", () => {
      const input = {
        name: "FEATURE",
        updates: { displayName: "New Feature" },
      };
      const result = UpdateTypeSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept all update fields", () => {
      const input = {
        name: "FEATURE",
        updates: {
          displayName: "New Feature",
          description: "Updated description",
          keywords: ["new", "keywords"],
          color: "#00ff00",
        },
      };
      const result = UpdateTypeSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept null color to clear it", () => {
      const input = {
        name: "FEATURE",
        updates: { color: null },
      };
      const result = UpdateTypeSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject missing name", () => {
      const input = {
        updates: { displayName: "New" },
      };
      const result = UpdateTypeSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing updates", () => {
      const input = { name: "FEATURE" };
      const result = UpdateTypeSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("DeleteTypeSchema", () => {
    it("should accept valid type name", () => {
      const result = DeleteTypeSchema.safeParse({ name: "CUSTOM" });
      expect(result.success).toBe(true);
    });

    it("should reject missing name", () => {
      const result = DeleteTypeSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
