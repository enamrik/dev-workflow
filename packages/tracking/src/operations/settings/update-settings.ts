/**
 * updateSettings - Project settings and GitHub integration
 *
 * Provides configuration for project settings, primarily GitHub integration.
 * Settings are stored in the projects table in the database.
 */

import { z } from "zod";
import { Effect } from "@dev-workflow/effect";
import {
  EntityNotFoundError,
  BusinessRuleError,
  ValidationError,
  AuthenticationError,
} from "../../domain/errors.js";
import { DbSourceTag } from "../../data-access/db-source.js";
import { ProjectTag } from "../../domain/projects/project.js";
import { GitHubCLITag } from "../../project-sync/github/github-cli.js";
import { ProjectManagementRegistry } from "../../project-sync/provider-registry.js";
import { TypeDomainService } from "../../domain/types/type-service.js";
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
          typeMappings: z.record(z.string(), z.string()).optional(),
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
 * Resolve typeMappings from input, preferring typeMappings over deprecated typeLabels
 */
function resolveTypeMappings(
  labels: { typeMappings?: Record<string, string>; typeLabels?: Record<string, string> } | undefined
): Record<string, string> | undefined {
  return labels?.typeMappings ?? labels?.typeLabels;
}

/**
 * Validate typeMappings keys against active types in the database
 */
