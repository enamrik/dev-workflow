/**
 * updateSettings - Project settings and GitHub integration
 *
 * Provides configuration for project settings, primarily GitHub integration.
 * Settings are stored in the projects table in the database.
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import { DbSourceTag } from "../../data-access/db-source.js";
import { ProjectTag } from "../../domain/projects/project.js";
import { GitHubCLITag } from "../../project-sync/github/github-cli.js";
import { ProjectManagementRegistry } from "../../project-sync/provider-registry.js";
import { TypeService } from "../../domain/types/type-service.js";
import {
  PROVIDER_DEFAULT_COLUMN_MAPPING,
  type ProjectManagementConfig,
  type ColumnMapping,
} from "../../project-sync/project-management-config.js";
import { validateInput } from "../validation.js";

// =============================================================================
// Schema & Types
// =============================================================================

export const UpdateSettingsSchema = z.object({
  action: z.enum([
    "get_settings",
    "enable_github",
    "disable_github",
    "configure_github",
    "configure_column_mapping",
    "list_available_labels",
  ]),
  github: z
    .object({
      projectId: z.string().optional(),
      assignee: z.string().optional(),
      labels: z
        .object({
          typeLabels: z.record(z.string(), z.string()).optional(),
          customLabels: z.array(z.string()).optional(),
        })
        .optional(),
      columnMapping: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  resetColumnMapping: z.boolean().optional(),
  gitRoot: z.string().min(1),
});

export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Validate GitHub username format
 */
function validateGitHubUsername(username: string): string | null {
  if (username.startsWith("@")) {
    return "GitHub username should not include @ prefix. Use 'username' not '@username'.";
  }

  if (username.length > 39) {
    return "GitHub username cannot exceed 39 characters.";
  }

  const validPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9]))*$/;
  if (!validPattern.test(username)) {
    return "Invalid GitHub username format. Use only letters, numbers, and single hyphens (not at start/end).";
  }

  return null;
}

/**
 * Validate typeLabels keys against active types in the database
 */
