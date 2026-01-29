/**
 * BackupCommand - Backup and restore workflow database
 *
 * Handles backup configuration, creation, listing, and restoration.
 * Receives all dependencies via constructor injection.
 */

import { BackupConfigService } from "../application/backup.service.js";

export interface S3ConfigOptions {
  bucket: string;
  region: string;
  profile?: string;
  accessKey?: string;
  secretKey?: string;
  endpoint?: string;
  retention?: string;
  createBucket?: boolean;
  validate?: boolean;
}

export interface RestoreOptions {
  yes?: boolean;
  safetyBackup?: boolean;
}

export class BackupCommand {
  constructor(private readonly backupService: BackupConfigService) {}

  /**
   * Create a backup of the workflow database.
   */
  async create(): Promise<void> {
    try {
      const isConfigured = await this.backupService.isConfigured();
      if (!isConfigured) {
        console.error("❌ Backup is not configured.");
        console.error("\nRun: dev-workflow backup configure");
        process.exit(1);
      }

      console.log("📦 Creating backup...");
      const result = await this.backupService.backup();

      console.log("\n✓ Backup created successfully!");
      console.log(`  Key: ${result.key}`);
      console.log(`  Timestamp: ${result.timestamp.toISOString()}`);
      console.log(`  Checksum: ${result.checksum.slice(0, 16)}...`);

      if (result.deletedCount > 0) {
        console.log(`  Deleted ${result.deletedCount} old backup(s) (retention policy)`);
      }
    } catch (error) {
      console.error(`❌ Backup failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  /**
   * Configure S3-compatible backup destination.
   */
  async configure(options: S3ConfigOptions): Promise<void> {
    try {
      const retentionCount = parseInt(options.retention ?? "20", 10);
      if (isNaN(retentionCount) || retentionCount < 1) {
        console.error("❌ Retention count must be a positive integer");
        process.exit(1);
      }

      // Validate credential options
      const hasExplicitCreds = options.accessKey && options.secretKey;
      const hasPartialCreds =
        (options.accessKey && !options.secretKey) || (!options.accessKey && options.secretKey);

      if (hasPartialCreds) {
        console.error("❌ Both --access-key and --secret-key must be provided together");
        process.exit(1);
      }

      const s3Config = {
        bucket: options.bucket,
        region: options.region,
        profile: options.profile,
        accessKeyId: options.accessKey,
        secretAccessKey: options.secretKey,
        endpoint: options.endpoint,
      };

      // Validate credentials and check bucket if --validate or --create-bucket
      if (options.validate || options.createBucket) {
        console.log("Validating credentials...");
        const validation = await this.backupService.validateS3Credentials(s3Config);

        if (!validation.success) {
          console.error(`❌ ${validation.error}`);
          process.exit(1);
        }
        console.log("✓ Credentials are valid!");

        if (!validation.bucketExists) {
          if (options.createBucket) {
            console.log(`\nBucket '${options.bucket}' does not exist. Creating...`);
            const createResult = await this.backupService.createS3Bucket(s3Config);

            if (createResult.success) {
              console.log(`✓ Bucket '${options.bucket}' created successfully!`);
            } else {
              console.error(`❌ Failed to create bucket: ${createResult.error}`);
              process.exit(1);
            }
          } else {
            console.error(`\n❌ Bucket '${options.bucket}' does not exist.`);
            console.error("   Use --create-bucket to create it automatically.");
            process.exit(1);
          }
        } else {
          console.log(`✓ Bucket '${options.bucket}' exists and is accessible.`);
        }
        console.log();
      }

      const result = await this.backupService.configureS3(s3Config, retentionCount);

      if (result.success) {
        console.log("✓ Backup configured successfully!");
        console.log(`  Provider: S3-compatible`);
        console.log(`  Bucket: ${options.bucket}`);
        console.log(`  Region: ${options.region}`);
        console.log(`  Retention: ${retentionCount} backups`);
        if (options.profile) {
          console.log(`  AWS Profile: ${options.profile}`);
        } else if (hasExplicitCreds) {
          console.log(`  Auth: Explicit credentials`);
        } else {
          console.log(`  Auth: Default AWS credential chain`);
        }
        if (options.endpoint) {
          console.log(`  Endpoint: ${options.endpoint}`);
        }
        console.log("\nRun 'dev-workflow backup' to create your first backup.");
      } else {
        console.error(`❌ ${result.message}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(
        `❌ Configuration failed: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  }

  /**
   * Interactive setup wizard for backup configuration.
   */
  async setup(): Promise<void> {
    const readline = await import("node:readline");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (prompt: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
          resolve(answer.trim());
        });
      });
    };

    try {
      console.log("\n📦 Backup Setup Wizard\n");
      console.log("This wizard will help you configure S3-compatible backup storage.");
      console.log("Your credentials will be validated before saving.\n");

      // Step 1: Auth method selection
      console.log("Step 1: Authentication Method\n");
      console.log("  1. AWS Profile (from ~/.aws/credentials)");
      console.log("  2. Explicit credentials (access key + secret key)");
      console.log("  3. Default AWS credential chain (env vars, IAM role, etc.)\n");

      let authMethod: "profile" | "explicit" | "default" | null = null;
      while (!authMethod) {
        const choice = await question("Select auth method (1-3): ");
        if (choice === "1") authMethod = "profile";
        else if (choice === "2") authMethod = "explicit";
        else if (choice === "3") authMethod = "default";
        else console.log("Please enter 1, 2, or 3.");
      }

      // Gather auth-specific details
      let profile: string | undefined;
      let accessKeyId: string | undefined;
      let secretAccessKey: string | undefined;

      if (authMethod === "profile") {
        profile = await question("\nAWS profile name: ");
        if (!profile) {
          console.error("\n❌ Profile name is required.");
          process.exit(1);
        }
      } else if (authMethod === "explicit") {
        accessKeyId = await question("\nAWS Access Key ID: ");
        if (!accessKeyId) {
          console.error("\n❌ Access Key ID is required.");
          process.exit(1);
        }
        secretAccessKey = await question("AWS Secret Access Key: ");
        if (!secretAccessKey) {
          console.error("\n❌ Secret Access Key is required.");
          process.exit(1);
        }
      }

      // Step 2: Bucket and region
      console.log("\nStep 2: S3 Bucket Configuration\n");

      const bucket = await question("S3 bucket name: ");
      if (!bucket) {
        console.error("\n❌ Bucket name is required.");
        process.exit(1);
      }

      const region = await question("AWS region (e.g., us-east-1): ");
      if (!region) {
        console.error("\n❌ Region is required.");
        process.exit(1);
      }

      // Optional: custom endpoint for S3-compatible services
      const endpointInput = await question("Custom endpoint (leave empty for AWS S3): ");
      const endpoint = endpointInput || undefined;

      // Optional: retention count
      const retentionInput = await question("Number of backups to keep [20]: ");
      const retentionCount = retentionInput ? parseInt(retentionInput, 10) : 20;
      if (isNaN(retentionCount) || retentionCount < 1) {
        console.error("\n❌ Retention count must be a positive integer.");
        process.exit(1);
      }

      // Build the config
      const s3Config = {
        bucket,
        region,
        profile,
        accessKeyId,
        secretAccessKey,
        endpoint,
      };

      // Step 3: Validate credentials
      console.log("\nStep 3: Validating credentials...\n");

      const validation = await this.backupService.validateS3Credentials(s3Config);

      if (!validation.success) {
        console.error(`❌ Validation failed: ${validation.error}`);
        process.exit(1);
      }

      console.log("✓ Credentials are valid!\n");

      // Step 4: Check bucket existence
      if (!validation.bucketExists) {
        console.log(`⚠️  Bucket '${bucket}' does not exist.\n`);

        const createChoice = await question("Would you like to create it? (y/n): ");

        if (createChoice.toLowerCase() === "y" || createChoice.toLowerCase() === "yes") {
          console.log("\nCreating bucket...");

          const createResult = await this.backupService.createS3Bucket(s3Config);

          if (createResult.success) {
            console.log(`✓ Bucket '${bucket}' created successfully!\n`);
          } else {
            console.error(`\n❌ Failed to create bucket: ${createResult.error}`);
            console.log("\nYou can create the bucket manually and run this wizard again.");
            process.exit(1);
          }
        } else {
          console.log("\nPlease create the bucket manually and run this wizard again.");
          process.exit(0);
        }
      } else {
        console.log(`✓ Bucket '${bucket}' exists and is accessible.\n`);
      }

      // Step 5: Save configuration
      console.log("Saving configuration...\n");

      const result = await this.backupService.configureS3(s3Config, retentionCount);

      if (result.success) {
        console.log("✓ Backup configured successfully!\n");
        console.log("Configuration:");
        console.log(`  Provider: S3-compatible`);
        console.log(`  Bucket: ${bucket}`);
        console.log(`  Region: ${region}`);
        console.log(`  Retention: ${retentionCount} backups`);
        if (profile) {
          console.log(`  AWS Profile: ${profile}`);
        } else if (accessKeyId) {
          console.log(`  Auth: Explicit credentials`);
        } else {
          console.log(`  Auth: Default AWS credential chain`);
        }
        if (endpoint) {
          console.log(`  Endpoint: ${endpoint}`);
        }
        console.log("\nRun 'dev-workflow backup' to create your first backup.");
      } else {
        console.error(`❌ ${result.message}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`\n❌ Setup failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    } finally {
      rl.close();
    }
  }

  /**
   * Show current backup configuration.
   */
  async status(): Promise<void> {
    try {
      const config = await this.backupService.getConfig();

      if (!config) {
        console.log("Backup is not configured.");
        console.log("\nRun: dev-workflow backup configure --help");
        return;
      }

      console.log("Backup Configuration:");
      console.log(`  Provider: ${config.provider}`);
      console.log(`  Bucket: ${config.s3.bucket}`);
      console.log(`  Region: ${config.s3.region}`);
      console.log(`  Retention: ${config.retentionCount} backups`);

      // Show auth method
      if (config.s3.accessKeyId) {
        console.log(`  Auth: Explicit credentials (${config.s3.accessKeyId.slice(0, 4)}...)`);
      } else if (config.s3.profile) {
        console.log(`  AWS Profile: ${config.s3.profile}`);
      } else {
        console.log(`  Auth: Default AWS credential chain`);
      }

      if (config.s3.endpoint) {
        console.log(`  Endpoint: ${config.s3.endpoint}`);
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  /**
   * List available backups.
   */
  async list(): Promise<void> {
    try {
      const isConfigured = await this.backupService.isConfigured();
      if (!isConfigured) {
        console.error("❌ Backup is not configured.");
        console.error("\nRun: dev-workflow backup configure");
        process.exit(1);
      }

      console.log("Fetching backups...\n");
      const backups = await this.backupService.listBackups();

      if (backups.length === 0) {
        console.log("No backups found.");
        console.log("\nRun 'dev-workflow backup' to create your first backup.");
        return;
      }

      console.log(`Found ${backups.length} backup(s):\n`);

      for (const backup of backups) {
        const sizeKB = (backup.sizeBytes / 1024).toFixed(1);
        console.log(`  ${backup.timestamp.toISOString()}`);
        console.log(`    Key: ${backup.key}`);
        console.log(`    Size: ${sizeKB} KB`);
        if (backup.checksum) {
          console.log(`    Checksum: ${backup.checksum.slice(0, 16)}...`);
        }
        console.log();
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  /**
   * Remove backup configuration.
   */
  async unconfigure(): Promise<void> {
    try {
      const result = await this.backupService.removeConfig();

      if (result.success) {
        console.log("✓ Backup configuration removed.");
        console.log("\nNote: Existing backups in S3 are not deleted.");
      } else {
        console.error(`❌ ${result.message}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  /**
   * Restore workflow database from a backup.
   */
  async restore(backup: string | undefined, options: RestoreOptions): Promise<void> {
    try {
      const isConfigured = await this.backupService.isConfigured();
      if (!isConfigured) {
        console.error("❌ Backup is not configured.");
        console.error("\nRun: dev-workflow backup configure");
        process.exit(1);
      }

      // Get list of backups to show context
      const backups = await this.backupService.listBackups();
      if (backups.length === 0) {
        console.error("❌ No backups available to restore.");
        console.error("\nRun 'dev-workflow backup' to create a backup first.");
        process.exit(1);
      }

      // Determine which backup to restore
      let backupIdentifier: string;
      if (backup) {
        backupIdentifier = backup;
      } else {
        // Default to most recent
        backupIdentifier = "1";
        console.log("No backup specified, will restore most recent backup.\n");
      }

      // Show backup details and confirm
      const targetBackup = backupIdentifier === "1" || !backup ? backups[0] : undefined;

      if (targetBackup) {
        console.log("Backup to restore:");
        console.log(`  Timestamp: ${targetBackup.timestamp.toISOString()}`);
        console.log(`  Size: ${(targetBackup.sizeBytes / 1024).toFixed(1)} KB`);
        if (targetBackup.checksum) {
          console.log(`  Checksum: ${targetBackup.checksum.slice(0, 16)}...`);
        }
      } else {
        console.log(`Backup identifier: ${backupIdentifier}`);
      }

      console.log(`\nTarget: ${this.backupService.getDatabasePath()}`);

      // Confirmation prompt
      if (!options.yes) {
        console.log("\n⚠️  WARNING: This will REPLACE your current workflow database!");
        console.log("   All current issues, plans, and tasks will be replaced with the backup.\n");

        const readline = await import("node:readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question("Type 'restore' to confirm: ", (answer) => {
            rl.close();
            resolve(answer);
          });
        });

        if (answer.toLowerCase() !== "restore") {
          console.log("\n❌ Restore cancelled.");
          process.exit(1);
        }
      }

      // Create safety backup if enabled
      if (options.safetyBackup !== false) {
        console.log("\n📋 Creating safety backup of current database...");
        try {
          const safetyPath = await this.backupService.createSafetyBackup();
          console.log(`✓ Safety backup created: ${safetyPath}`);
        } catch (error) {
          console.error(
            `⚠️  Could not create safety backup: ${error instanceof Error ? error.message : String(error)}`
          );
          console.error("   Proceeding with restore anyway...");
        }
      }

      // Perform restore
      console.log("\n📥 Downloading and restoring backup...");
      const result = await this.backupService.restore(backupIdentifier);

      console.log("\n✓ Database restored successfully!");
      console.log(`  From: ${result.key}`);
      console.log(`  Timestamp: ${result.timestamp.toISOString()}`);
      console.log(`  Restored to: ${result.restoredTo}`);

      console.log("\n⚠️  IMPORTANT: Restart Claude Code to reload the restored data.");
    } catch (error) {
      console.error(
        `\n❌ Restore failed: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  }
}
