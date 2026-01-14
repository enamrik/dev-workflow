import { describe, it, expect, vi, afterEach } from "vitest";
import { asValue } from "awilix";
import { createTestContainer } from "./test-helpers.js";
import { createTestCliCommand } from "../../di/bootstrap.js";
import { handleWorkers, handleClaudeWorker } from "../worker-command-def.js";
import type { WorkerCommand } from "../worker-command.js";

describe("worker-command-def", () => {
  let container: ReturnType<typeof createTestContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  describe("handleWorkers", () => {
    it("should call workerCommand.list when executed", async () => {
      container = createTestContainer();

      const mockWorkerCommand = {
        list: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        workerCommand: asValue(mockWorkerCommand as unknown as WorkerCommand),
      });

      const runWorkers = createTestCliCommand(handleWorkers, container);
      await runWorkers({});

      expect(mockWorkerCommand.list).toHaveBeenCalled();
    });
  });

  describe("handleClaudeWorker", () => {
    it("should call workerCommand.start with options when executed", async () => {
      container = createTestContainer();

      const mockWorkerCommand = {
        start: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        workerCommand: asValue(mockWorkerCommand as unknown as WorkerCommand),
      });

      const runClaudeWorker = createTestCliCommand(handleClaudeWorker, container);
      await runClaudeWorker({ name: "worker-1", autoClaim: true });

      expect(mockWorkerCommand.start).toHaveBeenCalledWith({ name: "worker-1", autoClaim: true });
    });
  });
});
