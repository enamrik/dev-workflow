/**
 * Type Tools Integration Tests
 *
 * Tests actual MCP tool handlers with real TypeService backed by database.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TypeService, SqliteTypeRepository } from "@dev-workflow/core";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import { handleListTypes, type TypeToolContext } from "../../tools/type-tools.js";

/**
 * Test database instance
 */
let testDb: TestDatabase;

/**
 * Create a TypeToolContext for testing
 */
function createTypeToolContext(db: TestDatabase["db"]): TypeToolContext {
  const typeRepository = new SqliteTypeRepository(db);
  const typeService = new TypeService(typeRepository);

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
      const ctx = createTypeToolContext(testDb.db);

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
      // Seed types
      const typeRepository = new SqliteTypeRepository(testDb.db);
      typeRepository.create({
        name: "CUSTOM",
        displayName: "Custom",
        description: "Custom type for testing",
        keywords: ["custom"],
      });

      const ctx = createTypeToolContext(testDb.db);
      const result = await handleListTypes(ctx);

      const content = JSON.parse(result.content[0].text);

      // Should only have the custom type
      expect(content.types).toHaveLength(1);
      expect(content.types[0].name).toBe("CUSTOM");
    });

    it("should include name, description, and remoteLabel for each type", async () => {
      const ctx = createTypeToolContext(testDb.db);

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
      const ctx = createTypeToolContext(testDb.db);

      const result = await handleListTypes(ctx);

      const content = JSON.parse(result.content[0].text);

      expect(content.message).toBeDefined();
      expect(content.message).toContain("type");
      expect(content.message).toContain("generate_plan");
    });
  });
});
