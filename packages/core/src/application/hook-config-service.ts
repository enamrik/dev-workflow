import * as fs from "fs/promises";
import * as path from "path";
import * as yaml from "js-yaml";
import type { HookConfig } from "../domain/hook-config.js";

/**
 * Service for loading and managing hook configurations
 *
 * Loads YAML hook configurations from .track/issues/tasks/hooks/
 * Supports composable configs that can be merged together
 * Provides AI-driven assignment of relevant configs based on task content
 */
export interface HookConfigService {
  /**
   * Load a single hook configuration by label
   */
  loadConfig(label: string): Promise<HookConfig>;

  /**
   * Load and merge multiple hook configurations
   * Hooks are merged by stage in array order
   */
  loadAndMergeConfigs(labels: string[]): Promise<HookConfig>;

  /**
   * List all available hook configurations
   */
  listConfigs(): Promise<string[]>;

  /**
   * Validate a hook configuration
   */
  validateConfig(config: HookConfig): boolean;

  /**
   * Assign relevant hook config labels based on task content
   * Uses keyword matching to identify applicable configs
   */
  assignConfigsForTask(task: {
    title: string;
    description: string;
    type?: string;
  }): string[];
}

/**
 * File system implementation of HookConfigService
 */
export class FileSystemHookConfigService implements HookConfigService {
  constructor(private readonly trackDirectory: string) {}

  async loadConfig(label: string): Promise<HookConfig> {
    const configPath = path.join(
      this.trackDirectory,
      "issues/tasks/hooks",
      `${label}.yml`
    );

    try {
      const yamlContent = await fs.readFile(configPath, "utf-8");
      const config = yaml.load(yamlContent) as HookConfig;

      if (!this.validateConfig(config)) {
        throw new Error(`Invalid hook config: ${label}`);
      }

      return config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Hook config not found: ${label}`);
      }
      throw error;
    }
  }

  async loadAndMergeConfigs(labels: string[]): Promise<HookConfig> {
    if (labels.length === 0) {
      // Return minimal default config
      return {
        name: "empty",
        description: "No hooks configured",
        hooks: {},
      };
    }

    if (labels.length === 1) {
      // No merging needed for single config
      return this.loadConfig(labels[0] as string);
    }

    // Load all configs
    const configs = await Promise.all(
      labels.map((label) => this.loadConfig(label))
    );

    // Merge hooks by stage
    const merged: HookConfig = {
      name: `merged-${labels.join("-")}`,
      description: `Merged config from: ${labels.join(", ")}`,
      hooks: {},
    };

    for (const config of configs) {
      // Merge hooks for each stage
      for (const [stage, commands] of Object.entries(config.hooks)) {
        if (!commands) continue;

        if (!merged.hooks[stage as keyof typeof merged.hooks]) {
          merged.hooks[stage as keyof typeof merged.hooks] = [];
        }

        const existingCommands = merged.hooks[
          stage as keyof typeof merged.hooks
        ] as string[];
        existingCommands.push(...commands);
      }

      // Merge environment variables (later configs override earlier ones)
      if (config.environment) {
        merged.environment = {
          ...merged.environment,
          ...config.environment,
        };
      }

      // Use longest timeout
      if (
        config.timeout &&
        (!merged.timeout || config.timeout > merged.timeout)
      ) {
        merged.timeout = config.timeout;
      }
    }

    return merged;
  }

  async listConfigs(): Promise<string[]> {
    const hooksDir = path.join(this.trackDirectory, "issues/tasks/hooks");

    try {
      const files = await fs.readdir(hooksDir);
      return files
        .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
        .map((f) => f.replace(/\.(yml|yaml)$/, ""));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  validateConfig(config: HookConfig): boolean {
    return !!(
      config &&
      typeof config.name === "string" &&
      config.name.length > 0 &&
      config.hooks &&
      typeof config.hooks === "object"
    );
  }

  assignConfigsForTask(task: {
    title: string;
    description: string;
    type?: string;
  }): string[] {
    const labels: string[] = [];
    const text = `${task.title} ${task.description}`.toLowerCase();

    // Database-related tasks
    if (
      text.match(
        /database|migration|schema|sql|postgres|mysql|mongo|sqlite|db:/
      )
    ) {
      labels.push("db-migration");
    }

    // API/integration tasks
    if (text.match(/api|endpoint|integration|service|rest|graphql/)) {
      labels.push("e2e-tests");
    }

    // Security-related tasks
    if (
      text.match(/auth|security|encrypt|permission|token|oauth|jwt|credential/)
    ) {
      labels.push("security");
    }

    // Web/frontend tasks
    if (
      text.match(
        /ui|frontend|component|web|react|vue|angular|html|css|styling/
      )
    ) {
      labels.push("web");
    }

    // Performance tasks
    if (text.match(/performance|optimize|cache|speed|slow|latency/)) {
      labels.push("performance");
    }

    // Always include unit tests as baseline
    labels.push("unit-tests");

    // If no specific configs matched, use default
    return labels.length > 1 ? labels : ["default"];
  }
}
