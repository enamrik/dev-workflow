/**
 * ClaudeConfigCommand - Manage Claude Code configuration
 *
 * Handles cleaning stale worktree registrations from ~/.claude.json.
 * Receives all dependencies via constructor injection.
 */

import { promises as fsp } from "node:fs";
import { ClaudeConfigService } from "../application/claude-config.service.js";

export interface CleanOptions {
  dryRun?: boolean;
}

export class ClaudeConfigCommand {
  constructor(private readonly claudeConfigService: ClaudeConfigService) {}

  /**
   * Remove stale worktree folder registrations from ~/.claude.json.
   */
  async clean(options: CleanOptions = {}): Promise<void> {
    try {
      if (options.dryRun) {
        console.log("🔍 Scanning for stale worktree registrations...\n");
        const registrations = await this.claudeConfigService.listWorktreeRegistrations();

        if (registrations.length === 0) {
          console.log("No worktree registrations found in ~/.claude.json");
          return;
        }

        console.log(`Found ${registrations.length} worktree registration(s):\n`);

        let staleCount = 0;
        for (const regPath of registrations) {
          try {
            await fsp.access(regPath);
            console.log(`  ✓ ${regPath} (exists)`);
          } catch {
            console.log(`  ✗ ${regPath} (stale - would be removed)`);
            staleCount++;
          }
        }

        console.log();
        if (staleCount > 0) {
          console.log(`Would remove ${staleCount} stale registration(s).`);
          console.log("Run without --dry-run to apply changes.");
        } else {
          console.log("No stale registrations found.");
        }
        return;
      }

      console.log("🧹 Cleaning stale worktree registrations from ~/.claude.json...\n");
      const result = await this.claudeConfigService.cleanStaleWorktrees();

      if (!result.success) {
        console.error(`❌ ${result.message}`);
        process.exit(1);
      }

      if (result.removedCount === 0) {
        console.log("✓ No stale registrations found.");
      } else {
        console.log(`✓ Removed ${result.removedCount} stale registration(s):\n`);
        for (const removedPath of result.removedPaths) {
          console.log(`  - ${removedPath}`);
        }
      }
    } catch (error) {
      console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
}
