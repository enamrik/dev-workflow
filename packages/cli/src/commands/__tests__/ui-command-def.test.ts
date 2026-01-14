import { describe, it, expect, vi, afterEach } from "vitest";
import { asValue } from "awilix";
import { createTestContainer } from "./test-helpers.js";
import { createTestCliCommand } from "../../di/bootstrap.js";
import { handleUI, handleUIInstall, handleUIUninstall } from "../ui-command-def.js";
import type { UICommand } from "../ui-command.js";

describe("ui-command-def", () => {
  let container: ReturnType<typeof createTestContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  describe("handleUI", () => {
    it("should call uiCommand.start when executed", async () => {
      container = createTestContainer();

      const mockUICommand = {
        start: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        uiCommand: asValue(mockUICommand as unknown as UICommand),
      });

      const runUI = createTestCliCommand(handleUI, container);
      await runUI({});

      expect(mockUICommand.start).toHaveBeenCalled();
    });
  });

  describe("handleUIInstall", () => {
    it("should call uiCommand.install when executed", async () => {
      container = createTestContainer();

      const mockUICommand = {
        install: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        uiCommand: asValue(mockUICommand as unknown as UICommand),
      });

      const runUIInstall = createTestCliCommand(handleUIInstall, container);
      await runUIInstall({});

      expect(mockUICommand.install).toHaveBeenCalled();
    });
  });

  describe("handleUIUninstall", () => {
    it("should call uiCommand.uninstall when executed", async () => {
      container = createTestContainer();

      const mockUICommand = {
        uninstall: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        uiCommand: asValue(mockUICommand as unknown as UICommand),
      });

      const runUIUninstall = createTestCliCommand(handleUIUninstall, container);
      await runUIUninstall({});

      expect(mockUICommand.uninstall).toHaveBeenCalled();
    });
  });
});
