/**
 * BackupService Tests
 *
 * Tests for the backup service including list and restore functionality.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { BackupService } from "../backup-service.js";
import type {
  BackupProvider,
  BackupMetadata,
  BackupResult,
  RestoreResult,
  ValidationResult,
  CreateBucketResult,
} from "../../domain/backup.js";
import { BackupError } from "../../domain/backup.js";
import type { GlobalSettingsRepository } from "../../infrastructure/repositories/global-settings-repository.js";
import type { BackupConfig } from "../../infrastructure/database/schema.js";

// Mock provider for testing
class MockBackupProvider implements BackupProvider {
  private backups: BackupMetadata[] = [];
  private shouldFailOnRestore = false;
  private shouldFailOnList = false;
  private validationResult: ValidationResult = { success: true, bucketExists: true };
  private createBucketResult: CreateBucketResult = { success: true };

  setBackups(backups: BackupMetadata[]): void {
    this.backups = backups;
  }

  setShouldFailOnRestore(fail: boolean): void {
    this.shouldFailOnRestore = fail;
  }

  setShouldFailOnList(fail: boolean): void {
    this.shouldFailOnList = fail;
  }

  setValidationResult(result: ValidationResult): void {
    this.validationResult = result;
  }

  setCreateBucketResult(result: CreateBucketResult): void {
    this.createBucketResult = result;
  }

  async backup(_sourcePath: string): Promise<BackupResult> {
    const timestamp = new Date();
    return {
      success: true,
      key: `dev-workflow-backups/workflow-${timestamp.toISOString()}.db`,
      timestamp,
      checksum: "abc123",
      deletedCount: 0,
    };
  }

  async listBackups(): Promise<BackupMetadata[]> {
    if (this.shouldFailOnList) {
      throw new BackupError("Failed to list backups");
    }
    // Return sorted by timestamp descending
    return [...this.backups].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  async restore(key: string, targetPath: string): Promise<RestoreResult> {
    if (this.shouldFailOnRestore) {
      throw new BackupError("Failed to restore backup");
    }

    const backup = this.backups.find((b) => b.key === key);
    if (!backup) {
      throw new BackupError(`Backup not found: ${key}`);
    }

    return {
      success: true,
      key,
      timestamp: backup.timestamp,
      restoredTo: targetPath,
    };
  }

  async enforceRetention(_retentionCount: number): Promise<number> {
    return 0;
  }

  async validateCredentials(): Promise<ValidationResult> {
    return this.validationResult;
  }

  async createBucket(): Promise<CreateBucketResult> {
    return this.createBucketResult;
  }
}

// Mock settings repository
class MockSettingsRepository implements GlobalSettingsRepository {
  private config: BackupConfig | null = null;
  private settings: Map<string, unknown> = new Map();

  // Test helper to set config
  setConfig(config: BackupConfig | null): void {
    this.config = config;
  }

  // GlobalSettingsRepository interface methods
  get<T>(_key: string): T | null {
    return this.settings.get(_key) as T | null;
  }

  set<T>(_key: string, value: T): void {
    this.settings.set(_key, value);
  }

  delete(_key: string): void {
    this.settings.delete(_key);
  }

  getBackupConfig(): BackupConfig | null {
    return this.config;
  }

  setBackupConfig(config: BackupConfig): void {
    this.config = config;
  }

  deleteBackupConfig(): void {
    this.config = null;
  }
}

describe("BackupService", () => {
  let mockProvider: MockBackupProvider;
  let mockSettings: MockSettingsRepository;
  let service: BackupService;

  beforeEach(() => {
    mockProvider = new MockBackupProvider();
    mockSettings = new MockSettingsRepository();

    // Set default config using test helper
    mockSettings.setConfig({
      provider: "s3",
      s3: {
        bucket: "test-bucket",
        region: "us-east-1",
      },
      retentionCount: 20,
    });

    service = new BackupService(mockSettings);

    // Override getProvider to return our mock
    // @ts-expect-error - accessing private method for testing
    service.getProvider = vi.fn().mockReturnValue(mockProvider);
  });

  describe("isConfigured", () => {
    it("should return true when backup is configured", () => {
      expect(service.isConfigured()).toBe(true);
    });

    it("should return false when backup is not configured", () => {
      mockSettings.setConfig(null);
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe("listBackups", () => {
    it("should return empty array when no backups exist", async () => {
      mockProvider.setBackups([]);
      const backups = await service.listBackups();
      expect(backups).toEqual([]);
    });

    it("should return backups sorted by timestamp descending", async () => {
      const oldBackup: BackupMetadata = {
        key: "dev-workflow-backups/workflow-old.db",
        timestamp: new Date("2026-01-01T00:00:00Z"),
        sizeBytes: 1024,
        checksum: "abc",
      };
      const newBackup: BackupMetadata = {
        key: "dev-workflow-backups/workflow-new.db",
        timestamp: new Date("2026-01-02T00:00:00Z"),
        sizeBytes: 2048,
        checksum: "def",
      };

      mockProvider.setBackups([oldBackup, newBackup]);
      const backups = await service.listBackups();

      expect(backups).toHaveLength(2);
      expect(backups[0]?.key).toBe(newBackup.key);
      expect(backups[1]?.key).toBe(oldBackup.key);
    });

    it("should throw BackupError when not configured", async () => {
      mockSettings.setConfig(null);
      // @ts-expect-error - restore default behavior
      service.getProvider = BackupService.prototype["getProvider"];

      await expect(service.listBackups()).rejects.toThrow(BackupError);
    });
  });

  describe("restore", () => {
    it("should restore a backup by key", async () => {
      const backup: BackupMetadata = {
        key: "dev-workflow-backups/workflow-test.db",
        timestamp: new Date("2026-01-01T00:00:00Z"),
        sizeBytes: 1024,
        checksum: "abc",
      };
      mockProvider.setBackups([backup]);

      const result = await service.restore(backup.key, "/tmp/test.db");

      expect(result.success).toBe(true);
      expect(result.key).toBe(backup.key);
      expect(result.restoredTo).toBe("/tmp/test.db");
    });

    it("should throw error when backup not found", async () => {
      mockProvider.setBackups([]);

      await expect(service.restore("nonexistent-key", "/tmp/test.db")).rejects.toThrow(
        "Backup not found"
      );
    });

    it("should throw error when restore fails", async () => {
      const backup: BackupMetadata = {
        key: "dev-workflow-backups/workflow-test.db",
        timestamp: new Date("2026-01-01T00:00:00Z"),
        sizeBytes: 1024,
        checksum: "abc",
      };
      mockProvider.setBackups([backup]);
      mockProvider.setShouldFailOnRestore(true);

      await expect(service.restore(backup.key, "/tmp/test.db")).rejects.toThrow(
        "Failed to restore backup"
      );
    });
  });

  describe("restoreLatest", () => {
    it("should restore the most recent backup", async () => {
      const oldBackup: BackupMetadata = {
        key: "dev-workflow-backups/workflow-old.db",
        timestamp: new Date("2026-01-01T00:00:00Z"),
        sizeBytes: 1024,
        checksum: "abc",
      };
      const newBackup: BackupMetadata = {
        key: "dev-workflow-backups/workflow-new.db",
        timestamp: new Date("2026-01-02T00:00:00Z"),
        sizeBytes: 2048,
        checksum: "def",
      };

      mockProvider.setBackups([oldBackup, newBackup]);
      const result = await service.restoreLatest("/tmp/test.db");

      expect(result.success).toBe(true);
      expect(result.key).toBe(newBackup.key);
    });

    it("should throw error when no backups available", async () => {
      mockProvider.setBackups([]);

      await expect(service.restoreLatest("/tmp/test.db")).rejects.toThrow(
        "No backups available to restore"
      );
    });
  });

  describe("validateCredentials (via provider)", () => {
    it("should return success when credentials are valid and bucket exists", async () => {
      mockProvider.setValidationResult({
        success: true,
        bucketExists: true,
      });

      const result = await mockProvider.validateCredentials();

      expect(result.success).toBe(true);
      expect(result.bucketExists).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return success with bucketExists false when bucket does not exist", async () => {
      mockProvider.setValidationResult({
        success: true,
        bucketExists: false,
      });

      const result = await mockProvider.validateCredentials();

      expect(result.success).toBe(true);
      expect(result.bucketExists).toBe(false);
    });

    it("should return failure when credentials are invalid", async () => {
      mockProvider.setValidationResult({
        success: false,
        error: "Invalid AWS credentials. Check your access key and secret key.",
      });

      const result = await mockProvider.validateCredentials();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid AWS credentials");
    });

    it("should return failure when access is denied", async () => {
      mockProvider.setValidationResult({
        success: false,
        error:
          "Access denied to bucket 'test-bucket'. Check that your credentials have permission to access this bucket.",
      });

      const result = await mockProvider.validateCredentials();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Access denied");
    });

    it("should return failure when profile is not found", async () => {
      mockProvider.setValidationResult({
        success: false,
        error: "Profile 'nonexistent' not found in ~/.aws/credentials",
      });

      const result = await mockProvider.validateCredentials();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Profile");
    });
  });

  describe("createBucket (via provider)", () => {
    it("should return success when bucket is created", async () => {
      mockProvider.setCreateBucketResult({
        success: true,
      });

      const result = await mockProvider.createBucket();

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return failure when bucket already exists (owned by another)", async () => {
      mockProvider.setCreateBucketResult({
        success: false,
        error: "Bucket 'test-bucket' already exists and is owned by another account.",
      });

      const result = await mockProvider.createBucket();

      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("should return failure when permission is denied", async () => {
      mockProvider.setCreateBucketResult({
        success: false,
        error:
          "Permission denied to create bucket. Your credentials may not have s3:CreateBucket permission.",
      });

      const result = await mockProvider.createBucket();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Permission denied");
    });
  });
});
