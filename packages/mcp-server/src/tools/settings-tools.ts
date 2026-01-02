/**
 * Settings-related MCP tools
 *
 * Provides configuration for project settings, primarily GitHub integration.
 */

import {
  ConfigService,
  type GitHubCLI,
  type GitHubConfig,
  type GitHubLabels,
} from "@dev-workflow/core";
import {
  type ToolDefinition,
  type ToolResponse,
  successResponse,
  errorResponse,
} from "./types.js";

/**
 * Tool definitions for settings operations
 */
export const settingsToolDefinitions: ToolDefinition[] = [
  {
    name: "update_settings",
    description:
      "Configure project settings including GitHub integration. " +
      "Repository owner/repo are auto-detected from git remotes. " +
      "Validates gh CLI auth and repository access before enabling.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "get_settings",
            "enable_github",
            "disable_github",
            "configure_github",
          ],
          description:
            "The settings action to perform: get_settings returns current config, " +
            "enable_github enables GitHub sync with validation, " +
            "disable_github disables sync, " +
            "configure_github updates labels/projectId config",
        },
        github: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description:
                "GitHub Project ID for Projects integration (optional, format: PVT_...)",
            },
            labels: {
              type: "object",
              properties: {
                typeLabels: {
                  type: "object",
                  properties: {
                    FEATURE: { type: "string" },
                    BUG: { type: "string" },
                    ENHANCEMENT: { type: "string" },
                    TASK: { type: "string" },
                  },
                  description: "Maps issue types to GitHub labels",
                },
                customLabels: {
                  type: "array",
                  items: { type: "string" },
                  description: "Additional labels applied to all synced issues",
                },
              },
              description: "Label configuration for GitHub issues",
            },
          },
          description: "GitHub configuration options (projectId and labels)",
        },
      },
      required: ["action"],
    },
  },
];

/**
 * Service context for settings handlers
 */
export interface SettingsToolContext {
  configService: ConfigService;
  githubCLI: GitHubCLI;
}

/**
 * Arguments for update_settings tool
 */
interface UpdateSettingsArgs {
  action: "get_settings" | "enable_github" | "disable_github" | "configure_github";
  github?: {
    projectId?: string;
    labels?: Partial<GitHubLabels>;
  };
}

/**
 * Handle update_settings tool call
 *
 * Routes to appropriate handler based on action.
 */
export async function handleUpdateSettings(
  ctx: SettingsToolContext,
  args: UpdateSettingsArgs
): Promise<ToolResponse> {
  const { action, github } = args;

  switch (action) {
    case "get_settings":
      return handleGetSettings(ctx);

    case "enable_github":
      return handleEnableGitHub(ctx, github);

    case "disable_github":
      return handleDisableGitHub(ctx);

    case "configure_github":
      return handleConfigureGitHub(ctx, github);

    default:
      return errorResponse(`Unknown action: ${action}`);
  }
}

/**
 * Get current settings and gh CLI status
 */
