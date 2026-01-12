import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDatabase } from "../../../__tests__/setup.js";
import { getRepositories } from "../../../__tests__/helpers.js";

describe("DrizzleDispatchQueueRepository", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof getRepositories>;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = getRepositories(testDb.client);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("enqueue", () => {
    it("should add a task to the queue", () => {
      const entry = repos.dispatchQueueRepository.enqueue("task-1");

      expect(entry.taskId).toBe("task-1");
      expect(entry.workerId).toBeNull();
      expect(entry.claimedAt).toBeNull();
      expect(entry.createdAt).toBeDefined();
    });

    it("should be idempotent - return existing entry if already queued", () => {
      const entry1 = repos.dispatchQueueRepository.enqueue("task-1");
      const entry2 = repos.dispatchQueueRepository.enqueue("task-1");

      expect(entry2.taskId).toBe(entry1.taskId);
      expect(entry2.createdAt).toBe(entry1.createdAt);
    });

    it("should allow multiple different tasks in queue", () => {
      const entry1 = repos.dispatchQueueRepository.enqueue("task-1");
      const entry2 = repos.dispatchQueueRepository.enqueue("task-2");

      expect(entry1.taskId).toBe("task-1");
      expect(entry2.taskId).toBe("task-2");
    });
  });

  describe("claimTask", () => {
    it("should claim an unclaimed task", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.dispatchQueueRepository.enqueue("task-1");

      const claimed = repos.dispatchQueueRepository.claimTask("worker-1");

      expect(claimed).not.toBeNull();
      expect(claimed!.taskId).toBe("task-1");
      expect(claimed!.workerId).toBe("worker-1");
      expect(claimed!.claimedAt).toBeDefined();
    });

    it("should return null when no tasks in queue", () => {
      repos.workerRepository.register("worker-1", "worker-1");

      const claimed = repos.dispatchQueueRepository.claimTask("worker-1");

      expect(claimed).toBeNull();
    });

    it("should not claim a task already claimed by another worker", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.workerRepository.register("worker-2", "worker-2");
      repos.dispatchQueueRepository.enqueue("task-1");

      // Worker 1 claims the task
      const claimed1 = repos.dispatchQueueRepository.claimTask("worker-1");
      expect(claimed1).not.toBeNull();

      // Worker 2 tries to claim - should fail since worker-1 is alive
      const claimed2 = repos.dispatchQueueRepository.claimTask("worker-2");
      expect(claimed2).toBeNull();
    });

    it("should claim a stale-claimed task (dead worker)", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.workerRepository.register("worker-2", "worker-2");
      repos.dispatchQueueRepository.enqueue("task-1");

      // Worker 1 claims the task
      repos.dispatchQueueRepository.claimTask("worker-1");

      // Worker 2 tries to claim with 0 threshold - worker-1's claim is stale
      const claimed = repos.dispatchQueueRepository.claimTask("worker-2", 0);
      expect(claimed).not.toBeNull();
      expect(claimed!.workerId).toBe("worker-2");
    });

    it("should claim task when claiming worker is deleted", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.workerRepository.register("worker-2", "worker-2");
      repos.dispatchQueueRepository.enqueue("task-1");

      // Worker 1 claims the task
      repos.dispatchQueueRepository.claimTask("worker-1");

      // Delete worker 1 (simulates crash)
      repos.workerRepository.unregister("worker-1");

      // Worker 2 can now claim the orphaned task
      const claimed = repos.dispatchQueueRepository.claimTask("worker-2");
      expect(claimed).not.toBeNull();
      expect(claimed!.workerId).toBe("worker-2");
    });

    it("should claim first available task when multiple in queue", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.dispatchQueueRepository.enqueue("task-1");
      repos.dispatchQueueRepository.enqueue("task-2");
      repos.dispatchQueueRepository.enqueue("task-3");

      const claimed = repos.dispatchQueueRepository.claimTask("worker-1");

      expect(claimed).not.toBeNull();
      // Should get one of the tasks (order not guaranteed)
      expect(["task-1", "task-2", "task-3"]).toContain(claimed!.taskId);
    });
  });

  describe("remove", () => {
    it("should remove a task from the queue", () => {
      repos.dispatchQueueRepository.enqueue("task-1");

      repos.dispatchQueueRepository.remove("task-1");

      const entry = repos.dispatchQueueRepository.findByTaskId("task-1");
      expect(entry).toBeNull();
    });

    it("should not throw when releasing non-existent task", () => {
      expect(() => repos.dispatchQueueRepository.remove("non-existent")).not.toThrow();
    });
  });

  describe("findClaimByWorker", () => {
    it("should find a claim by worker ID", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.dispatchQueueRepository.enqueue("task-1");
      repos.dispatchQueueRepository.claimTask("worker-1");

      const claim = repos.dispatchQueueRepository.findClaimByWorker("worker-1");

      expect(claim).not.toBeNull();
      expect(claim!.taskId).toBe("task-1");
      expect(claim!.workerId).toBe("worker-1");
    });

    it("should return null when worker has no claims", () => {
      repos.workerRepository.register("worker-1", "worker-1");

      const claim = repos.dispatchQueueRepository.findClaimByWorker("worker-1");

      expect(claim).toBeNull();
    });

    it("should return null for non-existent worker", () => {
      const claim = repos.dispatchQueueRepository.findClaimByWorker("non-existent");
      expect(claim).toBeNull();
    });
  });

  describe("findByTaskId", () => {
    it("should find a queue entry by task ID", () => {
      repos.dispatchQueueRepository.enqueue("task-1");

      const entry = repos.dispatchQueueRepository.findByTaskId("task-1");

      expect(entry).not.toBeNull();
      expect(entry!.taskId).toBe("task-1");
    });

    it("should return null for non-existent task", () => {
      const entry = repos.dispatchQueueRepository.findByTaskId("non-existent");
      expect(entry).toBeNull();
    });
  });

  describe("findAllWithHealth", () => {
    it("should return empty array when queue is empty", () => {
      const entries = repos.dispatchQueueRepository.findAllWithHealth();
      expect(entries).toEqual([]);
    });

    it("should return all entries with health info", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.dispatchQueueRepository.enqueue("task-1");
      repos.dispatchQueueRepository.enqueue("task-2");
      repos.dispatchQueueRepository.claimTask("worker-1");

      const entries = repos.dispatchQueueRepository.findAllWithHealth();

      expect(entries).toHaveLength(2);

      const claimed = entries.find((e) => e.workerId === "worker-1");
      const unclaimed = entries.find((e) => e.workerId === null);

      expect(claimed).toBeDefined();
      expect(claimed!.isStale).toBe(false);
      expect(claimed!.workerName).toBe("worker-1");

      expect(unclaimed).toBeDefined();
      expect(unclaimed!.isStale).toBe(false);
      expect(unclaimed!.workerName).toBeNull();
    });

    it("should detect stale claims", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.dispatchQueueRepository.enqueue("task-1");
      repos.dispatchQueueRepository.claimTask("worker-1");

      // Use 0 threshold - claim should be stale immediately
      const entries = repos.dispatchQueueRepository.findAllWithHealth(0);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.isStale).toBe(true);
    });

    it("should detect orphaned claims (worker deleted)", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.dispatchQueueRepository.enqueue("task-1");
      repos.dispatchQueueRepository.claimTask("worker-1");
      repos.workerRepository.unregister("worker-1");

      const entries = repos.dispatchQueueRepository.findAllWithHealth();

      expect(entries).toHaveLength(1);
      expect(entries[0]!.isStale).toBe(true);
      expect(entries[0]!.workerName).toBeNull();
    });
  });

  describe("getQueueStats", () => {
    it("should return zeros when queue is empty", () => {
      const stats = repos.dispatchQueueRepository.getQueueStats();

      expect(stats.total).toBe(0);
      expect(stats.unclaimed).toBe(0);
      expect(stats.claimed).toBe(0);
      expect(stats.stale).toBe(0);
    });

    it("should return correct stats for mixed queue", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.dispatchQueueRepository.enqueue("task-1");
      repos.dispatchQueueRepository.enqueue("task-2");
      repos.dispatchQueueRepository.enqueue("task-3");
      repos.dispatchQueueRepository.claimTask("worker-1");

      const stats = repos.dispatchQueueRepository.getQueueStats();

      expect(stats.total).toBe(3);
      expect(stats.unclaimed).toBe(2);
      expect(stats.claimed).toBe(1);
      expect(stats.stale).toBe(0);
    });

    it("should count stale claims correctly", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.dispatchQueueRepository.enqueue("task-1");
      repos.dispatchQueueRepository.claimTask("worker-1");

      // Use 0 threshold - claim is stale
      const stats = repos.dispatchQueueRepository.getQueueStats(0);

      expect(stats.total).toBe(1);
      expect(stats.claimed).toBe(1);
      expect(stats.stale).toBe(1);
    });
  });

  describe("race condition handling", () => {
    it("should allow only one worker to claim a task (atomic claim)", () => {
      // This test verifies the atomic claim behavior
      // In a real concurrent scenario, only one worker should win
      repos.workerRepository.register("worker-1", "worker-1");
      repos.workerRepository.register("worker-2", "worker-2");
      repos.dispatchQueueRepository.enqueue("task-1");

      // First claim should succeed
      const claim1 = repos.dispatchQueueRepository.claimTask("worker-1");
      expect(claim1).not.toBeNull();
      expect(claim1!.workerId).toBe("worker-1");

      // Second claim should fail (task already claimed by alive worker)
      const claim2 = repos.dispatchQueueRepository.claimTask("worker-2");
      expect(claim2).toBeNull();

      // Verify the task is still claimed by worker-1
      const entry = repos.dispatchQueueRepository.findByTaskId("task-1");
      expect(entry!.workerId).toBe("worker-1");
    });
  });

  describe("worker resume scenario", () => {
    it("should allow worker to find and resume its own claim", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.dispatchQueueRepository.enqueue("task-1");
      repos.dispatchQueueRepository.claimTask("worker-1");

      // Simulate worker restart - unregister and re-register with same ID
      // (In practice, worker would use same UUID if resuming)
      const claim = repos.dispatchQueueRepository.findClaimByWorker("worker-1");

      expect(claim).not.toBeNull();
      expect(claim!.taskId).toBe("task-1");

      // Worker can continue working on the task
    });
  });

  describe("setClaudeDone", () => {
    it("should set claudeDone flag for a claimed task", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.dispatchQueueRepository.enqueue("task-1");
      repos.dispatchQueueRepository.claimTask("worker-1");

      const updated = repos.dispatchQueueRepository.setClaudeDone("task-1", "worker-1");

      expect(updated).not.toBeNull();
      expect(updated!.claudeDone).toBe(true);
      expect(updated!.claudeDoneAt).toBeDefined();
    });

    it("should return null if task is not in queue", () => {
      repos.workerRepository.register("worker-1", "worker-1");

      const updated = repos.dispatchQueueRepository.setClaudeDone("non-existent", "worker-1");

      expect(updated).toBeNull();
    });

    it("should return null if workerId does not match", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.workerRepository.register("worker-2", "worker-2");
      repos.dispatchQueueRepository.enqueue("task-1");
      repos.dispatchQueueRepository.claimTask("worker-1");

      // Worker-2 tries to set claudeDone - should fail
      const updated = repos.dispatchQueueRepository.setClaudeDone("task-1", "worker-2");

      expect(updated).toBeNull();
    });

    it("should persist claudeDone flag", () => {
      repos.workerRepository.register("worker-1", "worker-1");
      repos.dispatchQueueRepository.enqueue("task-1");
      repos.dispatchQueueRepository.claimTask("worker-1");
      repos.dispatchQueueRepository.setClaudeDone("task-1", "worker-1");

      // Re-read from database
      const entry = repos.dispatchQueueRepository.findByTaskId("task-1");

      expect(entry).not.toBeNull();
      expect(entry!.claudeDone).toBe(true);
      expect(entry!.claudeDoneAt).toBeDefined();
    });

    it("should initialize claudeDone to false when enqueuing", () => {
      const entry = repos.dispatchQueueRepository.enqueue("task-1");

      expect(entry.claudeDone).toBe(false);
      expect(entry.claudeDoneAt).toBeNull();
    });
  });

  describe("stale worker process termination", () => {
    it("should attempt to kill stale worker process when reclaiming task", () => {
      const mockKill = vi.spyOn(process, "kill").mockImplementation(() => true);

      // Register worker-1 with a PID
      repos.workerRepository.register("worker-1", "worker-1", 12345);
      repos.workerRepository.register("worker-2", "worker-2", 67890);
      repos.dispatchQueueRepository.enqueue("task-1");

      // Worker 1 claims the task
      repos.dispatchQueueRepository.claimTask("worker-1");

      // Worker 2 reclaims with 0 threshold (worker-1 is stale)
      repos.dispatchQueueRepository.claimTask("worker-2", 0);

      // Should have attempted to kill worker-1's process
      expect(mockKill).toHaveBeenCalledWith(12345, "SIGTERM");

      mockKill.mockRestore();
    });

    it("should proceed with reclaim even if kill fails (process already exited)", () => {
      const mockKill = vi.spyOn(process, "kill").mockImplementation(() => {
        const error = new Error("No such process") as NodeJS.ErrnoException;
        error.code = "ESRCH";
        throw error;
      });

      // Register worker-1 with a PID
      repos.workerRepository.register("worker-1", "worker-1", 12345);
      repos.workerRepository.register("worker-2", "worker-2", 67890);
      repos.dispatchQueueRepository.enqueue("task-1");

      // Worker 1 claims the task
      repos.dispatchQueueRepository.claimTask("worker-1");

      // Worker 2 reclaims - should succeed despite kill failure
      const claimed = repos.dispatchQueueRepository.claimTask("worker-2", 0);

      expect(claimed).not.toBeNull();
      expect(claimed!.workerId).toBe("worker-2");
      expect(mockKill).toHaveBeenCalledWith(12345, "SIGTERM");

      mockKill.mockRestore();
    });

    it("should not attempt kill when stale worker has no PID", () => {
      const mockKill = vi.spyOn(process, "kill").mockImplementation(() => true);

      // Register worker-1 without a PID
      repos.workerRepository.register("worker-1", "worker-1");
      repos.workerRepository.register("worker-2", "worker-2", 67890);
      repos.dispatchQueueRepository.enqueue("task-1");

      // Worker 1 claims the task
      repos.dispatchQueueRepository.claimTask("worker-1");

      // Worker 2 reclaims with 0 threshold
      const claimed = repos.dispatchQueueRepository.claimTask("worker-2", 0);

      expect(claimed).not.toBeNull();
      expect(claimed!.workerId).toBe("worker-2");
      // Should not have attempted to kill (no PID)
      expect(mockKill).not.toHaveBeenCalled();

      mockKill.mockRestore();
    });

    it("should not attempt kill when claiming PENDING task", () => {
      const mockKill = vi.spyOn(process, "kill").mockImplementation(() => true);

      // Register worker
      repos.workerRepository.register("worker-1", "worker-1", 12345);
      repos.dispatchQueueRepository.enqueue("task-1");

      // Claim PENDING task - should not trigger kill
      repos.dispatchQueueRepository.claimTask("worker-1");

      expect(mockKill).not.toHaveBeenCalled();

      mockKill.mockRestore();
    });
  });
});
