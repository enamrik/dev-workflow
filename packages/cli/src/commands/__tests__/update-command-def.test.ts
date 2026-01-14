import { describe, it, expect, vi, afterEach } from "vitest";
import { asValue } from "awilix";
import { createTestContainer } from "./test-helpers.js";
import { createTestCliCommand } from "../../di/bootstrap.js";
import { handleUpdate } from "../update-command-def.js";
import type { UpdateCommand } from "../update-command.js";

describe("update-command-def", () => {
  let container: ReturnType<typeof createTestContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  describe("handleUpdate", () => {
    it("should call updateCommand.execute when executed", async () => {
      container = createTestContainer();

      const mockUpdateCommand = {
        execute: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        updateCommand: asValue(mockUpdateCommand as unknown as UpdateCommand),
      });

      const runUpdate = createTestCliCommand(handleUpdate, container);
      await runUpdate({});

      expect(mockUpdateCommand.execute).toHaveBeenCalled();
    });
  });
});