async function handleGetSettings(ctx: SettingsToolContext): Promise<ToolResponse> {
  try {
    const config = await ctx.configService.loadConfig();
    const isGitHubAuthenticated = await ctx.githubCLI.checkAuth();

    return successResponse({
      projectId: config.projectId,
      gitRoot: config.gitRoot,
      github: config.github ?? null,
      githubCLI: {
        authenticated: isGitHubAuthenticated,
      },
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Enable GitHub integration with full validation
 *
 * Validates:
 * 1. gh CLI authentication
 * 2. Current directory is a GitHub repository
 * 3. Project accessibility (if projectId provided)
 *
 * Repository owner/repo are auto-detected from git remotes.
 */
async function handleEnableGitHub(
  ctx: SettingsToolContext,
  github?: UpdateSettingsArgs["github"]
): Promise<ToolResponse> {
  // Step 1: Check gh CLI authentication
  const isAuthenticated = await ctx.githubCLI.checkAuth();
  if (!isAuthenticated) {
    return errorResponse(
      "GitHub CLI (gh) is not authenticated. Run 'gh auth login' first."
    );
  }

  // Step 2: Verify we're in a GitHub repository
  const isGitHubRepo = await ctx.githubCLI.checkCurrentRepository();
  if (!isGitHubRepo) {
    return errorResponse(
      "Not in a GitHub repository. Ensure this directory is a git repo with a GitHub remote."
    );
  }

  // Step 3: Verify project if provided
  if (github?.projectId) {
    const projectExists = await ctx.githubCLI.checkProject(github.projectId);
    if (!projectExists) {
      return errorResponse(
        `GitHub Project ${github.projectId} not found or not accessible. ` +
          `Ensure the Project ID is correct (format: PVT_...).`
      );
    }
  }

  // Step 4: Build and save config with defaults for missing label config
  const githubConfig: GitHubConfig = {
    enabled: true,
    projectId: github?.projectId,
    labels: github?.labels
      ? {
          typeLabels: {
            FEATURE: github.labels.typeLabels?.FEATURE ?? "feature",
            BUG: github.labels.typeLabels?.BUG ?? "bug",
            ENHANCEMENT: github.labels.typeLabels?.ENHANCEMENT ?? "enhancement",
            TASK: github.labels.typeLabels?.TASK ?? "task",
          },
          customLabels: github.labels.customLabels,
        }
      : {
          typeLabels: {
            FEATURE: "feature",
            BUG: "bug",
            ENHANCEMENT: "enhancement",
            TASK: "task",
          },
        },
  };

  try {
    await ctx.configService.setGitHubConfig(githubConfig);

    return successResponse({
      success: true,
      message: "GitHub integration enabled (repository auto-detected from git remotes)",
      config: githubConfig,
    });
  } catch (error) {
    return errorResponse(
      `Failed to save config: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Disable GitHub integration
 */
async function handleDisableGitHub(ctx: SettingsToolContext): Promise<ToolResponse> {
  try {
    await ctx.configService.disableGitHub();

    return successResponse({
      success: true,
      message: "GitHub integration disabled",
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Update GitHub configuration without re-validating repository access
 *
 * Use this for updating labels, projectId, etc. after initial setup.
 * If changing projectId, validates the new project.
 */
async function handleConfigureGitHub(
  ctx: SettingsToolContext,
  github?: UpdateSettingsArgs["github"]
): Promise<ToolResponse> {
  if (!github) {
    return errorResponse("configure_github requires github configuration");
  }

  try {
    const currentConfig = await ctx.configService.loadConfig();

    if (!currentConfig.github) {
      return errorResponse(
        "GitHub is not enabled. Use enable_github action first."
      );
    }

    // If projectId is being added/changed, validate it
    if (github.projectId && github.projectId !== currentConfig.github.projectId) {
      const projectExists = await ctx.githubCLI.checkProject(github.projectId);
      if (!projectExists) {
        return errorResponse(
          `GitHub Project ${github.projectId} not found or not accessible.`
        );
      }
    }

    // Merge with existing config (don't allow changing enabled via configure)
    const updatedConfig: GitHubConfig = {
      ...currentConfig.github,
      projectId: github.projectId ?? currentConfig.github.projectId,
      labels: github.labels
        ? {
            typeLabels: {
              FEATURE:
                github.labels.typeLabels?.FEATURE ??
                currentConfig.github.labels?.typeLabels.FEATURE ??
                "feature",
              BUG:
                github.labels.typeLabels?.BUG ??
                currentConfig.github.labels?.typeLabels.BUG ??
                "bug",
              ENHANCEMENT:
                github.labels.typeLabels?.ENHANCEMENT ??
                currentConfig.github.labels?.typeLabels.ENHANCEMENT ??
                "enhancement",
              TASK:
                github.labels.typeLabels?.TASK ??
                currentConfig.github.labels?.typeLabels.TASK ??
                "task",
            },
            customLabels:
              github.labels.customLabels ??
              currentConfig.github.labels?.customLabels,
          }
        : currentConfig.github.labels,
      enabled: currentConfig.github.enabled, // Preserve enabled state
    };

    await ctx.configService.setGitHubConfig(updatedConfig);

    return successResponse({
      success: true,
      message: "GitHub configuration updated",
      config: updatedConfig,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}
