/**
 * ConfigService - Manages project configuration
 *
 * Loads and validates config from ~/.track/<project-id>/config.json
 * Uses Zod for runtime type validation.
 */

import * as fs from "node:fs/promises";
import { z } from "zod";
import type { TrackDirectoryResolver } from "./track-directory-resolver.js";

/**
 * Zod schema for GitHub labels configuration
 */
export const GitHubLabelsSchema = z.object({
  typeLabels: z.object({
    FEATURE: z.string(),
    BUG: z.string(),
    ENHANCEMENT: z.string(),
    TASK: z.string(),
  }),
  customLabels: z.array(z.string()).optional(),
});

/**
 * Zod schema for GitHub issue sync configuration
 *
 * Controls syncing of dev-workflow issues to GitHub Issues.
 */
export const GitHubIssueSyncSchema = z.object({
  enabled: z.boolean(),
  projectId: z.string().optional(), // GitHub Project ID (e.g., PVT_kwDO...)
  labels: GitHubLabelsSchema.optional(),
});

/**
 * Zod schema for GitHub configuration
 *
 * Note: owner/repo are not stored here - they're derived from git remotes at runtime.
 * This avoids duplication and works correctly in git worktrees.
 */
export const GitHubConfigSchema = z.object({
  syncIssues: GitHubIssueSyncSchema.optional(),
});

/**
 * Zod schema for issue templates configuration
 */
export const IssueTemplatesSchema = z.object({
  defaultTemplate: z.string(),
});

/**
 * Zod schema for the full configuration file
 */
export const ConfigSchema = z.object({
  version: z.string(),
  projectId: z.string(), // dev-workflow project ID
  gitRoot: z.string(), // Git repository root path
  issueTemplates: IssueTemplatesSchema.optional(),
  github: GitHubConfigSchema.optional(),
});

/**
 * Inferred types from Zod schemas
 */
export type Config = z.infer<typeof ConfigSchema>;
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;
export type GitHubIssueSync = z.infer<typeof GitHubIssueSyncSchema>;
export type GitHubLabels = z.infer<typeof GitHubLabelsSchema>;

/**
 * Error thrown when config is invalid
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * ConfigService manages project configuration
 *
 * Follows DDD principles:
 * - Uses dependency injection (TrackDirectoryResolver)
 * - Validates input at boundaries (Zod schema)
 * - Provides clear error messages
 */
export class ConfigService {
  private config: Config | null = null;

  constructor(private readonly resolver: TrackDirectoryResolver) {}

  /**
   * Load and validate configuration from disk
   *
   * @returns The validated configuration
   * @throws ConfigError if config file doesn't exist or is invalid
   */
  async loadConfig(): Promise<Config> {
    if (this.config) {
      return this.config;
    }

    const configPath = this.resolver.getConfigPath();

    try {
      const content = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(content) as unknown;

      const result = ConfigSchema.safeParse(parsed);
      if (!result.success) {
        throw new ConfigError(
          `Invalid config file: ${result.error.message}`,
          result.error
        );
      }

      this.config = result.data;
      return this.config;
    } catch (error) {
      if (error instanceof ConfigError) {
        throw error;
      }
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new ConfigError(`Config file not found: ${configPath}`);
      }
      throw new ConfigError(
        `Failed to load config: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Get GitHub issue sync configuration if enabled
   *
   * @returns Issue sync config if enabled, null otherwise
   */
  async getGitHubIssueSyncConfig(): Promise<GitHubIssueSync | null> {
    const config = await this.loadConfig();
    return config.github?.syncIssues?.enabled ? config.github.syncIssues : null;
  }

  /**
   * Check if GitHub issue sync is configured and enabled
   */
  async isGitHubIssueSyncEnabled(): Promise<boolean> {
    try {
      const syncConfig = await this.getGitHubIssueSyncConfig();
      return syncConfig !== null;
    } catch {
      return false;
    }
  }

  /**
   * @deprecated Use getGitHubIssueSyncConfig instead
   */
  async getGitHubConfig(): Promise<GitHubIssueSync | null> {
    return this.getGitHubIssueSyncConfig();
  }

  /**
   * @deprecated Use isGitHubIssueSyncEnabled instead
   */
  async isGitHubEnabled(): Promise<boolean> {
    return this.isGitHubIssueSyncEnabled();
  }

  /**
   * Update configuration and write to disk
   *
   * @param updates - Partial config updates to merge
   */
  async updateConfig(updates: Partial<Config>): Promise<void> {
    const current = await this.loadConfig();
    const updated = { ...current, ...updates };

    // Validate the merged config
    const result = ConfigSchema.safeParse(updated);
    if (!result.success) {
      throw new ConfigError(
        `Invalid config update: ${result.error.message}`,
        result.error
      );
    }

    const configPath = this.resolver.getConfigPath();
    await fs.writeFile(configPath, JSON.stringify(result.data, null, 2));

    // Update cached config
    this.config = result.data;
  }

  /**
   * Set GitHub issue sync configuration
   *
   * @param syncConfig - Issue sync configuration to set
   */
  async setGitHubIssueSyncConfig(syncConfig: GitHubIssueSync): Promise<void> {
    const config = await this.loadConfig();
    await this.updateConfig({
      github: { ...config.github, syncIssues: syncConfig },
    });
  }

  /**
   * Disable GitHub issue sync
   */
  async disableGitHubIssueSync(): Promise<void> {
    const config = await this.loadConfig();
    if (config.github?.syncIssues) {
      await this.updateConfig({
        github: {
          ...config.github,
          syncIssues: { ...config.github.syncIssues, enabled: false },
        },
      });
    }
  }

  /**
   * @deprecated Use setGitHubIssueSyncConfig instead
   */
  async setGitHubConfig(syncConfig: GitHubIssueSync): Promise<void> {
    return this.setGitHubIssueSyncConfig(syncConfig);
  }

  /**
   * @deprecated Use disableGitHubIssueSync instead
   */
  async disableGitHub(): Promise<void> {
    return this.disableGitHubIssueSync();
  }

  /**
   * Clear cached config (useful for testing)
   */
  clearCache(): void {
    this.config = null;
  }
}
