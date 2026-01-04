import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/setup.js";
import { createRepositories } from "../../../__tests__/helpers.js";
import { SettingKeys } from "../global-settings-repository.js";
import type { BackupConfig } from "../../database/schema.js";

describe("SqliteGlobalSettingsRepository", () => {
  let testDb: ReturnType<typeof createTestDatabase>;
  let repos: ReturnType<typeof createRepositories>;

  beforeEach(() => {
    testDb = createTestDatabase();
    repos = createRepositories(testDb.db);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("get/set", () => {
    it("should return null for non-existent key", () => {
      const value = repos.globalSettingsRepository.get(SettingKeys.BACKUP_CONFIG);
      expect(value).toBeNull();
    });

    it("should set and get a string value", () => {
      repos.globalSettingsRepository.set(SettingKeys.BACKUP_CONFIG, "test-value");
      const value = repos.globalSettingsRepository.get<string>(SettingKeys.BACKUP_CONFIG);
      expect(value).toBe("test-value");
    });

    it("should set and get an object value", () => {
      const config: BackupConfig = {
        provider: "s3",
        s3: {
          bucket: "my-bucket",
          region: "us-east-1",
          profile: "default",
        },
        retentionCount: 20,
      };

      repos.globalSettingsRepository.set(SettingKeys.BACKUP_CONFIG, config);
      const retrieved = repos.globalSettingsRepository.get<BackupConfig>(SettingKeys.BACKUP_CONFIG);

      expect(retrieved).toEqual(config);
    });

    it("should update an existing value", () => {
      repos.globalSettingsRepository.set(SettingKeys.BACKUP_CONFIG, "initial-value");
      repos.globalSettingsRepository.set(SettingKeys.BACKUP_CONFIG, "updated-value");

      const value = repos.globalSettingsRepository.get<string>(SettingKeys.BACKUP_CONFIG);
      expect(value).toBe("updated-value");
    });
  });

  describe("delete", () => {
    it("should delete an existing setting", () => {
      repos.globalSettingsRepository.set(SettingKeys.BACKUP_CONFIG, "test-value");
      repos.globalSettingsRepository.delete(SettingKeys.BACKUP_CONFIG);

      const value = repos.globalSettingsRepository.get(SettingKeys.BACKUP_CONFIG);
      expect(value).toBeNull();
    });

    it("should not throw when deleting non-existent key", () => {
      expect(() => repos.globalSettingsRepository.delete(SettingKeys.BACKUP_CONFIG)).not.toThrow();
    });
  });

  describe("getBackupConfig", () => {
    it("should return null when not configured", () => {
      const config = repos.globalSettingsRepository.getBackupConfig();
      expect(config).toBeNull();
    });

    it("should return backup config when set", () => {
      const config: BackupConfig = {
        provider: "s3",
        s3: {
          bucket: "backup-bucket",
          region: "eu-west-1",
          profile: "backup-profile",
        },
        retentionCount: 10,
      };

      repos.globalSettingsRepository.setBackupConfig(config);
      const retrieved = repos.globalSettingsRepository.getBackupConfig();

      expect(retrieved).toEqual(config);
    });
  });

  describe("setBackupConfig", () => {
    it("should save backup config with AWS profile", () => {
      const config: BackupConfig = {
        provider: "s3",
        s3: {
          bucket: "my-backup-bucket",
          region: "us-west-2",
          profile: "my-aws-profile",
        },
        retentionCount: 15,
      };

      repos.globalSettingsRepository.setBackupConfig(config);
      const retrieved = repos.globalSettingsRepository.getBackupConfig();

      expect(retrieved?.s3.profile).toBe("my-aws-profile");
      expect(retrieved?.s3.bucket).toBe("my-backup-bucket");
      expect(retrieved?.s3.accessKeyId).toBeUndefined();
    });

    it("should save backup config with explicit credentials", () => {
      const config: BackupConfig = {
        provider: "s3",
        s3: {
          bucket: "r2-bucket",
          region: "auto",
          endpoint: "https://account.r2.cloudflarestorage.com",
          accessKeyId: "my-access-key",
          secretAccessKey: "my-secret-key",
        },
        retentionCount: 20,
      };

      repos.globalSettingsRepository.setBackupConfig(config);
      const retrieved = repos.globalSettingsRepository.getBackupConfig();

      expect(retrieved?.s3.endpoint).toBe("https://account.r2.cloudflarestorage.com");
      expect(retrieved?.s3.accessKeyId).toBe("my-access-key");
      expect(retrieved?.s3.secretAccessKey).toBe("my-secret-key");
    });
  });

  describe("deleteBackupConfig", () => {
    it("should remove backup configuration", () => {
      const config: BackupConfig = {
        provider: "s3",
        s3: {
          bucket: "my-bucket",
          region: "us-east-1",
        },
        retentionCount: 20,
      };

      repos.globalSettingsRepository.setBackupConfig(config);
      expect(repos.globalSettingsRepository.getBackupConfig()).not.toBeNull();

      repos.globalSettingsRepository.deleteBackupConfig();
      expect(repos.globalSettingsRepository.getBackupConfig()).toBeNull();
    });
  });
});
