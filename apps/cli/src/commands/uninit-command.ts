/**
 * UninitCommand - Removes dev-workflow Claude integration
 *
 * Business logic for uninstalling dev-workflow integration while preserving data.
 * Receives all dependencies via constructor injection.
 */

import type { UninstallService } from "../application/uninstall.service.js";

export class UninitCommand {
  constructor(private readonly uninstallService: UninstallService) {}

  /**
   * Remove dev-workflow Claude integration (skills, MCP) while preserving data.
   */
  async execute(): Promise<void> {
    console.log("🗑️  Removing dev-workflow Claude integration...");

    await this.uninstallService.removeSkills();
    console.log("✓ Removed skills");

    await this.uninstallService.unregisterMCPServer();
    console.log("✓ Unregistered MCP server");

    console.log("\n✨ dfl Claude integration removed!");
    console.log("\nPreserved:");
    console.log("- Project data in ~/.dfl/track (issues, plans, tasks)");
    console.log("- .claude/config/ (your Claude Code configuration)");
    console.log("\nTo fully remove dfl (binary, install files, and data): dfl uninstall --purge");
    console.log("To remove only the binary and install files: dfl uninstall");
  }
}
