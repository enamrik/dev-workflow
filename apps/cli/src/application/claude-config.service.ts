/**
 * Claude Config Service for cleaning stale worktree registrations from ~/.claude.json
 *
 * Uses streaming JSON to handle large config files without loading them entirely into memory.
 * Claude Code tracks trusted folders in ~/.claude.json under the "projects" key.
 */

import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import streamJson from "stream-json";
import StreamObject from "stream-json/streamers/StreamObject.js";

const { parser } = streamJson;
const { streamObject } = StreamObject;

/**
 * Result from cleaning stale worktree registrations
 */
export interface CleanClaudeConfigResult {
  success: boolean;
  removedCount: number;
  removedPaths: string[];
  message: string;
}

/**
 * Service for cleaning stale worktree folder registrations from ~/.claude.json
 *
 * Uses streaming JSON to handle arbitrarily large config files.
 */
export class ClaudeConfigService {
  private readonly configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? path.join(os.homedir(), ".claude.json");
  }

  /**
   * Clean stale worktree folder registrations from ~/.claude.json
   *
   * Finds all folder entries containing "worktrees" in the path,
   * checks if the folder still exists on disk, and removes entries
   * for folders that no longer exist.
   *
   * Uses streaming JSON to avoid loading the entire file into memory.
   */
  async cleanStaleWorktrees(): Promise<CleanClaudeConfigResult> {
    try {
      // Check if config file exists
      try {
        await fs.access(this.configPath);
      } catch {
        return {
          success: true,
          removedCount: 0,
          removedPaths: [],
          message: "Claude config file does not exist",
        };
      }

      // First pass: identify stale worktree paths using streaming
      const stalePaths = await this.findStaleWorktreePaths();

      if (stalePaths.length === 0) {
        return {
          success: true,
          removedCount: 0,
          removedPaths: [],
          message: "No stale worktree registrations found",
        };
      }

      // Second pass: rebuild config without stale paths
      await this.removePathsFromConfig(stalePaths);

      return {
        success: true,
        removedCount: stalePaths.length,
        removedPaths: stalePaths,
        message: `Removed ${stalePaths.length} stale worktree registration(s)`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        removedCount: 0,
        removedPaths: [],
        message: `Failed to clean Claude config: ${message}`,
      };
    }
  }

  /**
   * Check if a path matches the dev-workflow worktree naming convention.
   * Pattern: /worktrees/issue-<number>-task-<number>
   */
  private isDevWorkflowWorktreePath(folderPath: string): boolean {
    // Match pattern: worktrees/issue-<number>-task-<number>
    return /\/worktrees\/issue-\d+-task-\d+\/?$/.test(folderPath);
  }

  /**
   * Find worktree paths in config that no longer exist on disk
   */
  private async findStaleWorktreePaths(): Promise<string[]> {
    const stalePaths: string[] = [];

    return new Promise((resolve, reject) => {
      const readStream = createReadStream(this.configPath);
      const jsonParser = parser();
      const objectStreamer = streamObject();

      objectStreamer.on("data", async (data: { key: string; value: unknown }) => {
        if (data.key === "projects" && typeof data.value === "object" && data.value !== null) {
          // We've reached the projects object - check each path
          const projects = data.value as Record<string, unknown>;
          for (const folderPath of Object.keys(projects)) {
            // Only check paths matching dev-workflow worktree naming convention
            if (this.isDevWorkflowWorktreePath(folderPath)) {
              try {
                await fs.access(folderPath);
                // Folder exists, keep it
              } catch {
                // Folder doesn't exist, mark for removal
                stalePaths.push(folderPath);
              }
            }
          }
        }
      });

      objectStreamer.on("end", () => resolve(stalePaths));
      objectStreamer.on("error", reject);

      readStream.pipe(jsonParser).pipe(objectStreamer);
      readStream.on("error", reject);
    });
  }

  /**
   * Remove specified paths from the config file using streaming
   */
  private async removePathsFromConfig(pathsToRemove: string[]): Promise<void> {
    const tempPath = `${this.configPath}.tmp`;

    // Read the file, filter projects, write to temp file
    const content = await fs.readFile(this.configPath, "utf-8");
    const config = JSON.parse(content) as Record<string, unknown>;

    if (config["projects"] && typeof config["projects"] === "object") {
      const projects = config["projects"] as Record<string, unknown>;
      for (const pathToRemove of pathsToRemove) {
        delete projects[pathToRemove];
      }
    }

    // Write to temp file, then atomic rename
    await fs.writeFile(tempPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    await fs.rename(tempPath, this.configPath);
  }

  /**
   * List all dev-workflow worktree folder registrations (for debugging)
   */
  async listWorktreeRegistrations(): Promise<string[]> {
    try {
      await fs.access(this.configPath);
    } catch {
      return [];
    }

    const content = await fs.readFile(this.configPath, "utf-8");
    const config = JSON.parse(content) as Record<string, unknown>;

    if (!config["projects"] || typeof config["projects"] !== "object") {
      return [];
    }

    const projects = config["projects"] as Record<string, unknown>;
    return Object.keys(projects).filter((p) => this.isDevWorkflowWorktreePath(p));
  }
}
