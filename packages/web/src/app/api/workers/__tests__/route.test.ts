/**
 * Tests for List Workers Endpoint
 */

import { describe, it, expect, vi } from "vitest";
import { buildTestContainer, createTestRequest, runTestApiEndpoint } from "@/lib/di/test-utils";
import { endpoint } from "../route";

describe("listWorkersEndpoint", () => {
  it("returns worker data with enriched details", async () => {
    const mockResult = {
      workers: [
        {
          workerId: "worker-1",
          workerName: "Worker A",
          currentTaskId: "task-1",
          status: "WORKING",
          taskNumber: 1,
          issueNumber: 5,
          taskStartedAt: "2024-01-15T10:00:00Z",
          totalTasks: 3,
        },
      ],
      queue: [
        {
          taskId: "task-2",
          workerId: null,
          status: "PENDING",
          taskNumber: 2,
          issueNumber: 5,
          taskTitle: "Task Two",
          totalTasks: 3,
        },
      ],
      stats: {
        total: 2,
        unclaimed: 1,
        claimed: 1,
        stale: 0,
      },
    };

    const testContainer = buildTestContainer({
      projectAppService: {
        getWorkerData: vi.fn().mockResolvedValue(mockResult),
      },
    });

    const req = createTestRequest("GET", "/api/workers");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.workers).toHaveLength(1);
    expect(body.workers[0].workerName).toBe("Worker A");
    expect(body.workers[0].taskNumber).toBe(1);
    expect(body.queue).toHaveLength(1);
    expect(body.queue[0].taskTitle).toBe("Task Two");
    expect(body.stats.total).toBe(2);
  });

  it("returns empty arrays when no workers or queue entries", async () => {
    const mockResult = {
      workers: [],
      queue: [],
      stats: {
        total: 0,
        unclaimed: 0,
        claimed: 0,
        stale: 0,
      },
    };

    const testContainer = buildTestContainer({
      projectAppService: {
        getWorkerData: vi.fn().mockResolvedValue(mockResult),
      },
    });

    const req = createTestRequest("GET", "/api/workers");

    const result = await runTestApiEndpoint(req, endpoint, testContainer, {});

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.workers).toHaveLength(0);
    expect(body.queue).toHaveLength(0);
    expect(body.stats.total).toBe(0);
  });
});
