/**
 * Settings-related MCP tools
 *
 * Provides configuration for project settings, primarily GitHub integration.
 * Settings are stored in the projects table in the database.
 */

import {
  DEFAULT_COLUMN_MAPPING,
  type GitHubCLI,
  type GitHubIssueSyncConfig,
  type Project,
  type ProjectRepository,
  type StatusColumnMapping,
} from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";

/**
 * Type for GitHub labels configuration (used in tool arguments)
 */
interface GitHubLabels {
  typeLabels?: {
    FEATURE?: string;
    BUG?: string;
    ENHANCEMENT?: string;
    TASK?: string;
  };
  customLabels?: string[];
}

/**
 * Tool definitions for settings operations
 */
export const settingsToolDefinitions: ToolDefinition[] = [
  {
    name: "update_settings",
    description:
      "Configure project settings including GitHub issue sync. " +
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
            "configure_column_mapping",
          ],
          description:
            "The settings action to perform: get_settings returns current config, " +
            "enable_github enables GitHub issue sync with validation, " +
            "disable_github disables issue sync, " +
            "configure_github updates labels/projectId config, " +
            "configure_column_mapping updates status-to-column mapping for GitHub Projects",
        },
        github: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "GitHub Project ID for Projects integration (optional, format: PVT_...)",
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
            columnMapping: {
              type: "object",
              properties: {
                PLANNED: { type: "string" },
                BACKLOG: { type: "string" },
                READY: { type: "string" },
                IN_PROGRESS: { type: "string" },
                PR_REVIEW: { type: "string" },
                COMPLETED: { type: "string" },
                ABANDONED: { type: "string" },
              },
              description:
                "Maps task statuses to GitHub Project column names. " +
                "Only specify the statuses you want to override. " +
                "Default: BACKLOG→Backlog, READY→Ready, IN_PROGRESS→In Progress, " +
                "PR_REVIEW→In Review, COMPLETED→Done, ABANDONED→Done",
            },
          },
          description: "GitHub configuration options (projectId, labels, columnMapping)",
        },
        resetColumnMapping: {
          type: "boolean",
          description:
            "For configure_column_mapping action: reset column mapping to defaults. " +
            "If true, ignores columnMapping parameter and resets to default values.",
        },
      },
      required: ["action"],
    },
  },
];

/**
 * Service context for settings handlers
 *
 * Uses project and projectRepository to store GitHub sync config
 * in the projects table.
 */
export interface SettingsToolContext {
  project: Project;
  projectRepository: ProjectRepository;
  githubCLI: GitHubCLI;
  gitRoot: string; // From env var, not database (machine-specific)
}

/**
 * Arguments for update_settings tool
 */
interface UpdateSettingsArgs {
  action:
    | "get_settings"
    | "enable_github"
    | "disable_github"
    | "configure_github"
    | "configure_column_mapping";
  github?: {
    projectId?: string;
    labels?: Partial<GitHubLabels>;
    columnMapping?: Partial<StatusColumnMapping>;
  };
  resetColumnMapping?: boolean;
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
  const { action, github, resetColumnMapping } = args;

  switch (action) {
    case "get_settings":
      return handleGetSettings(ctx);

    case "enable_github":
      return handleEnableGitHub(ctx, github);

    case "disable_github":
      return handleDisableGitHub(ctx);

    case "configure_github":
      return handleConfigureGitHub(ctx, github);

    case "configure_column_mapping":
      return handleConfigureColumnMapping(ctx, github?.columnMapping, resetColumnMapping);

    default:
      return errorResponse(`Unknown action: ${action}`);
  }
}

/**
 * Get current settings and gh CLI status
 *
 * Re-fetches project from database to ensure we have the latest config
 * (ctx.project may be stale if settings were updated in this session).
 */
