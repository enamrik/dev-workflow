/**
 * Settings-related MCP tools
 *
 * Provides configuration for project settings, primarily GitHub integration.
 * Settings are stored in the projects table in the database.
 *
 * Handlers follow the pattern: (args, cradle) => ToolResponse
 * Each handler destructures what it needs from the cradle.
 */

import {
  DEFAULT_COLUMN_MAPPING,
  type GitHubIssueSyncConfig,
  type StatusColumnMapping,
} from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";
import { UpdateSettingsSchema, type UpdateSettingsArgs } from "./schemas.js";
import { createMcpHandler, validateToolArgs } from "../di/bootstrap.js";
import type { McpCradle } from "../di/container.js";

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
            "list_available_labels",
          ],
          description:
            "The settings action to perform: get_settings returns current config, " +
            "enable_github enables GitHub issue sync with validation, " +
            "disable_github disables issue sync, " +
            "configure_github updates labels/projectId config, " +
            "configure_column_mapping updates status-to-column mapping for project boards, " +
            "list_available_labels returns available label fields from the project management provider",
        },
        github: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "GitHub Project ID for Projects integration (optional, format: PVT_...)",
            },
            assignee: {
              type: "string",
              description:
                "GitHub username to auto-assign issues when task enters IN_PROGRESS. " +
                "Do not include @ prefix. Pass empty string to clear.",
            },
            labels: {
              type: "object",
              properties: {
                typeLabels: {
                  type: "object",
                  additionalProperties: { type: "string" },
                  description:
                    "Maps issue types to GitHub labels. Keys must be valid type names " +
                    "(call list_types to see available types). Example: { FEATURE: 'feature', BUG: 'bug' }",
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
                "Maps task statuses to project board column names. " +
                "Only specify the statuses you want to override. " +
                "Default: BACKLOG→Backlog, READY→Ready, IN_PROGRESS→In Progress, " +
                "PR_REVIEW→In Review, COMPLETED→Done, ABANDONED→Done",
            },
          },
          description: "GitHub configuration options (projectId, assignee, labels, columnMapping)",
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
 * Validate typeLabels keys against active types in the database
 *
 * Returns null if all types are valid, error message if any are invalid.
 */
async function validateTypeLabels(
  typeService: McpCradle["typeService"],
  typeLabels: Record<string, string>
): Promise<string | null> {
  const providedTypes = Object.keys(typeLabels);
  if (providedTypes.length === 0) {
    return null;
  }

  // Get active types from database
  const activeTypes = await typeService.getTypes();
  // Cast to string since we're validating arbitrary user input against known type names
  const validTypeNames = new Set<string>(activeTypes.map((t) => t.name));

  // Find invalid types
  const invalidTypes = providedTypes.filter((t) => !validTypeNames.has(t));

  if (invalidTypes.length === 0) {
    return null;
  }

  // Build helpful error message
  const invalidList = invalidTypes.map((t) => `'${t}'`).join(", ");
  const validList = Array.from(validTypeNames).sort().join(", ");
  return `Invalid type(s) in typeLabels: ${invalidList}. Valid types: ${validList}`;
}

/**
 * Validate GitHub username format
 *
 * GitHub usernames:
 * - Can contain alphanumeric characters and hyphens
 * - Cannot start with a hyphen
 * - Cannot have consecutive hyphens
 * - Max 39 characters
 * - Should not include @ prefix (common user error)
 *
 * Returns null if valid, error message if invalid.
 */
function validateGitHubUsername(username: string): string | null {
  if (username.startsWith("@")) {
    return "GitHub username should not include @ prefix. Use 'username' not '@username'.";
  }

  if (username.length > 39) {
    return "GitHub username cannot exceed 39 characters.";
  }

  // GitHub username regex: alphanumeric and hyphens, no consecutive hyphens, no leading/trailing hyphens
  const validPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9]))*$/;
  if (!validPattern.test(username)) {
    return "Invalid GitHub username format. Use only letters, numbers, and single hyphens (not at start/end).";
  }

  return null;
}

// =============================================================================
// Internal Helper Handlers
// =============================================================================

/**
 * Get current settings and gh CLI status
 *
 * Re-fetches project from database to ensure we have the latest config
 * (ctx.project may be stale if settings were updated in this session).
 */
