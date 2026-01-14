import { describe, it, expect, vi, afterEach } from "vitest";
import { asValue } from "awilix";
import { createTestContainer } from "./test-helpers.js";
import { createTestCliCommand } from "../../di/bootstrap.js";
import { handleInit } from "../init-command-def.js";
import type { InitCommand } from "../init-command.js";

describe("init-command-def", () => {
  let container: ReturnType<typeof createTestContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  describe("handleInit", () => {
    it("should call initCommand.execute with options when executed", async () => {
      container = createTestContainer();

      const mockInitCommand = {
        execute: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        initCommand: asValue(mockInitCommand as unknown as InitCommand),
      });

      const runInit = createTestCliCommand(handleInit, container);
      await runInit({ local: true });

      expect(mockInitCommand.execute).toHaveBeenCalledWith({ local: true });
    });
  });
});
