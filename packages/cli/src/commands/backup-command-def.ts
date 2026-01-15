/**
 * Backup Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with BackupCommand class for testability.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import type { BackupCommand, S3ConfigOptions, RestoreOptions } from "./backup-command.js";

/**
 * Options for backup commands (currently no options for create)
 */
export type BackupCreateOptions = Record<string, never>;

/**
 * Handler for backup create command.
 */
export const handleBackupCreate = createCliHandler(
  async (_options: BackupCreateOptions, { backupCommand }: { backupCommand: BackupCommand }) => {
    await backupCommand.create();
  },
  defaultMiddleware
);

/**
 * Handler for backup configure command.
 */
export const handleBackupConfigure = createCliHandler(
  async (options: S3ConfigOptions, { backupCommand }: { backupCommand: BackupCommand }) => {
    await backupCommand.configure(options);
  },
  defaultMiddleware
);

/**
 * Handler for backup setup command.
 */
export const handleBackupSetup = createCliHandler(
  async (_options: BackupCreateOptions, { backupCommand }: { backupCommand: BackupCommand }) => {
    await backupCommand.setup();
  },
  defaultMiddleware
);

/**
 * Handler for backup status command.
 */
export const handleBackupStatus = createCliHandler(
  async (_options: BackupCreateOptions, { backupCommand }: { backupCommand: BackupCommand }) => {
    await backupCommand.status();
  },
  defaultMiddleware
);

/**
 * Handler for backup list command.
 */
export const handleBackupList = createCliHandler(
  async (_options: BackupCreateOptions, { backupCommand }: { backupCommand: BackupCommand }) => {
    await backupCommand.list();
  },
  defaultMiddleware
);

/**
 * Handler for backup unconfigure command.
 */
export const handleBackupUnconfigure = createCliHandler(
  async (_options: BackupCreateOptions, { backupCommand }: { backupCommand: BackupCommand }) => {
    await backupCommand.unconfigure();
  },
  defaultMiddleware
);

/**
 * Handler for restore command.
 */
export interface RestoreHandlerOptions extends RestoreOptions {
  backup?: string;
}

export const handleRestore = createCliHandler(
  async (options: RestoreHandlerOptions, { backupCommand }: { backupCommand: BackupCommand }) => {
    await backupCommand.restore(options.backup, options);
  },
  defaultMiddleware
);

/**
 * Executable runners.
 */
export const runBackupCreate = createCliCommand(handleBackupCreate);
export const runBackupConfigure = createCliCommand(handleBackupConfigure);
export const runBackupSetup = createCliCommand(handleBackupSetup);
export const runBackupStatus = createCliCommand(handleBackupStatus);
export const runBackupList = createCliCommand(handleBackupList);
export const runBackupUnconfigure = createCliCommand(handleBackupUnconfigure);
export const runRestore = createCliCommand(handleRestore);
