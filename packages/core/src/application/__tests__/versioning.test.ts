import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "../../__tests__/setup.js";
import { createRepositories, createServices, createTestScenario } from "../../__tests__/helpers.js";

describe("VersioningService", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof createRepositories>;
  let services: ReturnType<typeof createServices>;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);
    services = createServices(repos);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("createSnapshot", () => {
    it("should capture issue state", () => {
      const scenario = createTestScenario(repos);

      const snapshot = services.versioningService.createSnapshot(
        scenario.issue.number,
        "MANUAL",
        "test"
      );

      expect(snapshot).toBeDefined();
      expect(snapshot.issueNumber).toBe(scenario.issue.number);
      expect(snapshot.issueState.title).toBe(scenario.issue.title);
      expect(snapshot.issueState.description).toBe(scenario.issue.description);
    });

    it("should capture plan state", () => {
      const scenario = createTestScenario(repos);

      const snapshot = services.versioningService.createSnapshot(
        scenario.issue.number,
        "MANUAL",
        "test"
      );

      expect(snapshot.planState).toBeDefined();
      expect(snapshot.planState?.summary).toBe(scenario.plan.summary);
    });

    it("should capture all tasks state", () => {
      const scenario = createTestScenario(repos, { taskCount: 3 });

      const snapshot = services.versioningService.createSnapshot(
        scenario.issue.number,
        "MANUAL",
        "test"
      );

      expect(snapshot.tasksState).toHaveLength(3);
      expect(snapshot.tasksState[0]?.title).toBe(scenario.tasks[0]?.title);
    });

    it("should auto-increment version numbers", () => {
      const scenario = createTestScenario(repos);

      const snapshot1 = services.versioningService.createSnapshot(
        scenario.issue.number,
        "MANUAL",
        "test"
      );
      const snapshot2 = services.versioningService.createSnapshot(
        scenario.issue.number,
        "MANUAL",
        "test"
      );

      expect(snapshot1.version).toBe(1);
      expect(snapshot2.version).toBe(2);
    });

    it("should archive previous snapshots", () => {
      const scenario = createTestScenario(repos);

      const snapshot1 = services.versioningService.createSnapshot(
        scenario.issue.number,
        "MANUAL",
        "test"
      );
      services.versioningService.createSnapshot(scenario.issue.number, "MANUAL", "test");

      // Check that first snapshot was archived
      const history = services.versioningService.getSnapshotHistory(scenario.issue.number);
      const archivedSnapshot = history.find((s) => s.id === snapshot1.id);
      expect(archivedSnapshot?.status).toBe("ARCHIVED");
    });
  });

  describe("viewSnapshot", () => {
    it("should return historical state without modifying live state", () => {
      const scenario = createTestScenario(repos);

      // Create initial snapshot
      services.versioningService.createSnapshot(scenario.issue.number, "MANUAL", "test");

      // Modify live state
      repos.issueRepository.update(scenario.issue.id, {
        title: "Updated Title",
      });

      // Create another snapshot
      services.versioningService.createSnapshot(scenario.issue.number, "MANUAL", "test");

      // View old snapshot
      const oldState = services.versioningService.viewSnapshot(scenario.issue.number, 1);

      // Should show original title
      expect(oldState.issue.title).toBe(scenario.issue.title);

      // Live state should still be updated
      const liveIssue = repos.issueRepository.findById(scenario.issue.id);
      expect(liveIssue?.title).toBe("Updated Title");
    });
  });

  describe("revertToSnapshot", () => {
    it("should restore issue state from snapshot", () => {
      const scenario = createTestScenario(repos);
      const originalTitle = scenario.issue.title;

      // Create snapshot
      services.versioningService.createSnapshot(scenario.issue.number, "MANUAL", "test");

      // Modify live state
      repos.issueRepository.update(scenario.issue.id, {
        title: "Changed Title",
      });

      // Create another snapshot
      services.versioningService.createSnapshot(scenario.issue.number, "MANUAL", "test");

      // Revert to version 1
      services.versioningService.revertToSnapshot(
        scenario.issue.number,
        1,
        "test",
        "Reverting for test"
      );

      // Verify live state is restored
      const restoredIssue = repos.issueRepository.findById(scenario.issue.id);
      expect(restoredIssue?.title).toBe(originalTitle);
    });

    it("should create a new snapshot after reverting", () => {
      const scenario = createTestScenario(repos);

      // Create snapshots
      services.versioningService.createSnapshot(scenario.issue.number, "MANUAL", "test");
      repos.issueRepository.update(scenario.issue.id, { title: "Changed" });
      services.versioningService.createSnapshot(scenario.issue.number, "MANUAL", "test");

      // Get snapshot count before revert
      const historyBefore = services.versioningService.getSnapshotHistory(scenario.issue.number);

      // Revert
      const revertSnapshot = services.versioningService.revertToSnapshot(
        scenario.issue.number,
        1,
        "test"
      );

      // Should have more snapshots after revert (backup + revert record)
      const historyAfter = services.versioningService.getSnapshotHistory(scenario.issue.number);
      expect(historyAfter.length).toBeGreaterThan(historyBefore.length);
      expect(revertSnapshot.notes).toContain("Reverted to version 1");
    });
  });

  describe("getSnapshotHistory", () => {
    it("should return snapshots ordered by version DESC", () => {
      const scenario = createTestScenario(repos);

      services.versioningService.createSnapshot(scenario.issue.number, "MANUAL", "test");
      services.versioningService.createSnapshot(scenario.issue.number, "MANUAL", "test");
      services.versioningService.createSnapshot(scenario.issue.number, "MANUAL", "test");

      const history = services.versioningService.getSnapshotHistory(scenario.issue.number);

      expect(history[0]?.version).toBe(3);
      expect(history[1]?.version).toBe(2);
      expect(history[2]?.version).toBe(1);
    });
  });
});