async function validateTypeLabels(
  typeService: TypeService,
  typeLabels: Record<string, string>
): Promise<string | null> {
  const providedTypes = Object.keys(typeLabels);
  if (providedTypes.length === 0) {
    return null;
  }

  const activeTypes = await typeService.getTypes();
  const validTypeNames = new Set<string>(activeTypes.map((t) => t.name));

  const invalidTypes = providedTypes.filter((t) => !validTypeNames.has(t));

  if (invalidTypes.length === 0) {
    return null;
  }

  const invalidList = invalidTypes.map((t) => `'${t}'`).join(", ");
  const validList = Array.from(validTypeNames).sort().join(", ");
  return `Invalid type(s) in typeLabels: ${invalidList}. Valid types: ${validList}`;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Update project settings.
 *
 * Routes to the appropriate action handler based on the `action` field.
 * Uses gitRoot from input to avoid circular dependency with MCP server.
 */
export function updateSettings(input: UpdateSettingsInput) {
  return Effect.gen(function* () {
    const { action, github, resetColumnMapping, gitRoot } = validateInput(
      UpdateSettingsSchema,
      input
    );
    const dbSource = yield* DbSourceTag;
    const project = yield* ProjectTag;
    const githubCLI = yield* GitHubCLITag;
    const providerRegistry = yield* ProjectManagementRegistry;
    const typeService = yield* TypeService;

    switch (action) {
      case "get_settings":
        return yield* Effect.promise(() =>
          getSettings(dbSource, project, gitRoot, githubCLI, providerRegistry)
        );

      case "enable_github":
        return yield* Effect.promise(() =>
          enableGitHub(dbSource, project, githubCLI, typeService, github)
        );

      case "disable_github":
        return yield* Effect.promise(() => disableGitHub(dbSource, project));

      case "configure_github":
        return yield* Effect.promise(() =>
          configureGitHub(dbSource, project, githubCLI, typeService, github)
        );

      case "configure_column_mapping":
        return yield* Effect.promise(() =>
          configureColumnMapping(dbSource, project, github?.columnMapping, resetColumnMapping)
        );

      case "list_available_labels":
        return yield* Effect.promise(() =>
          listAvailableLabels(dbSource, project, providerRegistry, githubCLI)
        );

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  });
}

// =============================================================================
// Action Handlers
// =============================================================================

import type { DbSource } from "../../data-access/db-source.js";
import type { Project } from "../../domain/projects/project.js";
import type { GitHubCLI } from "../../project-sync/github/github-cli.js";

/**
 * Get current settings and gh CLI status
 */
async function getSettings(
  dbSource: DbSource,
  project: Project,
  gitRoot: string,
  githubCLI: GitHubCLI,
  providerRegistry: ProjectManagementRegistry
) {
  // Re-fetch project from database to get latest config
  const latestProject = await dbSource.projects.findById(project.id);
  if (!latestProject) {
    throw new Error(`Project not found: ${project.id}`);
  }

  const isGitHubAuthenticated = await githubCLI.checkAuth();

  // Build effective column mapping (defaults + any custom overrides)
  const effectiveColumnMapping = latestProject.syncConfig
    ? {
        ...PROVIDER_DEFAULT_COLUMN_MAPPING,
        ...(latestProject.syncConfig.columnMapping ?? {}),
      }
    : null;

  // Get available providers from registry
  const availableProviders = providerRegistry.list({ githubCLI }).map((p) => ({
    id: p.providerId,
    name: p.displayName,
    available: p.available,
    missingDependencies: p.missingDependencies,
  }));

  return {
    projectId: latestProject.id,
    projectName: latestProject.name,
    gitRoot,
    gitRootHash: latestProject.gitRootHash,
    providers: {
      available: availableProviders,
      current: latestProject.syncConfig?.enabled ? "github" : null,
    },
    github: latestProject.syncConfig
      ? {
          syncIssues: latestProject.syncConfig,
          assignee: latestProject.syncConfig.assignee ?? null,
          columnMapping: {
            effective: effectiveColumnMapping,
            custom: latestProject.syncConfig.columnMapping,
            isDefault: !latestProject.syncConfig.columnMapping,
          },
        }
      : null,
    githubCLI: {
      authenticated: isGitHubAuthenticated,
    },
  };
}

/**
 * Enable GitHub integration with full validation
 */
async function enableGitHub(
  dbSource: DbSource,
  project: Project,
  githubCLI: GitHubCLI,
  typeService: TypeService,
  github?: UpdateSettingsInput["github"]
) {
  // Step 1: Check gh CLI authentication
  const isAuthenticated = await githubCLI.checkAuth();
  if (!isAuthenticated) {
    throw new Error("GitHub CLI (gh) is not authenticated. Run 'gh auth login' first.");
  }

  // Step 2: Verify we're in a GitHub repository and get repo URL
  const isGitHubRepo = await githubCLI.checkCurrentRepository();
  if (!isGitHubRepo) {
    throw new Error(
      "Not in a GitHub repository. Ensure this directory is a git repo with a GitHub remote."
    );
  }

  // Step 3: Verify project if provided and get URL
  let projectUrl: string | undefined;
  if (github?.projectId) {
    const projectDetails = await githubCLI.getProjectDetails(github.projectId);
    if (!projectDetails) {
      throw new Error(
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
      throw new Error(validationError);
    }
  }

  // Step 5: Validate typeLabels against active types if provided
  if (github?.labels?.typeLabels) {
    const typeValidationError = await validateTypeLabels(
      typeService,
      github.labels.typeLabels as Record<string, string>
    );
    if (typeValidationError) {
      throw new Error(typeValidationError);
    }
  }

  // Step 6: Build and save config with defaults for missing label config
  const syncConfig: ProjectManagementConfig = {
    enabled: true,
    projectId: github?.projectId,
    projectUrl,
    assignee: github?.assignee || undefined,
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

  // Update project in database with GitHub sync config
  await dbSource.projects.update(project.id, { syncConfig });

  return {
    success: true,
    message: "GitHub issue sync enabled (repository auto-detected from git remotes)",
    config: { syncIssues: syncConfig },
  };
}

/**
 * Disable GitHub issue sync
 */
async function disableGitHub(dbSource: DbSource, project: Project) {
  // Re-fetch project from database to get latest config
  const latestProject = await dbSource.projects.findById(project.id);
  if (!latestProject) {
    throw new Error(`Project not found: ${project.id}`);
  }

  const currentSync = latestProject.syncConfig;

  if (currentSync) {
    // Preserve config but set enabled to false
    await dbSource.projects.update(latestProject.id, {
      syncConfig: { ...currentSync, enabled: false },
    });
  }

  return {
    success: true,
    message: "GitHub issue sync disabled",
  };
}

/**
 * Update GitHub issue sync configuration without re-validating repository access
 */
async function configureGitHub(
  dbSource: DbSource,
  project: Project,
  githubCLI: GitHubCLI,
  typeService: TypeService,
  github?: UpdateSettingsInput["github"]
) {
  if (!github) {
    throw new Error("configure_github requires github configuration");
  }

  // Re-fetch project from database to get latest config
  const latestProject = await dbSource.projects.findById(project.id);
  if (!latestProject) {
    throw new Error(`Project not found: ${project.id}`);
  }

  const currentSync = latestProject.syncConfig;

  if (!currentSync) {
    throw new Error("GitHub issue sync is not enabled. Use enable_github action first.");
  }

  // If projectId is being added/changed, validate it and get URL
  let projectUrl = currentSync.projectUrl;
  if (github.projectId && github.projectId !== currentSync.projectId) {
    const projectDetails = await githubCLI.getProjectDetails(github.projectId);
    if (!projectDetails) {
      throw new Error(`GitHub Project ${github.projectId} not found or not accessible.`);
    }
    projectUrl = projectDetails.url;
  }

  // Validate assignee if provided (non-empty string)
  if (github.assignee !== undefined && github.assignee.length > 0) {
    const validationError = validateGitHubUsername(github.assignee);
    if (validationError) {
      throw new Error(validationError);
    }
  }

  // Validate typeLabels against active types if provided
  if (github.labels?.typeLabels) {
    const typeValidationError = await validateTypeLabels(
      typeService,
      github.labels.typeLabels as Record<string, string>
    );
    if (typeValidationError) {
      throw new Error(typeValidationError);
    }
  }

  // Determine assignee value
  const assignee =
    github.assignee === undefined
      ? currentSync.assignee
      : github.assignee === ""
        ? undefined
        : github.assignee;

  // Merge with existing config
  const updatedConfig: ProjectManagementConfig = {
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
    enabled: currentSync.enabled,
  };

  // Update project in database
  await dbSource.projects.update(latestProject.id, { syncConfig: updatedConfig });

  return {
    success: true,
    message: "GitHub issue sync configuration updated",
    config: { syncIssues: updatedConfig },
  };
}

/**
 * Configure status-to-column mapping for project boards
 */
async function configureColumnMapping(
  dbSource: DbSource,
  project: Project,
  columnMapping?: Partial<ColumnMapping>,
  resetColumnMapping?: boolean
) {
  // Re-fetch project from database to get latest config
  const latestProject = await dbSource.projects.findById(project.id);
  if (!latestProject) {
    throw new Error(`Project not found: ${project.id}`);
  }

  const currentSync = latestProject.syncConfig;

  if (!currentSync) {
    throw new Error("GitHub issue sync is not enabled. Use enable_github action first.");
  }

  // Handle reset to defaults
  if (resetColumnMapping) {
    const updatedConfig: ProjectManagementConfig = {
      ...currentSync,
      columnMapping: undefined,
    };

    await dbSource.projects.update(latestProject.id, { syncConfig: updatedConfig });

    return {
      success: true,
      message: "Column mapping reset to defaults",
      columnMapping: PROVIDER_DEFAULT_COLUMN_MAPPING,
      isDefault: true,
    };
  }

  // Validate that at least some mapping is provided
  if (!columnMapping || Object.keys(columnMapping).length === 0) {
    const effectiveMapping = {
      ...PROVIDER_DEFAULT_COLUMN_MAPPING,
      ...(currentSync.columnMapping ?? {}),
    };

    return {
      success: true,
      message: "Current column mapping",
      columnMapping: effectiveMapping,
      customMapping: currentSync.columnMapping,
      isDefault: !currentSync.columnMapping,
    };
  }

  // Merge with existing custom mapping
  const mergedMapping: ColumnMapping = {
    ...(currentSync.columnMapping ?? {}),
    ...columnMapping,
  };

  const updatedConfig: ProjectManagementConfig = {
    ...currentSync,
    columnMapping: mergedMapping,
  };

  await dbSource.projects.update(latestProject.id, { syncConfig: updatedConfig });

  const effectiveMapping = {
    ...PROVIDER_DEFAULT_COLUMN_MAPPING,
    ...mergedMapping,
  };

  return {
    success: true,
    message: "Column mapping updated",
    columnMapping: effectiveMapping,
    customMapping: mergedMapping,
    isDefault: false,
  };
}

/**
 * List available labels from the project management provider
 */
async function listAvailableLabels(
  dbSource: DbSource,
  project: Project,
  providerRegistry: ProjectManagementRegistry,
  githubCLI: GitHubCLI
) {
  // Re-fetch project from database to get latest config
  const latestProject = await dbSource.projects.findById(project.id);
  if (!latestProject) {
    throw new Error(`Project not found: ${project.id}`);
  }

  const currentSync = latestProject.syncConfig;

  if (!currentSync?.enabled) {
    throw new Error("GitHub issue sync is not enabled. Use enable_github action first.");
  }

  // Create provider to query available labels
  const provider = providerRegistry.createProvider(latestProject, {
    githubCLI,
  });

  const result = await provider.getAvailableLabels();

  if (!result.supported) {
    return {
      success: true,
      supported: false,
      labels: [] as Array<{ name: string; validValues: string[] | undefined }>,
      message: result.error ?? "Labels not supported by this provider",
    };
  }

  if (result.error) {
    throw new Error(result.error);
  }

  return {
    success: true,
    supported: true,
    labels: result.labels.map((label) => ({
      name: label.name,
      validValues: label.validValues,
    })),
    message: `Found ${result.labels.length} available label(s)`,
  };
}
