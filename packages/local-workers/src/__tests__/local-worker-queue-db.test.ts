/**
 * GlobalDbWorkerQueueDb — queue-row maintenance.
 *
 * Focused on updateProjectSlug, the self-heal write used to correct a poisoned
 * dispatch row whose stored project_slug was the dispatching/claiming worker's
 * home project rather than the task's true owner.
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GlobalDbWorkerQueueDb } from "../local-worker-queue-db.js";

describe("GlobalDbWorkerQueueDb.updateProjectSlug", () => {
  let dbPath: string;
  let queue: GlobalDbWorkerQueueDb;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `test-worker-queue-${Date.now()}-${crypto.randomUUID()}.db`);
    queue = new GlobalDbWorkerQueueDb(dbPath);
  });

  afterEach(() => {
    queue.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  it("rewrites the stored project slug for an existing queue entry", () => {
    queue.enqueue("task-1", "wrong-owner-bbbbbb");
    expect(queue.findByTaskId("task-1")?.projectSlug).toBe("wrong-owner-bbbbbb");

    queue.updateProjectSlug("task-1", "true-owner-aaaaaa");

    expect(queue.findByTaskId("task-1")?.projectSlug).toBe("true-owner-aaaaaa");
  });

  it("leaves other queue fields untouched while healing the slug", () => {
    queue.enqueue("task-1", "wrong-owner-bbbbbb");
    const before = queue.findByTaskId("task-1");

    queue.updateProjectSlug("task-1", "true-owner-aaaaaa");
    const after = queue.findByTaskId("task-1");

    expect(after?.taskId).toBe("task-1");
    expect(after?.status).toBe(before?.status);
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.workerId).toBe(before?.workerId);
  });

  it("is a no-op when no entry exists for the task", () => {
    expect(() => queue.updateProjectSlug("missing", "true-owner-aaaaaa")).not.toThrow();
    expect(queue.findByTaskId("missing")).toBeNull();
  });
});

/**
 * registerWorker idempotency (#47).
 *
 * A supervised worker relaunched with the SAME stable id must re-register
 * without a primary-key conflict, and — crucially — its prior in-flight claim
 * must still be reachable via findClaimByWorker after the re-register so the
 * relaunched child resumes its own work instead of starting over.
 */
describe("GlobalDbWorkerQueueDb.registerWorker idempotency", () => {
  let dbPath: string;
  let queue: GlobalDbWorkerQueueDb;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `test-worker-queue-${Date.now()}-${crypto.randomUUID()}.db`);
    queue = new GlobalDbWorkerQueueDb(dbPath);
  });

  afterEach(() => {
    queue.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  it("re-registering the same id does not throw and keeps a single row", () => {
    queue.registerWorker("worker-id-1", "worker-1", 100);

    expect(() => queue.registerWorker("worker-id-1", "worker-1", 200)).not.toThrow();

    const workers = queue.findAllWorkersWithHealth();
    expect(workers.filter((w) => w.id === "worker-id-1")).toHaveLength(1);
  });

  it("preserves createdAt while updating name and pid on re-register", () => {
    const first = queue.registerWorker("worker-id-1", "old-name", 100);

    const second = queue.registerWorker("worker-id-1", "new-name", 200);

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.name).toBe("new-name");
    expect(second.pid).toBe(200);

    const persisted = queue.findWorkerById("worker-id-1");
    expect(persisted?.createdAt).toBe(first.createdAt);
    expect(persisted?.name).toBe("new-name");
    expect(persisted?.pid).toBe(200);
  });

  it("keeps the worker's prior WORKING claim reachable after re-register (#47 resume)", () => {
    queue.registerWorker("worker-id-1", "worker-1", 100);
    queue.enqueue("task-1", "proj-aaaaaa");
    const claim = queue.claimTask("worker-id-1");
    expect(claim?.taskId).toBe("task-1");
    expect(claim?.status).toBe("WORKING");

    // Relaunch: re-register the SAME id.
    queue.registerWorker("worker-id-1", "worker-1", 200);

    const resumed = queue.findClaimByWorker("worker-id-1");
    expect(resumed?.taskId).toBe("task-1");
    expect(resumed?.status).toBe("WORKING");
  });
});
