/**
 * Type Service Tests
 *
 * Tests the type management service backed by the database.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/setup.js";
import { createRepositories } from "../../../__tests__/helpers.js";
import { TypeService } from "../type-service.js";
import { DEFAULT_TYPE_DEFINITIONS } from "../../../domain/type-definition.js";

describe("TypeService", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let service: TypeService;

  beforeEach(() => {
    testDb = createTestDatabase();
    const repos = createRepositories(testDb.db);
    service = new TypeService(repos.typeRepository);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("loadTypes", () => {
    it("should return default types when no types in database", async () => {
      const result = await service.loadTypes();

      expect(result.isUserDefined).toBe(false);
      expect(result.types).toEqual(DEFAULT_TYPE_DEFINITIONS);
    });

    it("should load types from database when present", async () => {
      const repos = createRepositories(testDb.db);
      repos.typeRepository.create({
        name: "FEATURE",
        displayName: "Feature",
        description: "New functionality",
        keywords: ["feature", "new"],
      });
      repos.typeRepository.create({
        name: "BUG",
        displayName: "Bug",
        description: "Something broken",
        keywords: ["bug", "broken"],
      });

      // Need a new service instance to bypass cache
      const freshService = new TypeService(repos.typeRepository);
      const result = await freshService.loadTypes();

      expect(result.isUserDefined).toBe(true);
      expect(result.types).toHaveLength(2);
      expect(result.types.map((t) => t.name)).toContain("FEATURE");
      expect(result.types.map((t) => t.name)).toContain("BUG");
    });

    it("should cache types after first load", async () => {
      const repos = createRepositories(testDb.db);
      repos.typeRepository.create({
        name: "TEST",
        displayName: "Test",
        description: "Test type",
      });

      const result1 = await service.loadTypes();
      const result2 = await service.loadTypes();

      expect(result1).toBe(result2); // Same object reference (cached)
    });

    it("should reload types after clearCache", async () => {
      const repos = createRepositories(testDb.db);

      // First load returns defaults
      const result1 = await service.loadTypes();
      expect(result1.types).toEqual(DEFAULT_TYPE_DEFINITIONS);

      // Add a type
      repos.typeRepository.create({
        name: "NEW",
        displayName: "New",
        description: "New type",
      });

      // Clear cache and reload
      service.clearCache();
      const result2 = await service.loadTypes();

      expect(result2.types).toHaveLength(1);
      expect(result2.types[0]!.name).toBe("NEW");
    });
  });

  describe("selectType", () => {
    beforeEach(() => {
      // Seed default types for selection tests
      const repos = createRepositories(testDb.db);
      for (const typeDef of DEFAULT_TYPE_DEFINITIONS) {
        repos.typeRepository.create({
          name: typeDef.name,
          displayName: typeDef.name.charAt(0) + typeDef.name.slice(1).toLowerCase(),
          description: typeDef.description,
          keywords: typeDef.keywords,
        });
      }
      service.clearCache();
    });

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

    it("should select SPIKE for descriptions mentioning research or investigation", async () => {
      expect(await service.selectType("Research OAuth providers")).toBe("SPIKE");
      expect(await service.selectType("Investigate performance bottleneck")).toBe("SPIKE");
      expect(await service.selectType("Spike to explore caching options")).toBe("SPIKE");
      expect(await service.selectType("Prototype different API approaches")).toBe("SPIKE");
    });

    it("should default to FEATURE when no match", async () => {
      const result = await service.selectType("Build a new dashboard widget");
      expect(result).toBe("FEATURE");
    });

    it("should handle case-insensitive matching", async () => {
      const result = await service.selectType("BUG: Login fails silently");
      expect(result).toBe("BUG");
    });
  });

  describe("getTypes", () => {
    it("should return default types when database is empty", async () => {
      const types = await service.getTypes();

      expect(types).toEqual(DEFAULT_TYPE_DEFINITIONS);
    });

    it("should return database types when present", async () => {
      const repos = createRepositories(testDb.db);
      repos.typeRepository.create({
        name: "CUSTOM",
        displayName: "Custom",
        description: "Custom type",
        keywords: ["custom"],
      });

      service.clearCache();
      const types = await service.getTypes();

      expect(types).toHaveLength(1);
      expect(types[0]!.name).toBe("CUSTOM");
    });
  });

  describe("isValidType", () => {
    beforeEach(() => {
      const repos = createRepositories(testDb.db);
      repos.typeRepository.create({
        name: "FEATURE",
        displayName: "Feature",
        description: "New functionality",
      });
      repos.typeRepository.create({
        name: "BUG",
        displayName: "Bug",
        description: "Something broken",
      });
      service.clearCache();
    });

    it("should return true for valid types", async () => {
      expect(await service.isValidType("FEATURE")).toBe(true);
      expect(await service.isValidType("BUG")).toBe(true);
    });

    it("should return false for invalid types", async () => {
      expect(await service.isValidType("INVALID")).toBe(false);
      expect(await service.isValidType("feature")).toBe(false); // lowercase
      expect(await service.isValidType("")).toBe(false);
    });
  });

  describe("getTypeByName", () => {
    beforeEach(() => {
      const repos = createRepositories(testDb.db);
      repos.typeRepository.create({
        name: "FEATURE",
        displayName: "Feature",
        description: "New functionality",
        keywords: ["feature", "new"],
      });
      service.clearCache();
    });

    it("should return type definition for valid type", async () => {
      const feature = await service.getTypeByName("FEATURE");

      expect(feature).toBeDefined();
      expect(feature?.name).toBe("FEATURE");
      expect(feature?.description).toBe("New functionality");
      expect(feature?.keywords).toEqual(["feature", "new"]);
      expect(feature?.remoteLabel).toBe("feature");
    });

    it("should return undefined for invalid type", async () => {
      const invalid = await service.getTypeByName("INVALID");
      expect(invalid).toBeUndefined();
    });
  });

  describe("createType", () => {
    it("should create a new type", () => {
      const type = service.createType({
        name: "EPIC",
        displayName: "Epic",
        description: "Large feature spanning multiple issues",
        keywords: ["epic", "large"],
      });

      expect(type.name).toBe("EPIC");
      expect(type.description).toBe("Large feature spanning multiple issues");
      expect(type.keywords).toEqual(["epic", "large"]);
      expect(type.remoteLabel).toBe("epic");
    });

    it("should throw error for invalid type name", () => {
      expect(() =>
        service.createType({
          name: "lowercase",
          displayName: "Lower",
          description: "Invalid",
        })
      ).toThrow("Type name must be uppercase");
    });

    it("should throw error for duplicate type name", () => {
      service.createType({
        name: "DUPLICATE",
        displayName: "Duplicate",
        description: "First",
      });

      expect(() =>
        service.createType({
          name: "DUPLICATE",
          displayName: "Another",
          description: "Second",
        })
      ).toThrow("Type 'DUPLICATE' already exists");
    });

    it("should clear cache after creating type", async () => {
      // Load defaults first
      const beforeCreate = await service.getTypes();
      expect(beforeCreate).toEqual(DEFAULT_TYPE_DEFINITIONS);

      // Create a type - this should clear cache
      service.createType({
        name: "NEW",
        displayName: "New",
        description: "New type",
      });

      // Now we should get the new type from DB
      const afterCreate = await service.getTypes();
      expect(afterCreate).toHaveLength(1);
      expect(afterCreate[0]!.name).toBe("NEW");
    });
  });

  describe("updateType", () => {
    beforeEach(() => {
      service.createType({
        name: "UPDATE",
        displayName: "Update",
        description: "Will be updated",
        keywords: ["update"],
      });
      service.clearCache();
    });

    it("should update type properties", () => {
      const updated = service.updateType("UPDATE", {
        displayName: "Updated Type",
        description: "Has been updated",
        keywords: ["updated", "modified"],
      });

      expect(updated.description).toBe("Has been updated");
      expect(updated.keywords).toEqual(["updated", "modified"]);
    });

    it("should throw error for non-existent type", () => {
      expect(() => service.updateType("NONEXISTENT", { description: "New desc" })).toThrow(
        "Type 'NONEXISTENT' not found"
      );
    });

    it("should clear cache after updating type", async () => {
      const before = await service.getTypeByName("UPDATE");
      expect(before?.description).toBe("Will be updated");

      service.updateType("UPDATE", { description: "Changed" });

      const after = await service.getTypeByName("UPDATE");
      expect(after?.description).toBe("Changed");
    });
  });

  describe("deleteType", () => {
    beforeEach(() => {
      service.createType({
        name: "DELETE",
        displayName: "Delete",
        description: "Will be deleted",
      });
      service.clearCache();
    });

    it("should delete a type", () => {
      const deleted = service.deleteType("DELETE");

      expect(deleted.name).toBe("DELETE");
    });

    it("should remove type from getTypes (falls back to defaults if DB empty)", async () => {
      const before = await service.getTypes();
      expect(before).toHaveLength(1);

      service.deleteType("DELETE");

      // When all user types are deleted, TypeService falls back to default types
      const after = await service.getTypes();
      expect(after).toEqual(DEFAULT_TYPE_DEFINITIONS);
    });

    it("should throw error for non-existent type", () => {
      expect(() => service.deleteType("NONEXISTENT")).toThrow("Type 'NONEXISTENT' not found");
    });

    it("should throw error for already deleted type", () => {
      service.deleteType("DELETE");

      expect(() => service.deleteType("DELETE")).toThrow("Type 'DELETE' is already deleted");
    });
  });

  describe("remoteLabel", () => {
    it("should default remoteLabel to lowercase name", async () => {
      service.createType({
        name: "TECH_DEBT",
        displayName: "Tech Debt",
        description: "Technical debt work",
      });

      const type = await service.getTypeByName("TECH_DEBT");
      expect(type?.remoteLabel).toBe("tech_debt");
    });

    it("should include remoteLabel in default types", async () => {
      const types = await service.getTypes();

      for (const type of types) {
        expect(type.remoteLabel).toBeDefined();
        expect(typeof type.remoteLabel).toBe("string");
      }
    });
  });
});
