import type { UninstallService } from "../application/uninstall.service.js";

export interface UninstallOptions {
  purge?: boolean;
}

export class UninstallCommand {
  constructor(private readonly uninstallService: UninstallService) {}

  async execute(options: UninstallOptions = {}): Promise<void> {
    const purge = options.purge ?? false;

    console.log("🗑️  Uninstalling dfl...");

    const result = await this.uninstallService.uninstall({ purge });

    for (const step of result.steps) {
      console.log(`✓ ${step}`);
    }

    if (result.windowsInstallDirNote) {
      console.log("Note: On Windows the install directory cannot be removed while dfl is running.");
      console.log(`  Delete it manually: ${result.windowsInstallDirNote}`);
    }

    console.log("\n✨ dfl uninstalled!");

    if (purge) {
      console.log("\n⚠  All data has been removed.");
    } else {
      console.log("\nData preserved. Re-run with --purge to delete it.");
    }
  }
}
