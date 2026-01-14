import { describe, it, expect, vi, afterEach } from "vitest";
import { asValue } from "awilix";
import { createTestContainer } from "./test-helpers.js";
import { createTestCliCommand } from "../../di/bootstrap.js";
import { handleUninit } from "../uninit-command-def.js";
import type { UninitCommand } from "../uninit-command.js";

describe("uninit-command-def", () => {
  let container: ReturnType<typeof createTestContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  describe("handleUninit", () => {
    it("should call uninitCommand.execute when executed", async () => {
      container = createTestContainer();

      const mockUninitCommand = {
        execute: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        uninitCommand: asValue(mockUninitCommand as unknown as UninitCommand),
      });

      const runUninit = createTestCliCommand(handleUninit, container);
      await runUninit({});

      expect(mockUninitCommand.execute).toHaveBeenCalled();
    });
  });
});
