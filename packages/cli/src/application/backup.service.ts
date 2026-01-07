/**
 * BackupConfigService - CLI service for backup configuration and operations
 *
 * Handles backup configuration, triggering backups, and managing
 * the backup lifecycle from the CLI.
 */

import {
  getGlobalDatabasePath,
  DataSourceFactory,
  SqliteGlobalSettingsRepository,
  BackupService,
  S3BackupProvider,
  type BackupConfig,
  type S3BackupConfig,
  type BackupMetadata,
  type BackupResult,
  type RestoreResult,
  type ValidationResult,
  type CreateBucketResult,
  type SqliteDataSource,
} from "@dev-workflow/core";
import * as fs from "node:fs";
import * as path from "node:path";

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
  private dbService: SqliteDataSource | null = null;
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
    this.dbService = await DataSourceFactory.createSqlite(databasePath);
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
   * Validate S3 credentials without saving configuration
   * Creates a temporary provider to test connectivity
   */
  async validateS3Credentials(s3Config: S3BackupConfig): Promise<ValidationResult> {
    const provider = new S3BackupProvider(s3Config);
    return provider.validateCredentials();
  }

  /**
   * Create an S3 bucket
   * Creates a temporary provider to create the bucket
   */
  async createS3Bucket(s3Config: S3BackupConfig): Promise<CreateBucketResult> {
    const provider = new S3BackupProvider(s3Config);
    return provider.createBucket();
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
   *
   * Checkpoints WAL before backup to ensure all pending writes
   * are flushed to the main database file.
   */
  async backup(): Promise<BackupResult> {
    await this.initialize();

    // Checkpoint WAL to ensure backup includes all pending writes
    this.dbService!.checkpoint();

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
   * Restore a backup by key or index
   *
   * @param identifier - Backup key, timestamp string, or 1-based index (e.g., "1" for most recent)
   * @returns Restore result
   */
  async restore(identifier: string): Promise<RestoreResult> {
    await this.initialize();

    const backups = await this.backupService!.listBackups();
    if (backups.length === 0) {
      throw new Error("No backups available to restore");
    }

    // Find the backup by identifier
    const backup = this.findBackup(backups, identifier);
    if (!backup) {
      throw new Error(
        `Backup not found: ${identifier}\n` +
          `Use 'dev-workflow backup list' to see available backups.\n` +
          `You can specify a backup by:\n` +
          `  - Index (1 = most recent, 2 = second most recent, etc.)\n` +
          `  - Timestamp (e.g., 2026-01-04T21:30:05.528Z)\n` +
          `  - Full key (e.g., dev-workflow-backups/workflow-2026-01-04T21-30-05-528Z.db)`
      );
    }

    const databasePath = getGlobalDatabasePath();
    return this.backupService!.restore(backup.key, databasePath);
  }

  /**
   * Restore the most recent backup
   */
  async restoreLatest(): Promise<RestoreResult> {
    await this.initialize();
    const databasePath = getGlobalDatabasePath();
    return this.backupService!.restoreLatest(databasePath);
  }

  /**
   * Create a local safety backup before restore
   *
   * @returns Path to the safety backup file
   */
  async createSafetyBackup(): Promise<string> {
    const databasePath = getGlobalDatabasePath();

    if (!fs.existsSync(databasePath)) {
      throw new Error(`Database not found at ${databasePath}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.dirname(databasePath);
    const safetyBackupPath = path.join(backupDir, `workflow.db.pre-restore-${timestamp}.bak`);

    fs.copyFileSync(databasePath, safetyBackupPath);
    return safetyBackupPath;
  }

  /**
   * Get the database path
   */
  getDatabasePath(): string {
    return getGlobalDatabasePath();
  }

  /**
   * Find a backup by identifier (index, timestamp, or key)
   */
  private findBackup(backups: BackupMetadata[], identifier: string): BackupMetadata | undefined {
    // Try parsing as 1-based index
    const index = parseInt(identifier, 10);
    if (!isNaN(index) && index >= 1 && index <= backups.length) {
      return backups[index - 1];
    }

    // Try matching by timestamp (ISO string)
    const byTimestamp = backups.find((b) => b.timestamp.toISOString() === identifier);
    if (byTimestamp) {
      return byTimestamp;
    }

    // Try matching by key
    const byKey = backups.find((b) => b.key === identifier);
    if (byKey) {
      return byKey;
    }

    // Try partial key match (just the filename part)
    const byPartialKey = backups.find(
      (b) => b.key.includes(identifier) || identifier.includes(b.key)
    );
    return byPartialKey;
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
