import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/setup.js";
import { createRepositories } from "../../../__tests__/helpers.js";
import type { SqliteTypeRepository } from "../type-repository.js";

describe("SqliteTypeRepository", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let typeRepository: SqliteTypeRepository;

  beforeEach(() => {
    testDb = createTestDatabase();
    const repos = createRepositories(testDb.db);
    typeRepository = repos.typeRepository;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("create", () => {
    it("should create a new type", () => {
      const type = typeRepository.create({
        name: "EPIC",
        displayName: "Epic",
        description: "Large feature spanning multiple issues",
        keywords: ["epic", "large", "umbrella"],
        color: "#ff0000",
      });

      expect(type.id).toBeDefined();
      expect(type.name).toBe("EPIC");
      expect(type.displayName).toBe("Epic");
      expect(type.description).toBe("Large feature spanning multiple issues");
      expect(type.keywords).toEqual(["epic", "large", "umbrella"]);
      expect(type.color).toBe("#ff0000");
      expect(type.isDeleted).toBe(false);
      expect(type.createdAt).toBeDefined();
      expect(type.updatedAt).toBeDefined();
    });

    it("should create a type without optional fields", () => {
      const type = typeRepository.create({
        name: "CHORE",
        displayName: "Chore",
        description: "Maintenance work",
      });

      expect(type.name).toBe("CHORE");
      expect(type.keywords).toEqual([]);
      expect(type.color).toBeUndefined();
    });

    it("should throw error if type already exists", () => {
      typeRepository.create({
        name: "DUPLICATE",
        displayName: "Duplicate",
        description: "Test",
      });

      expect(() =>
        typeRepository.create({
          name: "DUPLICATE",
          displayName: "Another",
          description: "Test 2",
        })
      ).toThrow("Type 'DUPLICATE' already exists");
    });
  });

  describe("update", () => {
    it("should update displayName", () => {
      typeRepository.create({
        name: "FEATURE",
        displayName: "Feature",
        description: "New functionality",
      });

      const updated = typeRepository.update("FEATURE", {
        displayName: "New Feature",
      });

      expect(updated.displayName).toBe("New Feature");
    });

    it("should update description", () => {
      typeRepository.create({
        name: "BUG",
        displayName: "Bug",
        description: "Something broken",
      });

      const updated = typeRepository.update("BUG", {
        description: "An issue that needs fixing",
      });

      expect(updated.description).toBe("An issue that needs fixing");
    });

    it("should update keywords", () => {
      typeRepository.create({
        name: "TASK",
        displayName: "Task",
        description: "General work item",
        keywords: ["task"],
      });

      const updated = typeRepository.update("TASK", {
        keywords: ["task", "work", "todo"],
      });

      expect(updated.keywords).toEqual(["task", "work", "todo"]);
    });

    it("should update color", () => {
      typeRepository.create({
        name: "ENHANCEMENT",
        displayName: "Enhancement",
        description: "Improvement",
      });

      const updated = typeRepository.update("ENHANCEMENT", {
        color: "#00ff00",
      });

      expect(updated.color).toBe("#00ff00");
    });

    it("should clear color when set to null", () => {
      typeRepository.create({
        name: "TEST",
        displayName: "Test",
        description: "Test type",
        color: "#0000ff",
      });

      const updated = typeRepository.update("TEST", {
        color: null,
      });

      expect(updated.color).toBeUndefined();
    });

    it("should throw error if type not found", () => {
      expect(() =>
        typeRepository.update("NONEXISTENT", {
          displayName: "New Name",
        })
      ).toThrow("Type 'NONEXISTENT' not found");
    });
  });

  describe("softDelete", () => {
    it("should soft delete a type", () => {
      typeRepository.create({
        name: "DELETEME",
        displayName: "Delete Me",
        description: "Will be deleted",
      });

      const deleted = typeRepository.softDelete("DELETEME");

      expect(deleted.isDeleted).toBe(true);
      expect(deleted.deletedAt).toBeDefined();
    });

    it("should not return soft deleted types by default", () => {
      typeRepository.create({
        name: "VISIBLE",
        displayName: "Visible",
        description: "Should be visible",
      });
      typeRepository.create({
        name: "HIDDEN",
        displayName: "Hidden",
        description: "Should be hidden",
      });

      typeRepository.softDelete("HIDDEN");

      const all = typeRepository.findAll();
      expect(all).toHaveLength(1);
      expect(all[0]!.name).toBe("VISIBLE");
    });

    it("should throw error if type not found", () => {
      expect(() => typeRepository.softDelete("NONEXISTENT")).toThrow(
        "Type 'NONEXISTENT' not found"
      );
    });

    it("should throw error if type already deleted", () => {
      typeRepository.create({
        name: "ALREADYDELETED",
        displayName: "Already Deleted",
        description: "Will fail",
      });
      typeRepository.softDelete("ALREADYDELETED");

      expect(() => typeRepository.softDelete("ALREADYDELETED")).toThrow(
        "Type 'ALREADYDELETED' is already deleted"
      );
    });
  });

  describe("restore", () => {
    it("should restore a soft deleted type", () => {
      typeRepository.create({
        name: "RESTORE",
        displayName: "Restore Me",
        description: "Will be restored",
      });
      typeRepository.softDelete("RESTORE");

      const restored = typeRepository.restore("RESTORE");

      expect(restored.isDeleted).toBe(false);
      expect(restored.deletedAt).toBeUndefined();
    });

    it("should throw error if type not found", () => {
      expect(() => typeRepository.restore("NONEXISTENT")).toThrow("Type 'NONEXISTENT' not found");
    });

    it("should throw error if type not deleted", () => {
      typeRepository.create({
        name: "NOTDELETED",
        displayName: "Not Deleted",
        description: "Not deleted yet",
      });

      expect(() => typeRepository.restore("NOTDELETED")).toThrow(
        "Type 'NOTDELETED' is not deleted"
      );
    });
  });

  describe("findByName", () => {
    it("should find a type by name", () => {
      typeRepository.create({
        name: "FINDME",
        displayName: "Find Me",
        description: "Should be found",
      });

      const found = typeRepository.findByName("FINDME");

      expect(found).not.toBeNull();
      expect(found?.name).toBe("FINDME");
    });

    it("should return null for non-existent type", () => {
      const found = typeRepository.findByName("NOTFOUND");
      expect(found).toBeNull();
    });

    it("should not find deleted types by default", () => {
      typeRepository.create({
        name: "DELETED",
        displayName: "Deleted",
        description: "Is deleted",
      });
      typeRepository.softDelete("DELETED");

      const found = typeRepository.findByName("DELETED");
      expect(found).toBeNull();
    });

    it("should find deleted types with includeDeleted flag", () => {
      typeRepository.create({
        name: "DELETED2",
        displayName: "Deleted",
        description: "Is deleted",
      });
      typeRepository.softDelete("DELETED2");

      const found = typeRepository.findByName("DELETED2", true);
      expect(found).not.toBeNull();
      expect(found?.isDeleted).toBe(true);
    });
  });

  describe("findById", () => {
    it("should find a type by ID", () => {
      const created = typeRepository.create({
        name: "BYID",
        displayName: "By ID",
        description: "Found by ID",
      });

      const found = typeRepository.findById(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it("should return null for non-existent ID", () => {
      const found = typeRepository.findById("non-existent-id");
      expect(found).toBeNull();
    });
  });

  describe("findAll", () => {
    it("should return all non-deleted types", () => {
      typeRepository.create({
        name: "TYPE1",
        displayName: "Type 1",
        description: "First type",
      });
      typeRepository.create({
        name: "TYPE2",
        displayName: "Type 2",
        description: "Second type",
      });
      typeRepository.create({
        name: "TYPE3",
        displayName: "Type 3",
        description: "Third type",
      });
      typeRepository.softDelete("TYPE2");

      const all = typeRepository.findAll();

      expect(all).toHaveLength(2);
      expect(all.map((t) => t.name)).toContain("TYPE1");
      expect(all.map((t) => t.name)).toContain("TYPE3");
      expect(all.map((t) => t.name)).not.toContain("TYPE2");
    });

    it("should include deleted types with flag", () => {
      typeRepository.create({
        name: "ACTIVE",
        displayName: "Active",
        description: "Active type",
      });
      typeRepository.create({
        name: "INACTIVE",
        displayName: "Inactive",
        description: "Inactive type",
      });
      typeRepository.softDelete("INACTIVE");

      const all = typeRepository.findAll(true);

      expect(all).toHaveLength(2);
    });
  });

  describe("findActive", () => {
    it("should return only active types", () => {
      typeRepository.create({
        name: "ACTIVE1",
        displayName: "Active 1",
        description: "Active",
      });
      typeRepository.create({
        name: "ACTIVE2",
        displayName: "Active 2",
        description: "Active",
      });
      typeRepository.create({
        name: "DELETED3",
        displayName: "Deleted",
        description: "Deleted",
      });
      typeRepository.softDelete("DELETED3");

      const active = typeRepository.findActive();

      expect(active).toHaveLength(2);
    });
  });

  describe("hasAny", () => {
    it("should return false for empty table", () => {
      expect(typeRepository.hasAny()).toBe(false);
    });

    it("should return true when types exist", () => {
      typeRepository.create({
        name: "SOMETHING",
        displayName: "Something",
        description: "Exists",
      });

      expect(typeRepository.hasAny()).toBe(true);
    });
  });

  describe("seedTypes", () => {
    it("should seed multiple types", () => {
      typeRepository.seedTypes([
        { name: "FEATURE", displayName: "Feature", description: "New functionality" },
        { name: "BUG", displayName: "Bug", description: "Something broken" },
        { name: "TASK", displayName: "Task", description: "General work" },
      ]);

      const all = typeRepository.findAll();
      expect(all).toHaveLength(3);
    });

    it("should skip existing types when seeding", () => {
      typeRepository.create({
        name: "EXISTING",
        displayName: "Existing",
        description: "Already exists",
      });

      typeRepository.seedTypes([
        { name: "EXISTING", displayName: "New Existing", description: "Should be skipped" },
        { name: "NEW", displayName: "New", description: "New type" },
      ]);

      const existing = typeRepository.findByName("EXISTING");
      expect(existing?.displayName).toBe("Existing"); // Not changed

      const newType = typeRepository.findByName("NEW");
      expect(newType).not.toBeNull();
    });
  });
});
