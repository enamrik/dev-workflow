import { describe, it, expect, vi, afterEach } from "vitest";
import { asValue } from "awilix";
import { createTestContainer } from "./test-helpers.js";
import { createTestCliCommand } from "../../di/bootstrap.js";
import {
  handleBackupCreate,
  handleBackupConfigure,
  handleBackupStatus,
  handleBackupList,
  handleBackupUnconfigure,
  handleRestore,
} from "../backup-command-def.js";
import type { BackupCommand } from "../backup-command.js";

describe("backup-command-def", () => {
  let container: ReturnType<typeof createTestContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  describe("handleBackupCreate", () => {
    it("should call backupCommand.create when executed", async () => {
      container = createTestContainer();

      const mockBackupCommand = {
        create: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        backupCommand: asValue(mockBackupCommand as unknown as BackupCommand),
      });

      const runBackupCreate = createTestCliCommand(handleBackupCreate, container);
      await runBackupCreate({});

      expect(mockBackupCommand.create).toHaveBeenCalled();
    });
  });

  describe("handleBackupConfigure", () => {
    it("should call backupCommand.configure with options when executed", async () => {
      container = createTestContainer();

      const mockBackupCommand = {
        configure: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        backupCommand: asValue(mockBackupCommand as unknown as BackupCommand),
      });

      const runBackupConfigure = createTestCliCommand(handleBackupConfigure, container);
      await runBackupConfigure({ bucket: "my-bucket", region: "us-east-1" });

      expect(mockBackupCommand.configure).toHaveBeenCalledWith({
        bucket: "my-bucket",
        region: "us-east-1",
      });
    });
  });

  describe("handleBackupStatus", () => {
    it("should call backupCommand.status when executed", async () => {
      container = createTestContainer();

      const mockBackupCommand = {
        status: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        backupCommand: asValue(mockBackupCommand as unknown as BackupCommand),
      });

      const runBackupStatus = createTestCliCommand(handleBackupStatus, container);
      await runBackupStatus({});

      expect(mockBackupCommand.status).toHaveBeenCalled();
    });
  });

  describe("handleBackupList", () => {
    it("should call backupCommand.list when executed", async () => {
      container = createTestContainer();

      const mockBackupCommand = {
        list: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        backupCommand: asValue(mockBackupCommand as unknown as BackupCommand),
      });

      const runBackupList = createTestCliCommand(handleBackupList, container);
      await runBackupList({});

      expect(mockBackupCommand.list).toHaveBeenCalled();
    });
  });

  describe("handleBackupUnconfigure", () => {
    it("should call backupCommand.unconfigure when executed", async () => {
      container = createTestContainer();

      const mockBackupCommand = {
        unconfigure: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        backupCommand: asValue(mockBackupCommand as unknown as BackupCommand),
      });

      const runBackupUnconfigure = createTestCliCommand(handleBackupUnconfigure, container);
      await runBackupUnconfigure({});

      expect(mockBackupCommand.unconfigure).toHaveBeenCalled();
    });
  });

  describe("handleRestore", () => {
    it("should call backupCommand.restore with options when executed", async () => {
      container = createTestContainer();

      const mockBackupCommand = {
        restore: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        backupCommand: asValue(mockBackupCommand as unknown as BackupCommand),
      });

      const runRestore = createTestCliCommand(handleRestore, container);
      await runRestore({ backup: "backup-123", yes: true });

      expect(mockBackupCommand.restore).toHaveBeenCalledWith("backup-123", {
        backup: "backup-123",
        yes: true,
      });
    });
  });
});
