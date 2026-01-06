/**
 * GlobalSettingsRepository - Manages global application settings
 *
 * Stores application-wide settings that are not project-specific,
 * such as backup configuration.
 */

import { eq } from "drizzle-orm";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  globalSettings,
  GlobalSettingsRow,
  BackupConfig,
  DatabaseConfig,
} from "../database/schema.js";
import * as schema from "../database/schema.js";

/**
 * Well-known setting keys
 */
export const SettingKeys = {
  BACKUP_CONFIG: "backup_config",
  DATABASE_CONFIG: "database_config",
} as const;

export type SettingKey = (typeof SettingKeys)[keyof typeof SettingKeys];

/**
 * Interface for global settings repository
 */
export interface GlobalSettingsRepository {
  /**
   * Get a setting value by key
   *
   * @param key - Setting key
   * @returns Setting value or null if not found
   */
  get<T>(key: SettingKey): T | null;

  /**
   * Set a setting value
   *
   * @param key - Setting key
   * @param value - Setting value (will be JSON serialized)
   */
  set<T>(key: SettingKey, value: T): void;

  /**
   * Delete a setting
   *
   * @param key - Setting key
   */
  delete(key: SettingKey): void;

  /**
   * Get backup configuration
   *
   * @returns Backup config or null if not configured
   */
  getBackupConfig(): BackupConfig | null;

  /**
   * Set backup configuration
   *
   * @param config - Backup configuration
   */
  setBackupConfig(config: BackupConfig): void;

  /**
   * Delete backup configuration
   */
  deleteBackupConfig(): void;

  /**
   * Get database configuration
   *
   * @returns Database config or null if not configured (defaults to SQLite)
   */
  getDatabaseConfig(): DatabaseConfig | null;

  /**
   * Set database configuration
   *
   * @param config - Database configuration
   */
  setDatabaseConfig(config: DatabaseConfig): void;

  /**
   * Delete database configuration (resets to default SQLite)
   */
  deleteDatabaseConfig(): void;
}

/**
 * SQLite implementation of GlobalSettingsRepository
 */
export class SqliteGlobalSettingsRepository implements GlobalSettingsRepository {
  constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  get<T>(key: SettingKey): T | null {
    const result = this.db.select().from(globalSettings).where(eq(globalSettings.key, key)).get();

    if (!result) {
      return null;
    }

    return result.value as T;
  }

  set<T>(key: SettingKey, value: T): void {
    const now = new Date().toISOString();
    const existing = this.db.select().from(globalSettings).where(eq(globalSettings.key, key)).get();

    if (existing) {
      this.db
        .update(globalSettings)
        .set({
          value: value as GlobalSettingsRow["value"],
          updatedAt: now,
        })
        .where(eq(globalSettings.key, key))
        .run();
    } else {
      this.db
        .insert(globalSettings)
        .values({
          key,
          value: value as GlobalSettingsRow["value"],
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  delete(key: SettingKey): void {
    this.db.delete(globalSettings).where(eq(globalSettings.key, key)).run();
  }

  getBackupConfig(): BackupConfig | null {
    return this.get<BackupConfig>(SettingKeys.BACKUP_CONFIG);
  }

  setBackupConfig(config: BackupConfig): void {
    this.set(SettingKeys.BACKUP_CONFIG, config);
  }

  deleteBackupConfig(): void {
    this.delete(SettingKeys.BACKUP_CONFIG);
  }

  getDatabaseConfig(): DatabaseConfig | null {
    return this.get<DatabaseConfig>(SettingKeys.DATABASE_CONFIG);
  }

  setDatabaseConfig(config: DatabaseConfig): void {
    this.set(SettingKeys.DATABASE_CONFIG, config);
  }

  deleteDatabaseConfig(): void {
    this.delete(SettingKeys.DATABASE_CONFIG);
  }
}