async function handleGetSettings(
  dbSource: McpCradle["dbSource"],
  project: McpCradle["project"],
  config: McpCradle["config"],
  githubCLI: McpCradle["githubCLI"],
  providerRegistry: McpCradle["providerRegistry"]
): Promise<ToolResponse> {
  try {
    // Re-fetch project from database to get latest config
    const latestProject = await dbSource.projects.findById(project.id);
    if (!latestProject) {
      return errorResponse(`Project not found: ${project.id}`);
    }

    const isGitHubAuthenticated = await githubCLI.checkAuth();

    // Build effective column mapping (defaults + any custom overrides)
    const effectiveColumnMapping = latestProject.githubSync
      ? {
          ...DEFAULT_COLUMN_MAPPING,
          ...(latestProject.githubSync.columnMapping ?? {}),
        }
      : null;

    // Get available providers from registry
    const availableProviders = providerRegistry.list({ githubCLI }).map((p) => ({
      id: p.providerId,
      name: p.displayName,
      available: p.available,
      missingDependencies: p.missingDependencies,
    }));

    return successResponse({
      projectId: latestProject.id,
      projectName: latestProject.name,
      gitRoot: config.gitRoot,
      gitRootHash: latestProject.gitRootHash,
      // Provider abstraction info
      providers: {
        available: availableProviders,
        current: latestProject.githubSync?.enabled ? "github" : null,
      },
      // GitHub-specific config (backwards compatible)
      github: latestProject.githubSync
        ? {
            syncIssues: latestProject.githubSync,
            assignee: latestProject.githubSync.assignee ?? null,
            columnMapping: {
              effective: effectiveColumnMapping,
              custom: latestProject.githubSync.columnMapping,
              isDefault: !latestProject.githubSync.columnMapping,
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
 */
async function handleEnableGitHub(
  dbSource: McpCradle["dbSource"],
  project: McpCradle["project"],
  githubCLI: McpCradle["githubCLI"],
  typeService: McpCradle["typeService"],
  github?: UpdateSettingsArgs["github"]
): Promise<ToolResponse> {
  // Step 1: Check gh CLI authentication
  const isAuthenticated = await githubCLI.checkAuth();
  if (!isAuthenticated) {
    return errorResponse("GitHub CLI (gh) is not authenticated. Run 'gh auth login' first.");
  }

  // Step 2: Verify we're in a GitHub repository and get repo URL
  const isGitHubRepo = await githubCLI.checkCurrentRepository();
  if (!isGitHubRepo) {
    return errorResponse(
      "Not in a GitHub repository. Ensure this directory is a git repo with a GitHub remote."
    );
  }

  // Get the repository URL for linking
  const repoUrl = await githubCLI.getRepoUrl();

  // Step 3: Verify project if provided and get URL
  let projectUrl: string | undefined;
  if (github?.projectId) {
    const projectDetails = await githubCLI.getProjectDetails(github.projectId);
    if (!projectDetails) {
      return errorResponse(
        `GitHub Project ${github.projectId} not found or not accessible. ` +
          `Ensure the Project ID is correct (format: PVT_...).`
      );
    }
    projectUrl = projectDetails.url;
  }

  // Step 4: Validate assignee if provided
  if (github?.assignee && github.assignee.length > 0) {
    const validationError = validateGitHubUsername(github.assignee);
    if (validationError) {
      return errorResponse(validationError);
    }
  }

  // Step 5: Validate typeLabels against active types if provided
  if (github?.labels?.typeLabels) {
    const typeValidationError = await validateTypeLabels(
      typeService,
      github.labels.typeLabels as Record<string, string>
    );
    if (typeValidationError) {
      return errorResponse(typeValidationError);
    }
  }

  // Step 6: Build and save config with defaults for missing label config
  const syncConfig: GitHubIssueSyncConfig = {
    enabled: true,
    repoUrl: repoUrl ?? undefined,
    projectId: github?.projectId,
    projectUrl,
    assignee: github?.assignee || undefined, // Empty string clears assignee
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
    dbSource.projects.update(project.id, { githubSync: syncConfig });

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
async function handleDisableGitHub(
  dbSource: McpCradle["dbSource"],
  project: McpCradle["project"]
): Promise<ToolResponse> {
  try {
    // Re-fetch project from database to get latest config
    const latestProject = await dbSource.projects.findById(project.id);
    if (!latestProject) {
      return errorResponse(`Project not found: ${project.id}`);
    }

    const currentSync = latestProject.githubSync;

    if (currentSync) {
      // Preserve config but set enabled to false
      await dbSource.projects.update(latestProject.id, {
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
 */
async function handleConfigureGitHub(
  dbSource: McpCradle["dbSource"],
  project: McpCradle["project"],
  githubCLI: McpCradle["githubCLI"],
  typeService: McpCradle["typeService"],
  github?: UpdateSettingsArgs["github"]
): Promise<ToolResponse> {
  if (!github) {
    return errorResponse("configure_github requires github configuration");
  }

  try {
    // Re-fetch project from database to get latest config
    const latestProject = await dbSource.projects.findById(project.id);
    if (!latestProject) {
      return errorResponse(`Project not found: ${project.id}`);
    }

    const currentSync = latestProject.githubSync;

    if (!currentSync) {
      return errorResponse("GitHub issue sync is not enabled. Use enable_github action first.");
    }

    // If projectId is being added/changed, validate it and get URL
    let projectUrl = currentSync.projectUrl;
    if (github.projectId && github.projectId !== currentSync.projectId) {
      const projectDetails = await githubCLI.getProjectDetails(github.projectId);
      if (!projectDetails) {
        return errorResponse(`GitHub Project ${github.projectId} not found or not accessible.`);
      }
      projectUrl = projectDetails.url;
    }

    // Validate assignee if provided (non-empty string)
    if (github.assignee !== undefined && github.assignee.length > 0) {
      const validationError = validateGitHubUsername(github.assignee);
      if (validationError) {
        return errorResponse(validationError);
      }
    }

    // Validate typeLabels against active types if provided
    if (github.labels?.typeLabels) {
      const typeValidationError = await validateTypeLabels(
        typeService,
        github.labels.typeLabels as Record<string, string>
      );
      if (typeValidationError) {
        return errorResponse(typeValidationError);
      }
    }

    // Determine assignee value:
    // - undefined in github.assignee means "keep current"
    // - empty string means "clear assignee"
    // - non-empty string means "set assignee"
    const assignee =
      github.assignee === undefined
        ? currentSync.assignee
        : github.assignee === ""
          ? undefined
          : github.assignee;

    // Merge with existing config (don't allow changing enabled via configure)
    const updatedConfig: GitHubIssueSyncConfig = {
      ...currentSync,
      projectId: github.projectId ?? currentSync.projectId,
      projectUrl: github.projectId ? projectUrl : currentSync.projectUrl,
      assignee,
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
    await dbSource.projects.update(latestProject.id, { githubSync: updatedConfig });

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
 * Configure status-to-column mapping for project boards
 */
async function handleConfigureColumnMapping(
  dbSource: McpCradle["dbSource"],
  project: McpCradle["project"],
  columnMapping?: Partial<StatusColumnMapping>,
  resetColumnMapping?: boolean
): Promise<ToolResponse> {
  try {
    // Re-fetch project from database to get latest config
    const latestProject = await dbSource.projects.findById(project.id);
    if (!latestProject) {
      return errorResponse(`Project not found: ${project.id}`);
    }

    const currentSync = latestProject.githubSync;

    if (!currentSync) {
      return errorResponse("GitHub issue sync is not enabled. Use enable_github action first.");
    }

    // Handle reset to defaults
    if (resetColumnMapping) {
      const updatedConfig: GitHubIssueSyncConfig = {
        ...currentSync,
        columnMapping: undefined, // Remove custom mapping, will use defaults
      };

      await dbSource.projects.update(latestProject.id, { githubSync: updatedConfig });

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

    await dbSource.projects.update(latestProject.id, { githubSync: updatedConfig });

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

/**
 * List available labels from the project management provider
 */
async function handleListAvailableLabels(
  dbSource: McpCradle["dbSource"],
  project: McpCradle["project"],
  githubCLI: McpCradle["githubCLI"],
  providerRegistry: McpCradle["providerRegistry"]
): Promise<ToolResponse> {
  try {
    // Re-fetch project from database to get latest config
    const latestProject = await dbSource.projects.findById(project.id);
    if (!latestProject) {
      return errorResponse(`Project not found: ${project.id}`);
    }

    const currentSync = latestProject.githubSync;

    if (!currentSync?.enabled) {
      return errorResponse("GitHub issue sync is not enabled. Use enable_github action first.");
    }

    // Create provider to query available labels
    const provider = providerRegistry.createProvider(latestProject, { githubCLI });

    const result = await provider.getAvailableLabels();

    if (!result.supported) {
      return successResponse({
        success: true,
        supported: false,
        labels: [],
        message: result.error ?? "Labels not supported by this provider",
      });
    }

    if (result.error) {
      return errorResponse(result.error);
    }

    return successResponse({
      success: true,
      supported: true,
      labels: result.labels.map((label) => ({
        name: label.name,
        validValues: label.validValues,
      })),
      message: `Found ${result.labels.length} available label(s)`,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

// =============================================================================
// Handler Implementation
// =============================================================================

/**
 * Handle update_settings tool call
 *
 * Routes to appropriate handler based on action.
 */
async function updateSettingsHandler(
  args: unknown,
  {
    project,
    config,
    dbSource,
    githubCLI,
    providerRegistry,
    typeService,
  }: Pick<
    McpCradle,
    "project" | "config" | "dbSource" | "githubCLI" | "providerRegistry" | "typeService"
  >
): Promise<ToolResponse> {
  const validation = validateToolArgs<UpdateSettingsArgs>(UpdateSettingsSchema, args);
  if (!validation.success) return validation.response;

  const { action, github, resetColumnMapping } = validation.data;

  switch (action) {
    case "get_settings":
      return handleGetSettings(dbSource, project, config, githubCLI, providerRegistry);

    case "enable_github":
      return handleEnableGitHub(dbSource, project, githubCLI, typeService, github);

    case "disable_github":
      return handleDisableGitHub(dbSource, project);

    case "configure_github":
      return handleConfigureGitHub(dbSource, project, githubCLI, typeService, github);

    case "configure_column_mapping":
      return handleConfigureColumnMapping(
        dbSource,
        project,
        github?.columnMapping,
        resetColumnMapping
      );

    case "list_available_labels":
      return handleListAvailableLabels(dbSource, project, githubCLI, providerRegistry);

    default:
      return errorResponse(`Unknown action: ${action}`);
  }
}

// =============================================================================
// Wrapped Handlers (for tool registry)
// =============================================================================

export const handleUpdateSettings = createMcpHandler(updateSettingsHandler);
