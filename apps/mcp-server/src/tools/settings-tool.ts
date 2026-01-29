/**
 * SettingsTool - Project settings and GitHub integration
 *
 * Provides configuration for project settings, primarily GitHub integration.
 * Settings are stored in the projects table in the database.
 */

import {
  DEFAULT_COLUMN_MAPPING,
  type ProjectManagementConfig,
  type ColumnMapping,
  type DbSource,
  type Project,
  type GitHubCLI,
  type ProjectManagementRegistry,
  type TypeService,
} from "@dev-workflow/tracking";

// =============================================================================
// Types
// =============================================================================

export interface McpConfig {
  readonly projectSlug: string;
  readonly databasePath: string;
  readonly projectId: string;
  readonly gitRoot: string;
}

export interface UpdateSettingsInput {
  action:
    | "get_settings"
    | "enable_github"
    | "disable_github"
    | "configure_github"
    | "configure_column_mapping"
    | "list_available_labels";
  github?: {
    projectId?: string;
    assignee?: string;
    labels?: {
      typeLabels?: Record<string, string>;
      customLabels?: string[];
    };
    columnMapping?: Partial<ColumnMapping>;
  };
  resetColumnMapping?: boolean;
}

// =============================================================================
// SettingsTool Class
// =============================================================================

export class SettingsTool {
  constructor(
    private readonly dbSource: DbSource,
    private readonly project: Project,
    private readonly config: McpConfig,
    private readonly githubCLI: GitHubCLI,
    private readonly providerRegistry: ProjectManagementRegistry,
    private readonly typeService: TypeService
  ) {}