async function handleGetSettings(ctx: SettingsToolContext): Promise<ToolResponse> {
  try {
    // Re-fetch project from database to get latest config
    const project = ctx.projectRepository.findById(ctx.project.id);
    if (!project) {
      return errorResponse(`Project not found: ${ctx.project.id}`);
    }

    const isGitHubAuthenticated = await ctx.githubCLI.checkAuth();

    // Build effective column mapping (defaults + any custom overrides)
    const effectiveColumnMapping = project.githubSync
      ? {
          ...DEFAULT_COLUMN_MAPPING,
          ...(project.githubSync.columnMapping ?? {}),
        }
      : null;

    return successResponse({
      projectId: project.id,
      projectName: project.name,
      gitRoot: ctx.gitRoot,
      gitRootHash: project.gitRootHash,
      github: project.githubSync
        ? {
            syncIssues: project.githubSync,
            columnMapping: {
              effective: effectiveColumnMapping,
              custom: project.githubSync.columnMapping,
              isDefault: !project.githubSync.columnMapping,
            },
          }
        : null,
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
    return errorResponse("GitHub CLI (gh) is not authenticated. Run 'gh auth login' first.");
  }

  // Step 2: Verify we're in a GitHub repository
  const isGitHubRepo = await ctx.githubCLI.checkCurrentRepository();
  if (!isGitHubRepo) {
    return errorResponse(
      "Not in a GitHub repository. Ensure this directory is a git repo with a GitHub remote."
    );
  }

  // Step 3: Verify project if provided and get URL
  let projectUrl: string | undefined;
  if (github?.projectId) {
    const projectDetails = await ctx.githubCLI.getProjectDetails(github.projectId);
    if (!projectDetails) {
      return errorResponse(
        `GitHub Project ${github.projectId} not found or not accessible. ` +
          `Ensure the Project ID is correct (format: PVT_...).`
      );
    }
    projectUrl = projectDetails.url;
  }

  // Step 4: Build and save config with defaults for missing label config
  const syncConfig: GitHubIssueSyncConfig = {
    enabled: true,
    projectId: github?.projectId,
    projectUrl,
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
    // Update project in database with GitHub sync config
    ctx.projectRepository.update(ctx.project.id, { githubSync: syncConfig });

    return successResponse({
      success: true,
      message: "GitHub issue sync enabled (repository auto-detected from git remotes)",
      config: { syncIssues: syncConfig },
    });
  } catch (error) {
    return errorResponse(
      `Failed to save config: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Disable GitHub issue sync
 */
async function handleDisableGitHub(ctx: SettingsToolContext): Promise<ToolResponse> {
  try {
    // Re-fetch project from database to get latest config
    const project = ctx.projectRepository.findById(ctx.project.id);
    if (!project) {
      return errorResponse(`Project not found: ${ctx.project.id}`);
    }

    const currentSync = project.githubSync;

    if (currentSync) {
      // Preserve config but set enabled to false
      ctx.projectRepository.update(project.id, {
        githubSync: { ...currentSync, enabled: false },
      });
    }

    return successResponse({
      success: true,
      message: "GitHub issue sync disabled",
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Update GitHub issue sync configuration without re-validating repository access
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
    // Re-fetch project from database to get latest config
    const project = ctx.projectRepository.findById(ctx.project.id);
    if (!project) {
      return errorResponse(`Project not found: ${ctx.project.id}`);
    }

    const currentSync = project.githubSync;

    if (!currentSync) {
      return errorResponse("GitHub issue sync is not enabled. Use enable_github action first.");
    }

    // If projectId is being added/changed, validate it and get URL
    let projectUrl = currentSync.projectUrl;
    if (github.projectId && github.projectId !== currentSync.projectId) {
      const projectDetails = await ctx.githubCLI.getProjectDetails(github.projectId);
      if (!projectDetails) {
        return errorResponse(`GitHub Project ${github.projectId} not found or not accessible.`);
      }
      projectUrl = projectDetails.url;
    }

    // Merge with existing config (don't allow changing enabled via configure)
    const updatedConfig: GitHubIssueSyncConfig = {
      ...currentSync,
      projectId: github.projectId ?? currentSync.projectId,
      projectUrl: github.projectId ? projectUrl : currentSync.projectUrl,
      labels: github.labels
        ? {
            typeLabels: {
              FEATURE:
                github.labels.typeLabels?.FEATURE ??
                currentSync.labels?.typeLabels.FEATURE ??
                "feature",
              BUG: github.labels.typeLabels?.BUG ?? currentSync.labels?.typeLabels.BUG ?? "bug",
              ENHANCEMENT:
                github.labels.typeLabels?.ENHANCEMENT ??
                currentSync.labels?.typeLabels.ENHANCEMENT ??
                "enhancement",
              TASK: github.labels.typeLabels?.TASK ?? currentSync.labels?.typeLabels.TASK ?? "task",
            },
            customLabels: github.labels.customLabels ?? currentSync.labels?.customLabels,
          }
        : currentSync.labels,
      enabled: currentSync.enabled, // Preserve enabled state
    };

    // Update project in database
    ctx.projectRepository.update(project.id, { githubSync: updatedConfig });

    return successResponse({
      success: true,
      message: "GitHub issue sync configuration updated",
      config: { syncIssues: updatedConfig },
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Configure status-to-column mapping for GitHub Projects
 *
 * Allows teams to customize which GitHub Project columns correspond to each
 * task status. For example, teams might use different column names than
 * our defaults ("In Review" vs "PR Review", "Backlog" vs "To Do", etc.)
 */
async function handleConfigureColumnMapping(
  ctx: SettingsToolContext,
  columnMapping?: Partial<StatusColumnMapping>,
  resetColumnMapping?: boolean
): Promise<ToolResponse> {
  try {
    // Re-fetch project from database to get latest config
    const project = ctx.projectRepository.findById(ctx.project.id);
    if (!project) {
      return errorResponse(`Project not found: ${ctx.project.id}`);
    }

    const currentSync = project.githubSync;

    if (!currentSync) {
      return errorResponse("GitHub issue sync is not enabled. Use enable_github action first.");
    }

    // Handle reset to defaults
    if (resetColumnMapping) {
      const updatedConfig: GitHubIssueSyncConfig = {
        ...currentSync,
        columnMapping: undefined, // Remove custom mapping, will use defaults
      };

      ctx.projectRepository.update(project.id, { githubSync: updatedConfig });

      return successResponse({
        success: true,
        message: "Column mapping reset to defaults",
        columnMapping: DEFAULT_COLUMN_MAPPING,
        isDefault: true,
      });
    }

    // Validate that at least some mapping is provided
    if (!columnMapping || Object.keys(columnMapping).length === 0) {
      // Return current mapping
      const effectiveMapping = {
        ...DEFAULT_COLUMN_MAPPING,
        ...(currentSync.columnMapping ?? {}),
      };

      return successResponse({
        success: true,
        message: "Current column mapping",
        columnMapping: effectiveMapping,
        customMapping: currentSync.columnMapping,
        isDefault: !currentSync.columnMapping,
      });
    }

    // Merge with existing custom mapping (preserve any previously set values)
    const mergedMapping: StatusColumnMapping = {
      ...(currentSync.columnMapping ?? {}),
      ...columnMapping,
    };

    const updatedConfig: GitHubIssueSyncConfig = {
      ...currentSync,
      columnMapping: mergedMapping,
    };

    ctx.projectRepository.update(project.id, { githubSync: updatedConfig });

    // Show the effective mapping (defaults + custom)
    const effectiveMapping = {
      ...DEFAULT_COLUMN_MAPPING,
      ...mergedMapping,
    };

    return successResponse({
      success: true,
      message: "Column mapping updated",
      columnMapping: effectiveMapping,
      customMapping: mergedMapping,
      isDefault: false,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}
