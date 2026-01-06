import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/setup.js";
import { createRepositories } from "../../../__tests__/helpers.js";

describe("SqliteWorkerRepository", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof createRepositories>;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("register", () => {
    it("should register a new worker", () => {
      const worker = repos.workerRepository.register("worker-uuid-1", "worker-1");

      expect(worker.id).toBe("worker-uuid-1");
      expect(worker.name).toBe("worker-1");
      expect(worker.status).toBe("IDLE");
      expect(worker.lastHeartbeat).toBeDefined();
      expect(worker.createdAt).toBeDefined();
    });

    it("should register multiple workers with unique IDs", () => {
      const worker1 = repos.workerRepository.register("uuid-1", "worker-1");
      const worker2 = repos.workerRepository.register("uuid-2", "worker-2");

      expect(worker1.id).toBe("uuid-1");
      expect(worker2.id).toBe("uuid-2");
    });
  });

  describe("unregister", () => {
    it("should remove a worker from the registry", () => {
      repos.workerRepository.register("uuid-1", "worker-1");
      repos.workerRepository.unregister("uuid-1");

      const worker = repos.workerRepository.findById("uuid-1");
      expect(worker).toBeNull();
    });

    it("should not throw when unregistering non-existent worker", () => {
      expect(() => repos.workerRepository.unregister("non-existent")).not.toThrow();
    });
  });

  describe("updateHeartbeat", () => {
    it("should update worker heartbeat timestamp", () => {
      const worker = repos.workerRepository.register("uuid-1", "worker-1");
      const originalHeartbeat = worker.lastHeartbeat;

      // Wait a tiny bit to ensure timestamp difference
      const updated = repos.workerRepository.updateHeartbeat("uuid-1");

      expect(updated).not.toBeNull();
      expect(updated!.lastHeartbeat).toBeDefined();
      // New heartbeat should be >= original (could be same if very fast)
      expect(new Date(updated!.lastHeartbeat).getTime()).toBeGreaterThanOrEqual(
        new Date(originalHeartbeat).getTime()
      );
    });

    it("should return null for non-existent worker", () => {
      const result = repos.workerRepository.updateHeartbeat("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("updateStatus", () => {
    it("should update worker status to WORKING", () => {
      repos.workerRepository.register("uuid-1", "worker-1");

      const updated = repos.workerRepository.updateStatus("uuid-1", "WORKING");

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("WORKING");
    });

    it("should update worker status to DRAINING", () => {
      repos.workerRepository.register("uuid-1", "worker-1");

      const updated = repos.workerRepository.updateStatus("uuid-1", "DRAINING");

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("DRAINING");
    });

    it("should return null for non-existent worker", () => {
      const result = repos.workerRepository.updateStatus("non-existent", "WORKING");
      expect(result).toBeNull();
    });
  });

  describe("findById", () => {
    it("should find worker by ID", () => {
      repos.workerRepository.register("uuid-1", "worker-1");

      const worker = repos.workerRepository.findById("uuid-1");

      expect(worker).not.toBeNull();
      expect(worker!.id).toBe("uuid-1");
      expect(worker!.name).toBe("worker-1");
    });

    it("should return null for non-existent worker", () => {
      const worker = repos.workerRepository.findById("non-existent");
      expect(worker).toBeNull();
    });
  });

  describe("findAllWithHealth", () => {
    it("should return empty array when no workers", () => {
      const workers = repos.workerRepository.findAllWithHealth();
      expect(workers).toEqual([]);
    });

    it("should return all workers with health info", () => {
      repos.workerRepository.register("uuid-1", "worker-1");
      repos.workerRepository.register("uuid-2", "worker-2");

      const workers = repos.workerRepository.findAllWithHealth();

      expect(workers).toHaveLength(2);
      expect(workers[0]!.isAlive).toBe(true);
      expect(workers[0]!.heartbeatAge).toBeGreaterThanOrEqual(0);
      expect(workers[0]!.currentTaskId).toBeNull();
    });

    it("should detect dead workers based on heartbeat threshold", () => {
      // Register worker
      repos.workerRepository.register("uuid-1", "worker-1");

      // Use a very short threshold (0 seconds) - worker should be dead immediately
      const workers = repos.workerRepository.findAllWithHealth(0);

      expect(workers).toHaveLength(1);
      expect(workers[0]!.isAlive).toBe(false);
    });

    it("should include current task info for workers with claims", () => {
      repos.workerRepository.register("uuid-1", "worker-1");

      // Add a task to dispatch queue and claim it
      repos.dispatchQueueRepository.enqueue("task-1");
      repos.dispatchQueueRepository.claimTask("uuid-1");

      const workers = repos.workerRepository.findAllWithHealth();

      expect(workers).toHaveLength(1);
      expect(workers[0]!.currentTaskId).toBe("task-1");
    });
  });

  describe("cleanupDeadWorkers", () => {
    it("should remove workers with stale heartbeats", () => {
      repos.workerRepository.register("uuid-1", "worker-1");
      repos.workerRepository.register("uuid-2", "worker-2");

      // Use a very short threshold (0 seconds) - all workers should be cleaned
      const removed = repos.workerRepository.cleanupDeadWorkers(0);

      expect(removed).toBe(2);
      expect(repos.workerRepository.findById("uuid-1")).toBeNull();
      expect(repos.workerRepository.findById("uuid-2")).toBeNull();
    });

    it("should not remove workers with recent heartbeats", () => {
      repos.workerRepository.register("uuid-1", "worker-1");

      // Use a long threshold - no workers should be cleaned
      const removed = repos.workerRepository.cleanupDeadWorkers(3600);

      expect(removed).toBe(0);
      expect(repos.workerRepository.findById("uuid-1")).not.toBeNull();
    });
  });

  describe("getNextWorkerName", () => {
    it("should return worker-1 when no workers exist", () => {
      const name = repos.workerRepository.getNextWorkerName();
      expect(name).toBe("worker-1");
    });

    it("should return worker-2 when worker-1 exists", () => {
      repos.workerRepository.register("uuid-1", "worker-1");

      const name = repos.workerRepository.getNextWorkerName();
      expect(name).toBe("worker-2");
    });

    it("should return worker-4 when worker-1, worker-2, worker-3 exist", () => {
      repos.workerRepository.register("uuid-1", "worker-1");
      repos.workerRepository.register("uuid-2", "worker-2");
      repos.workerRepository.register("uuid-3", "worker-3");

      const name = repos.workerRepository.getNextWorkerName();
      expect(name).toBe("worker-4");
    });

    it("should ignore non-standard worker names", () => {
      repos.workerRepository.register("uuid-1", "macbook-pro");
      repos.workerRepository.register("uuid-2", "worker-5");

      const name = repos.workerRepository.getNextWorkerName();
      expect(name).toBe("worker-6");
    });
  });
});