  /**
   * Route to appropriate action handler
   */
  async updateSettings(input: UpdateSettingsInput) {
    const { action, github, resetColumnMapping } = input;

    switch (action) {
      case "get_settings":
        return this.getSettings();

      case "enable_github":
        return this.enableGitHub(github);

      case "disable_github":
        return this.disableGitHub();

      case "configure_github":
        return this.configureGitHub(github);

      case "configure_column_mapping":
        return this.configureColumnMapping(github?.columnMapping, resetColumnMapping);

      case "list_available_labels":
        return this.listAvailableLabels();

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * Get current settings and gh CLI status
   */
  private async getSettings() {
    // Re-fetch project from database to get latest config
    const latestProject = await this.dbSource.projects.findById(this.project.id);
    if (!latestProject) {
      throw new Error(`Project not found: ${this.project.id}`);
    }

    const isGitHubAuthenticated = await this.githubCLI.checkAuth();

    // Build effective column mapping (defaults + any custom overrides)
    const effectiveColumnMapping = latestProject.syncConfig
      ? {
          ...DEFAULT_COLUMN_MAPPING,
          ...(latestProject.syncConfig.columnMapping ?? {}),
        }
      : null;

    // Get available providers from registry
    const availableProviders = this.providerRegistry
      .list({ githubCLI: this.githubCLI })
      .map((p) => ({
        id: p.providerId,
        name: p.displayName,
        available: p.available,
        missingDependencies: p.missingDependencies,
      }));

    return {
      projectId: latestProject.id,
      projectName: latestProject.name,
      gitRoot: this.config.gitRoot,
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
  private async enableGitHub(github?: UpdateSettingsInput["github"]) {
    // Step 1: Check gh CLI authentication
    const isAuthenticated = await this.githubCLI.checkAuth();
    if (!isAuthenticated) {
      throw new Error("GitHub CLI (gh) is not authenticated. Run 'gh auth login' first.");
    }

    // Step 2: Verify we're in a GitHub repository and get repo URL
    const isGitHubRepo = await this.githubCLI.checkCurrentRepository();
    if (!isGitHubRepo) {
      throw new Error(
        "Not in a GitHub repository. Ensure this directory is a git repo with a GitHub remote."
      );
    }

    // Step 3: Verify project if provided and get URL
    let projectUrl: string | undefined;
    if (github?.projectId) {
      const projectDetails = await this.githubCLI.getProjectDetails(github.projectId);
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
      const validationError = this.validateGitHubUsername(github.assignee);
      if (validationError) {
        throw new Error(validationError);
      }
    }

    // Step 5: Validate typeLabels against active types if provided
    if (github?.labels?.typeLabels) {
      const typeValidationError = await this.validateTypeLabels(
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
    this.dbSource.projects.update(this.project.id, { syncConfig });

    return {
      success: true,
      message: "GitHub issue sync enabled (repository auto-detected from git remotes)",
      config: { syncIssues: syncConfig },
    };
  }

  /**
   * Disable GitHub issue sync
   */
  private async disableGitHub() {
    // Re-fetch project from database to get latest config
    const latestProject = await this.dbSource.projects.findById(this.project.id);
    if (!latestProject) {
      throw new Error(`Project not found: ${this.project.id}`);
    }

    const currentSync = latestProject.syncConfig;

    if (currentSync) {
      // Preserve config but set enabled to false
      await this.dbSource.projects.update(latestProject.id, {
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
  private async configureGitHub(github?: UpdateSettingsInput["github"]) {
    if (!github) {
      throw new Error("configure_github requires github configuration");
    }

    // Re-fetch project from database to get latest config
    const latestProject = await this.dbSource.projects.findById(this.project.id);
    if (!latestProject) {
      throw new Error(`Project not found: ${this.project.id}`);
    }

    const currentSync = latestProject.syncConfig;

    if (!currentSync) {
      throw new Error("GitHub issue sync is not enabled. Use enable_github action first.");
    }

    // If projectId is being added/changed, validate it and get URL
    let projectUrl = currentSync.projectUrl;
    if (github.projectId && github.projectId !== currentSync.projectId) {
      const projectDetails = await this.githubCLI.getProjectDetails(github.projectId);
      if (!projectDetails) {
        throw new Error(`GitHub Project ${github.projectId} not found or not accessible.`);
      }
      projectUrl = projectDetails.url;
    }

    // Validate assignee if provided (non-empty string)
    if (github.assignee !== undefined && github.assignee.length > 0) {
      const validationError = this.validateGitHubUsername(github.assignee);
      if (validationError) {
        throw new Error(validationError);
      }
    }

    // Validate typeLabels against active types if provided
    if (github.labels?.typeLabels) {
      const typeValidationError = await this.validateTypeLabels(
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
    await this.dbSource.projects.update(latestProject.id, { syncConfig: updatedConfig });

    return {
      success: true,
      message: "GitHub issue sync configuration updated",
      config: { syncIssues: updatedConfig },
    };
  }

  /**
   * Configure status-to-column mapping for project boards
   */
  private async configureColumnMapping(
    columnMapping?: Partial<ColumnMapping>,
    resetColumnMapping?: boolean
  ) {
    // Re-fetch project from database to get latest config
    const latestProject = await this.dbSource.projects.findById(this.project.id);
    if (!latestProject) {
      throw new Error(`Project not found: ${this.project.id}`);
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

      await this.dbSource.projects.update(latestProject.id, { syncConfig: updatedConfig });

      return {
        success: true,
        message: "Column mapping reset to defaults",
        columnMapping: DEFAULT_COLUMN_MAPPING,
        isDefault: true,
      };
    }

    // Validate that at least some mapping is provided
    if (!columnMapping || Object.keys(columnMapping).length === 0) {
      const effectiveMapping = {
        ...DEFAULT_COLUMN_MAPPING,
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

    await this.dbSource.projects.update(latestProject.id, { syncConfig: updatedConfig });

    const effectiveMapping = {
      ...DEFAULT_COLUMN_MAPPING,
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
  private async listAvailableLabels() {
    // Re-fetch project from database to get latest config
    const latestProject = await this.dbSource.projects.findById(this.project.id);
    if (!latestProject) {
      throw new Error(`Project not found: ${this.project.id}`);
    }

    const currentSync = latestProject.syncConfig;

    if (!currentSync?.enabled) {
      throw new Error("GitHub issue sync is not enabled. Use enable_github action first.");
    }

    // Create provider to query available labels
    const provider = this.providerRegistry.createProvider(latestProject, {
      githubCLI: this.githubCLI,
    });

    const result = await provider.getAvailableLabels();

    if (!result.supported) {
      return {
        success: true,
        supported: false,
        labels: [],
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

  // =============================================================================
  // Helper Functions
  // =============================================================================

  /**
   * Validate typeLabels keys against active types in the database
   */
  private async validateTypeLabels(typeLabels: Record<string, string>): Promise<string | null> {
    const providedTypes = Object.keys(typeLabels);
    if (providedTypes.length === 0) {
      return null;
    }

    const activeTypes = await this.typeService.getTypes();
    const validTypeNames = new Set<string>(activeTypes.map((t) => t.name));

    const invalidTypes = providedTypes.filter((t) => !validTypeNames.has(t));

    if (invalidTypes.length === 0) {
      return null;
    }

    const invalidList = invalidTypes.map((t) => `'${t}'`).join(", ");
    const validList = Array.from(validTypeNames).sort().join(", ");
    return `Invalid type(s) in typeLabels: ${invalidList}. Valid types: ${validList}`;
  }

  /**
   * Validate GitHub username format
   */
  private validateGitHubUsername(username: string): string | null {
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
}
