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
 * Zod schema for GitHub configuration
 */
export const GitHubConfigSchema = z.object({
  enabled: z.boolean(),
  owner: z.string(),
  repo: z.string(),
  projectId: z.string().optional(), // GitHub Project ID (e.g., PVT_kwDO...)
  labels: GitHubLabelsSchema.optional(),
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
   * Get GitHub configuration if enabled
   *
   * @returns GitHub config if enabled, null otherwise
   */
  async getGitHubConfig(): Promise<GitHubConfig | null> {
    const config = await this.loadConfig();
    return config.github?.enabled ? config.github : null;
  }

  /**
   * Check if GitHub integration is configured and enabled
   */
  async isGitHubEnabled(): Promise<boolean> {
    try {
      const githubConfig = await this.getGitHubConfig();
      return githubConfig !== null;
    } catch {
      return false;
    }
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
   * Set GitHub configuration
   *
   * @param githubConfig - GitHub configuration to set
   */
  async setGitHubConfig(githubConfig: GitHubConfig): Promise<void> {
    await this.updateConfig({ github: githubConfig });
  }

  /**
   * Disable GitHub integration
   */
  async disableGitHub(): Promise<void> {
    const config = await this.loadConfig();
    if (config.github) {
      await this.updateConfig({
        github: { ...config.github, enabled: false },
      });
    }
  }

  /**
   * Clear cached config (useful for testing)
   */
  clearCache(): void {
    this.config = null;
  }
}
