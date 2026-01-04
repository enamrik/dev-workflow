/**
 * Backup domain types and interfaces
 *
 * Defines the contracts for backup providers and backup metadata.
 */

/**
 * Metadata about a backup stored in the remote location
 */
export interface BackupMetadata {
  /** Unique key/path in the backup storage */
  key: string;

  /** Timestamp when the backup was created */
  timestamp: Date;

  /** Size of the backup in bytes */
  sizeBytes: number;

  /** SHA-256 checksum of the backup file */
  checksum: string;

  /** ETag from S3 (or equivalent) for cache validation */
  etag?: string;
}

/**
 * Result of a backup operation
 */
export interface BackupResult {
  /** Whether the backup was successful */
  success: boolean;

  /** Key/path where the backup was stored */
  key: string;

  /** Timestamp of the backup */
  timestamp: Date;

  /** SHA-256 checksum of the uploaded file */
  checksum: string;

  /** Number of old backups deleted during retention enforcement */
  deletedCount: number;
}

/**
 * Result of a restore operation
 */
export interface RestoreResult {
  /** Whether the restore was successful */
  success: boolean;

  /** Key of the backup that was restored */
  key: string;

  /** Timestamp of the restored backup */
  timestamp: Date;

  /** Path where the database was restored to */
  restoredTo: string;
}

/**
 * Interface for backup storage providers
 *
 * Implementations handle uploading, downloading, and managing backups
 * in a specific storage backend (S3, R2, GCS, etc.).
 */
export interface BackupProvider {
  /**
   * Upload a database backup to remote storage
   *
   * @param sourcePath - Path to the local database file
   * @returns Backup result with key, timestamp, and checksum
   */
  backup(sourcePath: string): Promise<BackupResult>;

  /**
   * List all available backups
   *
   * @returns Array of backup metadata, sorted by timestamp descending (newest first)
   */
  listBackups(): Promise<BackupMetadata[]>;

  /**
   * Restore a specific backup to a local path
   *
   * @param key - Key of the backup to restore
   * @param targetPath - Path where to restore the database
   * @returns Restore result
   */
  restore(key: string, targetPath: string): Promise<RestoreResult>;

  /**
   * Enforce retention policy by deleting old backups
   *
   * @param retentionCount - Number of backups to keep
   * @returns Number of backups deleted
   */
  enforceRetention(retentionCount: number): Promise<number>;
}

/**
 * Error thrown when backup operations fail
 */
export class BackupError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "BackupError";
  }
}
