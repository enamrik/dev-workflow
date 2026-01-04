/**
 * S3BackupProvider - Backup provider for S3-compatible storage
 *
 * Supports AWS S3, Cloudflare R2, MinIO, and other S3-compatible services.
 * Uses AWS credential chain by default (profiles, env vars, IAM roles).
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-providers";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { Readable } from "node:stream";
import type {
  BackupProvider,
  BackupMetadata,
  BackupResult,
  RestoreResult,
} from "../../domain/backup.js";
import { BackupError } from "../../domain/backup.js";
import type { S3BackupConfig } from "../database/schema.js";

/**
 * Prefix for all backup objects in the bucket
 */
const BACKUP_PREFIX = "dev-workflow-backups/";

/**
 * Generate a backup key with timestamp
 */
function generateBackupKey(timestamp: Date): string {
  const isoDate = timestamp.toISOString().replace(/[:.]/g, "-");
  return `${BACKUP_PREFIX}workflow-${isoDate}.db`;
}

/**
 * Parse timestamp from backup key
 */
function parseTimestampFromKey(key: string): Date | null {
  const match = key.match(/workflow-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.db$/);
  if (!match?.[1]) {
    return null;
  }
  // Convert dashes back to colons and dots for ISO parsing
  const isoString = match[1].replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ":$1:$2.$3Z");
  const date = new Date(isoString);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Calculate SHA-256 checksum of a file
 */
async function calculateChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * S3-compatible backup provider implementation
 *
 * Authentication priority:
 * 1. Explicit credentials (accessKeyId/secretAccessKey) - for non-AWS S3-compatible services
 * 2. AWS profile from ~/.aws/credentials - if profile is specified
 * 3. Default AWS credential chain - env vars, default profile, IAM roles
 */
export class S3BackupProvider implements BackupProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3BackupConfig) {
    this.bucket = config.bucket;

    // Build S3 client configuration
    const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
      region: config.region,
    };

    // Determine credential source
    if (config.accessKeyId && config.secretAccessKey) {
      // Explicit credentials (for R2, MinIO, or manual setup)
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    } else if (config.profile) {
      // Use specific AWS profile
      clientConfig.credentials = fromIni({ profile: config.profile });
    }
    // Otherwise, use default credential chain (env vars, default profile, IAM)

    // Custom endpoint for S3-compatible services
    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
    }

    this.client = new S3Client(clientConfig);
  }

  async backup(sourcePath: string): Promise<BackupResult> {
    // Verify source file exists
    if (!fs.existsSync(sourcePath)) {
      throw new BackupError(`Source file not found: ${sourcePath}`);
    }

    const timestamp = new Date();
    const key = generateBackupKey(timestamp);

    // Calculate checksum before upload
    const checksum = await calculateChecksum(sourcePath);

    // Read file and upload
    const fileContent = fs.readFileSync(sourcePath);

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: fileContent,
          ContentType: "application/x-sqlite3",
          Metadata: {
            checksum,
            timestamp: timestamp.toISOString(),
          },
        })
      );

      return {
        success: true,
        key,
        timestamp,
        checksum,
        deletedCount: 0, // Retention is handled separately
      };
    } catch (error) {
      throw new BackupError(
        `Failed to upload backup to S3: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  async listBackups(): Promise<BackupMetadata[]> {
    const backups: BackupMetadata[] = [];

    try {
      let continuationToken: string | undefined;

      do {
        const response = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: BACKUP_PREFIX,
            ContinuationToken: continuationToken,
          })
        );

        for (const obj of response.Contents ?? []) {
          if (!obj.Key || !obj.Size || !obj.LastModified) {
            continue;
          }

          const timestamp = parseTimestampFromKey(obj.Key);
          if (!timestamp) {
            continue; // Skip non-backup files
          }

          // Get metadata including checksum
          let checksum = "";
          try {
            const headResponse = await this.client.send(
              new HeadObjectCommand({
                Bucket: this.bucket,
                Key: obj.Key,
              })
            );
            checksum = headResponse.Metadata?.["checksum"] ?? "";
          } catch {
            // Ignore errors getting metadata
          }

          backups.push({
            key: obj.Key,
            timestamp,
            sizeBytes: obj.Size,
            checksum,
            etag: obj.ETag,
          });
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      // Sort by timestamp descending (newest first)
      backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      return backups;
    } catch (error) {
      throw new BackupError(
        `Failed to list backups from S3: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  async restore(key: string, targetPath: string): Promise<RestoreResult> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      if (!response.Body) {
        throw new BackupError(`Empty response body for key: ${key}`);
      }

      // Write to target path
      const writeStream = fs.createWriteStream(targetPath);
      const body = response.Body as Readable;

      await new Promise<void>((resolve, reject) => {
        body.pipe(writeStream);
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
        body.on("error", reject);
      });

      const timestamp = parseTimestampFromKey(key) ?? new Date();

      return {
        success: true,
        key,
        timestamp,
        restoredTo: targetPath,
      };
    } catch (error) {
      if (error instanceof BackupError) {
        throw error;
      }
      throw new BackupError(
        `Failed to restore backup from S3: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  async enforceRetention(retentionCount: number): Promise<number> {
    if (retentionCount < 1) {
      throw new BackupError("Retention count must be at least 1");
    }

    const backups = await this.listBackups();

    // If we have fewer backups than retention, nothing to delete
    if (backups.length <= retentionCount) {
      return 0;
    }

    // Get keys to delete (everything after retentionCount)
    const toDelete = backups.slice(retentionCount);

    if (toDelete.length === 0) {
      return 0;
    }

    try {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: toDelete.map((backup) => ({ Key: backup.key })),
          },
        })
      );

      return toDelete.length;
    } catch (error) {
      throw new BackupError(
        `Failed to delete old backups: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }
}
