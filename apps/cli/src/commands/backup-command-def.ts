/**
 * Backup Command Handlers and Runners
 *
 * Uses the Awilix DI pattern with BackupCommand class for testability.
 */

import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { BackupCommandTag } from "../di/cli-tags.js";
import type { S3ConfigOptions, RestoreOptions } from "./backup-command.js";

/**
 * Options for backup commands (currently no options for create)
 */
export type BackupCreateOptions = Record<string, never>;

/**
 * Handler for backup create command.
 */
export const handleBackupCreate = createCliHandler({
  handler: (_options: BackupCreateOptions) =>
    Effect.gen(function* () {
      const backupCommand = yield* BackupCommandTag;
      yield* Effect.promise(() => backupCommand.create());
    }),
  middleware: defaultMiddleware,
});

/**
 * Handler for backup configure command.
 */
export const handleBackupConfigure = createCliHandler({
  handler: (options: S3ConfigOptions) =>
    Effect.gen(function* () {
      const backupCommand = yield* BackupCommandTag;
      yield* Effect.promise(() => backupCommand.configure(options));
    }),
  middleware: defaultMiddleware,
});

/**
 * Handler for backup setup command.
 */
export const handleBackupSetup = createCliHandler({
  handler: (_options: BackupCreateOptions) =>
    Effect.gen(function* () {
      const backupCommand = yield* BackupCommandTag;
      yield* Effect.promise(() => backupCommand.setup());
    }),
  middleware: defaultMiddleware,
});

/**
 * Handler for backup status command.
 */
export const handleBackupStatus = createCliHandler({
  handler: (_options: BackupCreateOptions) =>
    Effect.gen(function* () {
      const backupCommand = yield* BackupCommandTag;
      yield* Effect.promise(() => backupCommand.status());
    }),
  middleware: defaultMiddleware,
});

/**
 * Handler for backup list command.
 */
export const handleBackupList = createCliHandler({
  handler: (_options: BackupCreateOptions) =>
    Effect.gen(function* () {
      const backupCommand = yield* BackupCommandTag;
      yield* Effect.promise(() => backupCommand.list());
    }),
  middleware: defaultMiddleware,
});

/**
 * Handler for backup unconfigure command.
 */
export const handleBackupUnconfigure = createCliHandler({
  handler: (_options: BackupCreateOptions) =>
    Effect.gen(function* () {
      const backupCommand = yield* BackupCommandTag;
      yield* Effect.promise(() => backupCommand.unconfigure());
    }),
  middleware: defaultMiddleware,
});

/**
 * Handler for restore command.
 */
export interface RestoreHandlerOptions extends RestoreOptions {
  backup?: string;
}

export const handleRestore = createCliHandler({
  handler: (options: RestoreHandlerOptions) =>
    Effect.gen(function* () {
      const backupCommand = yield* BackupCommandTag;
      yield* Effect.promise(() => backupCommand.restore(options.backup, options));
    }),
  middleware: defaultMiddleware,
});

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
