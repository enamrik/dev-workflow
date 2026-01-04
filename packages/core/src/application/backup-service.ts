/**
 * BackupService - Application service for database backups
 *
 * Orchestrates backup operations including:
 * - Creating backups with retention enforcement
 * - Listing available backups
 * - Restoring from backups
 */

import type {
  BackupProvider,
  BackupMetadata,
  BackupResult,
  RestoreResult,
} from "../domain/backup.js";
import { BackupError } from "../domain/backup.js";
import type { GlobalSettingsRepository } from "../infrastructure/repositories/global-settings-repository.js";
import { S3BackupProvider } from "../infrastructure/backup/s3-backup-provider.js";

/**
 * Default retention count if not specified
 */
const DEFAULT_RETENTION_COUNT = 20;

/**
 * BackupService - Manages database backup operations
 */
export class BackupService {
  constructor(private readonly settingsRepository: GlobalSettingsRepository) {}

  /**
   * Check if backup is configured
   */
  isConfigured(): boolean {
    return this.settingsRepository.getBackupConfig() !== null;
  }

  /**
   * Get the configured backup provider
   *
   * @throws BackupError if backup is not configured
   */
  private getProvider(): BackupProvider {
    const config = this.settingsRepository.getBackupConfig();

    if (!config) {
      throw new BackupError(
        "Backup is not configured. Use 'dev-workflow backup configure' to set up backup."
      );
    }

    if (config.provider !== "s3") {
      throw new BackupError(`Unknown backup provider: ${config.provider}`);
    }

    return new S3BackupProvider(config.s3);
  }

  /**
   * Get the configured retention count
   */
  private getRetentionCount(): number {
    const config = this.settingsRepository.getBackupConfig();
    return config?.retentionCount ?? DEFAULT_RETENTION_COUNT;
  }

  /**
   * Create a backup of the database
   *
   * @param databasePath - Path to the database file
   * @returns Backup result with key, timestamp, and retention info
   */
  async backup(databasePath: string): Promise<BackupResult> {
    const provider = this.getProvider();
    const retentionCount = this.getRetentionCount();

    // Create the backup
    const result = await provider.backup(databasePath);

    // Enforce retention
    const deletedCount = await provider.enforceRetention(retentionCount);

    return {
      ...result,
      deletedCount,
    };
  }

  /**
   * List all available backups
   *
   * @returns Array of backup metadata, sorted newest first
   */
  async listBackups(): Promise<BackupMetadata[]> {
    const provider = this.getProvider();
    return provider.listBackups();
  }

  /**
   * Restore a backup to the specified path
   *
   * @param key - Key of the backup to restore
   * @param targetPath - Path where to restore the database
   * @returns Restore result
   */
  async restore(key: string, targetPath: string): Promise<RestoreResult> {
    const provider = this.getProvider();
    return provider.restore(key, targetPath);
  }

  /**
   * Restore the most recent backup
   *
   * @param targetPath - Path where to restore the database
   * @returns Restore result
   * @throws BackupError if no backups are available
   */
  async restoreLatest(targetPath: string): Promise<RestoreResult> {
    const backups = await this.listBackups();

    if (backups.length === 0) {
      throw new BackupError("No backups available to restore");
    }

    const latestKey = backups[0]?.key;
    if (!latestKey) {
      throw new BackupError("No backups available to restore");
    }

    return this.restore(latestKey, targetPath);
  }
}
