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
