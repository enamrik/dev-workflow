import { describe, it, expect, vi, afterEach } from "vitest";
import { asValue } from "awilix";
import { createTestContainer } from "./test-helpers.js";
import { createTestCliCommand } from "../../di/bootstrap.js";
import { handleArchive, handleUnarchive, handleNuke } from "../archive-command-def.js";
import type { ArchiveCommand, UnarchiveCommand, NukeCommand } from "../archive-command.js";

describe("archive-command-def", () => {
  let container: ReturnType<typeof createTestContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  describe("handleArchive", () => {
    it("should call archiveCommand.execute when executed", async () => {
      container = createTestContainer();

      const mockArchiveCommand = {
        execute: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        archiveCommand: asValue(mockArchiveCommand as unknown as ArchiveCommand),
      });

      const runArchive = createTestCliCommand(handleArchive, container);
      await runArchive({});

      expect(mockArchiveCommand.execute).toHaveBeenCalled();
    });
  });

  describe("handleUnarchive", () => {
    it("should call unarchiveCommand.execute when executed", async () => {
      container = createTestContainer();

      const mockUnarchiveCommand = {
        execute: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        unarchiveCommand: asValue(mockUnarchiveCommand as unknown as UnarchiveCommand),
      });

      const runUnarchive = createTestCliCommand(handleUnarchive, container);
      await runUnarchive({});

      expect(mockUnarchiveCommand.execute).toHaveBeenCalled();
    });
  });

  describe("handleNuke", () => {
    it("should call nukeCommand.execute with options when executed", async () => {
      container = createTestContainer();

      const mockNukeCommand = {
        execute: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        nukeCommand: asValue(mockNukeCommand as unknown as NukeCommand),
      });

      const runNuke = createTestCliCommand(handleNuke, container);
      await runNuke({ force: true });

      expect(mockNukeCommand.execute).toHaveBeenCalledWith({ force: true });
    });
  });
});
