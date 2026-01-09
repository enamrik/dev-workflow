/**
 * Claude Config Service for managing ~/.claude.json
 *
 * Handles cleanup of worktree folder registrations when tasks are completed.
 * Claude Code tracks trusted folders in ~/.claude.json under the "projects" key.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Structure of the Claude config file ~/.claude.json
 * Only includes fields we need to manipulate.
 */
interface ClaudeConfig {
  projects?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Result from a cleanup operation
 */
export interface ClaudeConfigCleanupResult {
  success: boolean;
  folderRemoved: boolean;
  message: string;
}

/**
 * Interface for Claude config operations
 *
 * Abstracts Claude config file operations for testability.
 */
export interface ClaudeConfigService {
  /**
   * Remove a folder registration from ~/.claude.json
   *
   * Claude Code stores trusted folder info in ~/.claude.json under the "projects" key.
   * When a worktree is removed, we should also remove its entry from this config
   * to avoid stale entries.
   *
   * @param folderPath - Absolute path of the folder to remove
   * @returns Result indicating success/failure and whether folder was actually removed
   */
  removeFolder(folderPath: string): Promise<ClaudeConfigCleanupResult>;
}

/**
 * Node.js implementation of ClaudeConfigService
 *
 * Reads and writes to ~/.claude.json directly.
 */
export class NodeClaudeConfigService implements ClaudeConfigService {
  private readonly configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? path.join(os.homedir(), ".claude.json");
  }

  async removeFolder(folderPath: string): Promise<ClaudeConfigCleanupResult> {
    try {
      // 1. Check if config file exists
      try {
        await fs.access(this.configPath);
      } catch {
        return {
          success: true,
          folderRemoved: false,
          message: "Claude config file does not exist",
        };
      }

      // 2. Read and parse the config file
      const content = await fs.readFile(this.configPath, "utf-8");
      let config: ClaudeConfig;
      try {
        config = JSON.parse(content) as ClaudeConfig;
      } catch {
        return {
          success: false,
          folderRemoved: false,
          message: "Failed to parse Claude config file",
        };
      }

      // 3. Check if projects key exists
      if (!config.projects || typeof config.projects !== "object") {
        return {
          success: true,
          folderRemoved: false,
          message: "No projects section in Claude config",
        };
      }

      // 4. Check if the folder path is registered
      // Normalize the path for comparison
      const normalizedFolderPath = path.normalize(folderPath);

      // Find matching entry - compare normalized paths
      const projectKeys = Object.keys(config.projects);
      const matchingKey = projectKeys.find((key) => {
        const normalizedKey = path.normalize(key);
        return normalizedKey === normalizedFolderPath;
      });

      if (!matchingKey) {
        return {
          success: true,
          folderRemoved: false,
          message: `Folder not found in Claude config: ${folderPath}`,
        };
      }

      // 5. Remove the folder entry
      delete config.projects[matchingKey];

      // 6. Write the updated config back
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

      return {
        success: true,
        folderRemoved: true,
        message: `Removed folder from Claude config: ${folderPath}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        folderRemoved: false,
        message: `Failed to remove folder from Claude config: ${message}`,
      };
    }
  }
}
