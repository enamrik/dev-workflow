/**
 * BackupConfigService - CLI service for backup configuration and operations
 *
 * Handles backup configuration, triggering backups, and managing
 * the backup lifecycle from the CLI.
 */

import {
  getGlobalDatabasePath,
  DatabaseService,
  SqliteGlobalSettingsRepository,
  BackupService,
  type BackupConfig,
  type S3BackupConfig,
  type BackupMetadata,
  type BackupResult,
} from "@dev-workflow/core";

/**
 * Result of a backup configuration operation
 */
export interface ConfigureResult {
  success: boolean;
  message: string;
  config?: BackupConfig;
}

/**
 * Result of a backup list operation
 */
export interface ListBackupsResult {
  success: boolean;
  backups: BackupMetadata[];
}

/**
 * BackupConfigService - Manages backup configuration and operations
 */
export class BackupConfigService {
  private dbService: DatabaseService | null = null;
  private settingsRepository: SqliteGlobalSettingsRepository | null = null;
  private backupService: BackupService | null = null;

  /**
   * Initialize the database connection
   */
  private async initialize(): Promise<void> {
    if (this.dbService) {
      return;
    }

    const databasePath = getGlobalDatabasePath();
    this.dbService = await DatabaseService.create(databasePath);
    this.dbService.runMigrations();

    const db = this.dbService.getDb();
    this.settingsRepository = new SqliteGlobalSettingsRepository(db);
    this.backupService = new BackupService(this.settingsRepository);
  }

  /**
   * Check if backup is configured
   */
  async isConfigured(): Promise<boolean> {
    await this.initialize();
    return this.backupService!.isConfigured();
  }

  /**
   * Get current backup configuration
   */
  async getConfig(): Promise<BackupConfig | null> {
    await this.initialize();
    return this.settingsRepository!.getBackupConfig();
  }

  /**
   * Configure S3 backup
   */
  async configureS3(
    s3Config: S3BackupConfig,
    retentionCount: number = 20
  ): Promise<ConfigureResult> {
    await this.initialize();

    const config: BackupConfig = {
      provider: "s3",
      s3: s3Config,
      retentionCount,
    };

    try {
      this.settingsRepository!.setBackupConfig(config);
      return {
        success: true,
        message: "Backup configured successfully",
        config,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to save backup configuration: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Remove backup configuration
   */
  async removeConfig(): Promise<ConfigureResult> {
    await this.initialize();

    try {
      this.settingsRepository!.deleteBackupConfig();
      return {
        success: true,
        message: "Backup configuration removed",
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to remove backup configuration: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Create a backup
   */
  async backup(): Promise<BackupResult> {
    await this.initialize();
    const databasePath = getGlobalDatabasePath();
    return this.backupService!.backup(databasePath);
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<BackupMetadata[]> {
    await this.initialize();
    return this.backupService!.listBackups();
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.dbService) {
      this.dbService.close();
      this.dbService = null;
      this.settingsRepository = null;
      this.backupService = null;
    }
  }
}
