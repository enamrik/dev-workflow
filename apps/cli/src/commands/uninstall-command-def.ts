import { createCliHandler, createCliCommand, defaultMiddleware } from "../di/bootstrap.js";
import { Effect } from "@dev-workflow/effect";
import { UninstallCommandTag } from "../di/cli-tags.js";
import type { UninstallOptions } from "./uninstall-command.js";

export const handleUninstall = createCliHandler({
  handler: (options: UninstallOptions) =>
    Effect.gen(function* () {
      const uninstallCommand = yield* UninstallCommandTag;
      yield* Effect.promise(() => uninstallCommand.execute(options));
    }),
  middleware: defaultMiddleware,
});

export const runUninstall = createCliCommand(handleUninstall);
