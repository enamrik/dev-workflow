import { describe, it, expect, vi, afterEach } from "vitest";
import { asValue } from "awilix";
import { createTestContainer } from "./test-helpers.js";
import { createTestCliCommand } from "../../di/bootstrap.js";
import { handleDatabaseConfigure, handleDatabaseStatus } from "../database-command-def.js";
import type { DatabaseCommand } from "../database-command.js";

describe("database-command-def", () => {
  let container: ReturnType<typeof createTestContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  describe("handleDatabaseConfigure", () => {
    it("should call databaseCommand.configure with options when executed", async () => {
      container = createTestContainer();

      const mockDatabaseCommand = {
        configure: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        databaseCommand: asValue(mockDatabaseCommand as unknown as DatabaseCommand),
      });

      const runDatabaseConfigure = createTestCliCommand(handleDatabaseConfigure, container);
      await runDatabaseConfigure({ url: "postgresql://localhost/db" });

      expect(mockDatabaseCommand.configure).toHaveBeenCalledWith({
        url: "postgresql://localhost/db",
      });
    });
  });

  describe("handleDatabaseStatus", () => {
    it("should call databaseCommand.status when executed", async () => {
      container = createTestContainer();

      const mockDatabaseCommand = {
        status: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        databaseCommand: asValue(mockDatabaseCommand as unknown as DatabaseCommand),
      });

      const runDatabaseStatus = createTestCliCommand(handleDatabaseStatus, container);
      await runDatabaseStatus({});

      expect(mockDatabaseCommand.status).toHaveBeenCalled();
    });
  });
});
