import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/setup.js";
import { createRepositories, createTestIssue } from "../../../__tests__/helpers.js";

describe("SqliteIssueRepository", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof createRepositories>;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("create", () => {
    it("should create an issue with all fields", () => {
      const issue = repos.issueRepository.create({
        title: "Test Issue",
        description: "Test description",
        type: "FEATURE",
        priority: "HIGH",
        status: "OPEN",
        acceptanceCriteria: ["Criterion 1", "Criterion 2"],
        createdBy: "test-user",
      });

      expect(issue.id).toBeDefined();
      expect(issue.number).toBe(1);
      expect(issue.title).toBe("Test Issue");
      expect(issue.description).toBe("Test description");
      expect(issue.type).toBe("FEATURE");
      expect(issue.priority).toBe("HIGH");
      expect(issue.status).toBe("OPEN");
      expect(issue.acceptanceCriteria).toEqual(["Criterion 1", "Criterion 2"]);
      expect(issue.createdBy).toBe("test-user");
      expect(issue.createdAt).toBeDefined();
      expect(issue.updatedAt).toBeDefined();
    });

    it("should auto-increment issue numbers", () => {
      const issue1 = createTestIssue(repos.issueRepository);
      const issue2 = createTestIssue(repos.issueRepository);
      const issue3 = createTestIssue(repos.issueRepository);

      expect(issue1.number).toBe(1);
      expect(issue2.number).toBe(2);
      expect(issue3.number).toBe(3);
    });
  });

  describe("findById", () => {
    it("should find an issue by ID", () => {
      const created = createTestIssue(repos.issueRepository);
      const found = repos.issueRepository.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.title).toBe(created.title);
    });

    it("should return null for non-existent ID", () => {
      const found = repos.issueRepository.findById("non-existent-id");
      expect(found).toBeNull();
    });
  });

  describe("findByNumber", () => {
    it("should find an issue by number", () => {
      const created = createTestIssue(repos.issueRepository);
      const found = repos.issueRepository.findByNumber(created.number);

      expect(found).toBeDefined();
      expect(found?.number).toBe(created.number);
    });

    it("should return null for non-existent number", () => {
      const found = repos.issueRepository.findByNumber(999);
      expect(found).toBeNull();
    });
  });

  describe("findMany", () => {
    beforeEach(() => {
      // Create test issues
      createTestIssue(repos.issueRepository, { status: "OPEN", type: "FEATURE" });
      createTestIssue(repos.issueRepository, { status: "IN_PROGRESS", type: "BUG" });
      createTestIssue(repos.issueRepository, { status: "CLOSED", type: "FEATURE" });
    });

    it("should return all issues without filters", () => {
      const issues = repos.issueRepository.findMany();
      expect(issues).toHaveLength(3);
    });

    it("should filter by status", () => {
      const openIssues = repos.issueRepository.findMany({ status: "OPEN" });
      expect(openIssues).toHaveLength(1);
      expect(openIssues[0]?.status).toBe("OPEN");
    });

    it("should filter by type", () => {
      const features = repos.issueRepository.findMany({ type: "FEATURE" });
      expect(features).toHaveLength(2);
      features.forEach((issue) => expect(issue.type).toBe("FEATURE"));
    });

    it("should filter by multiple criteria", () => {
      const filtered = repos.issueRepository.findMany({
        status: "OPEN",
        type: "FEATURE",
      });
      expect(filtered).toHaveLength(1);
    });
  });

  describe("update", () => {
    it("should update issue fields", () => {
      const created = createTestIssue(repos.issueRepository);

      const updated = repos.issueRepository.update(created.id, {
        title: "Updated Title",
        status: "IN_PROGRESS",
      });

      expect(updated.title).toBe("Updated Title");
      expect(updated.status).toBe("IN_PROGRESS");
      // updatedAt should be set (may be same as createdAt if update is fast)
      expect(updated.updatedAt).toBeDefined();
    });

    it("should preserve unchanged fields", () => {
      const created = createTestIssue(repos.issueRepository, {
        priority: "HIGH",
      });

      const updated = repos.issueRepository.update(created.id, {
        title: "Updated Title",
      });

      expect(updated.priority).toBe("HIGH");
    });
  });

  describe("getNextIssueNumber", () => {
    it("should return 1 for empty database", () => {
      const nextNumber = repos.issueRepository.getNextIssueNumber();
      expect(nextNumber).toBe(1);
    });

    it("should return next number after existing issues", () => {
      createTestIssue(repos.issueRepository);
      createTestIssue(repos.issueRepository);

      const nextNumber = repos.issueRepository.getNextIssueNumber();
      expect(nextNumber).toBe(3);
    });
  });

  describe("delete (soft delete)", () => {
    it("should soft delete an issue", () => {
      const created = createTestIssue(repos.issueRepository);

      const deleted = repos.issueRepository.delete(created.id, "test-user");

      expect(deleted.isDeleted).toBe(true);
      expect(deleted.deletedAt).toBeDefined();
      expect(deleted.deletedBy).toBe("test-user");
    });

    it("should exclude deleted issues from findMany by default", () => {
      const issue1 = createTestIssue(repos.issueRepository);
      const issue2 = createTestIssue(repos.issueRepository);

      repos.issueRepository.delete(issue1.id, "test-user");

      const issues = repos.issueRepository.findMany();
      expect(issues).toHaveLength(1);
      expect(issues[0]?.id).toBe(issue2.id);
    });

    it("should include deleted issues when includeDeleted is true", () => {
      const issue1 = createTestIssue(repos.issueRepository);
      createTestIssue(repos.issueRepository);

      repos.issueRepository.delete(issue1.id, "test-user");

      const issues = repos.issueRepository.findMany({ includeDeleted: true });
      expect(issues).toHaveLength(2);
    });

    it("should throw when deleting non-existent issue", () => {
      expect(() => repos.issueRepository.delete("non-existent", "test-user")).toThrow(
        "Issue not found"
      );
    });

    it("should throw when deleting already deleted issue", () => {
      const created = createTestIssue(repos.issueRepository);
      repos.issueRepository.delete(created.id, "test-user");

      expect(() => repos.issueRepository.delete(created.id, "test-user")).toThrow(
        "Issue is already deleted"
      );
    });
  });

  describe("restore", () => {
    it("should restore a soft-deleted issue", () => {
      const created = createTestIssue(repos.issueRepository);
      repos.issueRepository.delete(created.id, "test-user");

      const restored = repos.issueRepository.restore(created.id);

      expect(restored.isDeleted).toBe(false);
      expect(restored.deletedAt).toBeUndefined();
      expect(restored.deletedBy).toBeUndefined();
    });

    it("should make restored issue appear in findMany", () => {
      const issue1 = createTestIssue(repos.issueRepository);
      repos.issueRepository.delete(issue1.id, "test-user");

      // Before restore
      let issues = repos.issueRepository.findMany();
      expect(issues).toHaveLength(0);

      // After restore
      repos.issueRepository.restore(issue1.id);
      issues = repos.issueRepository.findMany();
      expect(issues).toHaveLength(1);
    });

    it("should throw when restoring non-existent issue", () => {
      expect(() => repos.issueRepository.restore("non-existent")).toThrow("Issue not found");
    });

    it("should throw when restoring non-deleted issue", () => {
      const created = createTestIssue(repos.issueRepository);

      expect(() => repos.issueRepository.restore(created.id)).toThrow("Issue is not deleted");
    });
  });
});
