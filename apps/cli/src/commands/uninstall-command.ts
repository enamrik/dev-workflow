import type { UninstallService } from "../application/uninstall.service.js";

export interface UninstallOptions {
  purge?: boolean;
}

export class UninstallCommand {
  constructor(private readonly uninstallService: UninstallService) {}

  async execute(options: UninstallOptions = {}): Promise<void> {
    const purge = options.purge ?? false;

    console.log("🗑️  Uninstalling dfl...");

    await this.uninstallService.removeLauncher();
    console.log("✓ Removed launcher");

    await this.uninstallService.removeInstallDir();
    console.log("✓ Removed install dir");

    await this.uninstallService.removeGlobalSkills();
    console.log("✓ Removed global dfl-* skills");

    await this.uninstallService.unregisterMCPServer();
    console.log("✓ Removed MCP registration");

    if (purge) {
      await this.uninstallService.removeGlobalTrackDirectory();
      console.log("✓ Purged data (~/.dfl/track)");
    }

    console.log("\n✨ dfl uninstalled!");

    if (purge) {
      console.log("\n⚠  All data in ~/.dfl/track has been removed.");
    } else {
      console.log("\nData preserved at ~/.dfl/track. Re-run with --purge to delete it.");
    }
  }
}