function validateTypeMappings(
  typeDomainService: TypeDomainService,
  typeMappings: Record<string, string>
) {
  return Effect.gen(function* () {
    const providedTypes = Object.keys(typeMappings);
    if (providedTypes.length === 0) {
      return null;
    }

    const activeTypes = yield* typeDomainService.getTypes();
    const validTypeNames = new Set<string>(activeTypes.map((t) => t.name));

    const invalidTypes = providedTypes.filter((t) => !validTypeNames.has(t));

    if (invalidTypes.length === 0) {
      return null;
    }

    const invalidList = invalidTypes.map((t) => `'${t}'`).join(", ");
    const validList = Array.from(validTypeNames).sort().join(", ");
    return `Invalid type(s) in typeMappings: ${invalidList}. Valid types: ${validList}`;
  });
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
    const typeDomainService = yield* TypeDomainService;

    switch (action) {
      case "get_settings":
        return yield* getSettings(dbSource, project, gitRoot, githubCLI, providerRegistry);

      case "enable_github":
        return yield* enableGitHub(dbSource, project, githubCLI, typeDomainService, github);

      case "disable_github":
        return yield* disableGitHub(dbSource, project);

      case "configure_github":
        return yield* configureGitHub(dbSource, project, githubCLI, typeDomainService, github);

      case "configure_column_mapping":
        return yield* configureColumnMapping(
          dbSource,
          project,
          github?.columnMapping,
          resetColumnMapping
        );

      case "list_available_labels":
        return yield* listAvailableLabels(dbSource, project, providerRegistry, githubCLI);

      default:
        return yield* Effect.fail(new ValidationError("action", `Unknown action: ${action}`));
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
function getSettings(
  dbSource: DbSource,
  project: Project,
  gitRoot: string,
  githubCLI: GitHubCLI,
  providerRegistry: ProjectManagementRegistry
) {
  return Effect.gen(function* () {
    // Re-fetch project from database to get latest config
    const latestProject = yield* dbSource.projects.findById(project.id);
    if (!latestProject) {
      return yield* Effect.fail(new EntityNotFoundError("Project", project.id));
    }

    const isGitHubAuthenticated = yield* githubCLI.checkAuth();

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
  });
}

/**
 * Enable GitHub integration with full validation
 */
function enableGitHub(
  dbSource: DbSource,
  project: Project,
  githubCLI: GitHubCLI,
  typeDomainService: TypeDomainService,
  github?: UpdateSettingsInput["github"]
) {
  return Effect.gen(function* () {
    // Step 1: Check gh CLI authentication
    const isAuthenticated = yield* githubCLI.checkAuth();
    if (!isAuthenticated) {
      return yield* Effect.fail(
        new AuthenticationError("GitHub CLI (gh) is not authenticated. Run 'gh auth login' first.")
      );
    }

    // Step 2: Verify we're in a GitHub repository and get repo URL
    const isGitHubRepo = yield* githubCLI.checkCurrentRepository();
    if (!isGitHubRepo) {
      return yield* Effect.fail(
        new BusinessRuleError(
          "Not in a GitHub repository. Ensure this directory is a git repo with a GitHub remote."
        )
      );
    }

    // Step 3: Verify project if provided and get URL
    let projectUrl: string | undefined;
    if (github?.projectId) {
      const projectDetails = yield* githubCLI.getProjectDetails(github.projectId);
      if (!projectDetails) {
        return yield* Effect.fail(
          new EntityNotFoundError(
            "GitHubProject",
            `${github.projectId} (ensure the Project ID is correct, format: PVT_...)`
          )
        );
      }
      projectUrl = projectDetails.url;
    }

    // Step 4: Validate assignee if provided
    if (github?.assignee && github.assignee.length > 0) {
      const validationError = validateGitHubUsername(github.assignee);
      if (validationError) {
        return yield* Effect.fail(new ValidationError("assignee", validationError));
      }
    }

    // Step 5: Validate typeMappings against active types if provided
    const inputTypeMappings = resolveTypeMappings(github?.labels);
    if (inputTypeMappings) {
      const typeValidationError = yield* validateTypeMappings(typeDomainService, inputTypeMappings);
      if (typeValidationError) {
        return yield* Effect.fail(new ValidationError("typeMappings", typeValidationError));
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
            typeMappings: {
              FEATURE: inputTypeMappings?.FEATURE ?? "feature",
              BUG: inputTypeMappings?.BUG ?? "bug",
              ENHANCEMENT: inputTypeMappings?.ENHANCEMENT ?? "enhancement",
              TASK: inputTypeMappings?.TASK ?? "task",
            },
            customLabels: github.labels.customLabels,
          }
        : {
            typeMappings: {
              FEATURE: "feature",
              BUG: "bug",
              ENHANCEMENT: "enhancement",
              TASK: "task",
            },
          },
    };

    // Update project in database with GitHub sync config
    yield* dbSource.projects.update(project.id, { syncConfig });

    return {
      success: true,
      message: "GitHub issue sync enabled (repository auto-detected from git remotes)",
      config: { syncIssues: syncConfig },
    };
  });
}

/**
 * Disable GitHub issue sync
 */
function disableGitHub(dbSource: DbSource, project: Project) {
  return Effect.gen(function* () {
    // Re-fetch project from database to get latest config
    const latestProject = yield* dbSource.projects.findById(project.id);
    if (!latestProject) {
      return yield* Effect.fail(new EntityNotFoundError("Project", project.id));
    }

    const currentSync = latestProject.syncConfig;

    if (currentSync) {
      // Preserve config but set enabled to false
      yield* dbSource.projects.update(latestProject.id, {
        syncConfig: { ...currentSync, enabled: false },
      });
    }

    return {
      success: true,
      message: "GitHub issue sync disabled",
    };
  });
}

/**
 * Update GitHub issue sync configuration without re-validating repository access
 */
function configureGitHub(
  dbSource: DbSource,
  project: Project,
  githubCLI: GitHubCLI,
  typeDomainService: TypeDomainService,
  github?: UpdateSettingsInput["github"]
) {
  return Effect.gen(function* () {
    if (!github) {
      return yield* Effect.fail(
        new ValidationError("github", "configure_github requires github configuration")
      );
    }

    // Re-fetch project from database to get latest config
    const latestProject = yield* dbSource.projects.findById(project.id);
    if (!latestProject) {
      return yield* Effect.fail(new EntityNotFoundError("Project", project.id));
    }

    const currentSync = latestProject.syncConfig;

    if (!currentSync) {
      return yield* Effect.fail(
        new BusinessRuleError("GitHub issue sync is not enabled. Use enable_github action first.")
      );
    }

    // If projectId is being added/changed, validate it and get URL
    let projectUrl = currentSync.projectUrl;
    if (github.projectId && github.projectId !== currentSync.projectId) {
      const projectDetails = yield* githubCLI.getProjectDetails(github.projectId);
      if (!projectDetails) {
        return yield* Effect.fail(new EntityNotFoundError("GitHubProject", github.projectId));
      }
      projectUrl = projectDetails.url;
    }

    // Validate assignee if provided (non-empty string)
    if (github.assignee !== undefined && github.assignee.length > 0) {
      const validationError = validateGitHubUsername(github.assignee);
      if (validationError) {
        return yield* Effect.fail(new ValidationError("assignee", validationError));
      }
    }

    // Validate typeMappings against active types if provided
    const configureTypeMappings = resolveTypeMappings(github.labels);
    if (configureTypeMappings) {
      const typeValidationError = yield* validateTypeMappings(
        typeDomainService,
        configureTypeMappings
      );
      if (typeValidationError) {
        return yield* Effect.fail(new ValidationError("typeMappings", typeValidationError));
      }
    }

    // Determine assignee value
    const assignee =
      github.assignee === undefined
        ? currentSync.assignee
        : github.assignee === ""
          ? undefined
          : github.assignee;

    // Read existing typeMappings (supports legacy typeLabels in stored config)
    const existingMappings = currentSync.labels?.typeMappings;

    // Merge with existing config
    const updatedConfig: ProjectManagementConfig = {
      ...currentSync,
      projectId: github.projectId ?? currentSync.projectId,
      projectUrl: github.projectId ? projectUrl : currentSync.projectUrl,
      assignee,
      labels: github.labels
        ? {
            typeMappings: {
              FEATURE: configureTypeMappings?.FEATURE ?? existingMappings?.FEATURE ?? "feature",
              BUG: configureTypeMappings?.BUG ?? existingMappings?.BUG ?? "bug",
              ENHANCEMENT:
                configureTypeMappings?.ENHANCEMENT ??
                existingMappings?.ENHANCEMENT ??
                "enhancement",
              TASK: configureTypeMappings?.TASK ?? existingMappings?.TASK ?? "task",
            },
            customLabels: github.labels.customLabels ?? currentSync.labels?.customLabels,
          }
        : currentSync.labels,
      enabled: currentSync.enabled,
    };

    // Update project in database
    yield* dbSource.projects.update(latestProject.id, { syncConfig: updatedConfig });

    return {
      success: true,
      message: "GitHub issue sync configuration updated",
      config: { syncIssues: updatedConfig },
    };
  });
}

/**
 * Configure status-to-column mapping for project boards
 */
function configureColumnMapping(
  dbSource: DbSource,
  project: Project,
  columnMapping?: Partial<ColumnMapping>,
  resetColumnMapping?: boolean
) {
  return Effect.gen(function* () {
    // Re-fetch project from database to get latest config
    const latestProject = yield* dbSource.projects.findById(project.id);
    if (!latestProject) {
      return yield* Effect.fail(new EntityNotFoundError("Project", project.id));
    }

    const currentSync = latestProject.syncConfig;

    if (!currentSync) {
      return yield* Effect.fail(
        new BusinessRuleError("GitHub issue sync is not enabled. Use enable_github action first.")
      );
    }

    // Handle reset to defaults
    if (resetColumnMapping) {
      const updatedConfig: ProjectManagementConfig = {
        ...currentSync,
        columnMapping: undefined,
      };

      yield* dbSource.projects.update(latestProject.id, { syncConfig: updatedConfig });

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

    yield* dbSource.projects.update(latestProject.id, { syncConfig: updatedConfig });

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
  });
}

/**
 * List available labels from the project management provider
 */
function listAvailableLabels(
  dbSource: DbSource,
  project: Project,
  providerRegistry: ProjectManagementRegistry,
  githubCLI: GitHubCLI
) {
  return Effect.gen(function* () {
    // Re-fetch project from database to get latest config
    const latestProject = yield* dbSource.projects.findById(project.id);
    if (!latestProject) {
      return yield* Effect.fail(new EntityNotFoundError("Project", project.id));
    }

    const currentSync = latestProject.syncConfig;

    if (!currentSync?.enabled) {
      return yield* Effect.fail(
        new BusinessRuleError("GitHub issue sync is not enabled. Use enable_github action first.")
      );
    }

    // Create provider to query available labels
    const provider = providerRegistry.createProvider(latestProject, {
      githubCLI,
    });

    const result = yield* provider.getAvailableLabels();

    if (!result.supported) {
      return {
        success: true,
        supported: false,
        labels: [] as Array<{ name: string; validValues: string[] | undefined }>,
        message: result.error ?? "Labels not supported by this provider",
      };
    }

    if (result.error) {
      return yield* Effect.fail(new BusinessRuleError(result.error));
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
  });
}
