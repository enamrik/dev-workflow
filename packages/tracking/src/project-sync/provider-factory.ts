/**
 * ProviderFactory - Interface for creating ProjectManagementProvider instances
 *
 * Factories encapsulate provider instantiation and dependency injection.
 * Each provider type has its own factory that knows how to create instances
 * with the appropriate dependencies.
 *
 * New Architecture:
 * - ProjectManagementClient: Low-level API calls only
 * - ProjectManagementService: Orchestration logic wrapping the client
 * - Use ClientFactory + getProjectManagementService for new code
 */

import type { ProjectManagementProvider } from "./project-management-provider.js";
import type { ProjectManagementClient } from "./project-management-client.js";
import type { Project } from "../domain/projects/project.js";
import { GitHubProjectManagementProvider } from "./github/github-project-management-provider.js";
import { GitHubProjectManagementClient } from "./github/github-project-management-client.js";
import { NoOpProjectManagementClient } from "./noop-project-management-client.js";
import { ProjectManagementService } from "./project-management-service.js";

/**
 * Dependencies that can be injected into providers
 *
 * Different providers may need different dependencies:
 * - GitHub: GitHubCLI for API calls
 * - Jira: JiraClient for REST API
 * - Linear: LinearClient for GraphQL API
 */
export interface ProviderDependencies {
  /**
   * GitHub CLI interface (for GitHub provider)
   */
  githubCLI?: import("./github/github-cli.js").GitHubCLI;

  // Future providers can add their dependencies here:
  // jiraClient?: JiraClient;
  // linearClient?: LinearClient;
}

/**
 * Factory interface for creating ProjectManagementProvider instances
 *
 * Each provider type implements this interface to encapsulate
 * its specific instantiation logic and dependency requirements.
 */
export interface ProviderFactory {
  /**
   * Unique identifier for the provider this factory creates
   * Must match the providerId used in configuration
   */
  readonly providerId: string;

  /**
   * Human-readable name for the provider
   */
  readonly displayName: string;

  /**
   * Create a new provider instance
   *
   * @param project - The project containing provider configuration
   * @param deps - Dependencies for the provider
   * @returns A configured provider instance
   * @throws Error if required dependencies are missing
   */
  createProvider(project: Project, deps: ProviderDependencies): ProjectManagementProvider;

  /**
   * Check if all required dependencies are available
   *
   * @param deps - Available dependencies
   * @returns True if all required dependencies are present
   */
  canCreate(deps: ProviderDependencies): boolean;

  /**
   * Get list of missing required dependencies
   *
   * @param deps - Available dependencies
   * @returns Array of missing dependency names (empty if all present)
   */
  getMissingDependencies(deps: ProviderDependencies): string[];
}

/**
 * Factory for creating GitHub ProjectManagementProvider instances
 */
export class GitHubProviderFactory implements ProviderFactory {
  readonly providerId = "github";
  readonly displayName = "GitHub";

  createProvider(project: Project, deps: ProviderDependencies): ProjectManagementProvider {
    if (!deps.githubCLI) {
      throw new Error("GitHubProviderFactory requires githubCLI dependency");
    }

    // Factory extracts project.githubSync internally - callers don't need to know
    // which field contains the provider config
    return new GitHubProjectManagementProvider(deps.githubCLI, project.syncConfig ?? null);
  }

  canCreate(deps: ProviderDependencies): boolean {
    return deps.githubCLI !== undefined;
  }

  getMissingDependencies(deps: ProviderDependencies): string[] {
    const missing: string[] = [];
    if (!deps.githubCLI) {
      missing.push("githubCLI");
    }
    return missing;
  }
}

// =============================================================================
// New Architecture: Client + Service
// =============================================================================

/**
 * Factory interface for creating ProjectManagementClient instances
 *
 * Clients handle low-level API calls only. Use with ProjectManagementService
 * for full orchestration capabilities.
 */
export interface ClientFactory {
  /**
   * Unique identifier for the provider this factory creates
   */
  readonly providerId: string;

  /**
   * Human-readable name for the provider
   */
  readonly displayName: string;

  /**
   * Create a new client instance
   */
  createClient(project: Project, deps: ProviderDependencies): ProjectManagementClient;

  /**
   * Check if all required dependencies are available
   */
  canCreate(deps: ProviderDependencies): boolean;

  /**
   * Get list of missing required dependencies
   */
  getMissingDependencies(deps: ProviderDependencies): string[];
}

/**
 * Factory for creating GitHub ProjectManagementClient instances
 */
export class GitHubClientFactory implements ClientFactory {
  readonly providerId = "github";
  readonly displayName = "GitHub";

  createClient(project: Project, deps: ProviderDependencies): ProjectManagementClient {
    if (!deps.githubCLI) {
      throw new Error("GitHubClientFactory requires githubCLI dependency");
    }

    return new GitHubProjectManagementClient(deps.githubCLI, project.syncConfig ?? null);
  }

  canCreate(deps: ProviderDependencies): boolean {
    return deps.githubCLI !== undefined;
  }

  getMissingDependencies(deps: ProviderDependencies): string[] {
    const missing: string[] = [];
    if (!deps.githubCLI) {
      missing.push("githubCLI");
    }
    return missing;
  }
}

/**
 * Create a ProjectManagementClient for a project
 *
 * Returns:
 * - GitHubProjectManagementClient if GitHub sync is configured and enabled
 * - NoOpProjectManagementClient otherwise
 *
 * @param project - The project containing provider configuration
 * @param deps - Dependencies for the client
 * @returns A configured client instance
 */
export function getProjectManagementClient(
  project: Project,
  deps: ProviderDependencies
): ProjectManagementClient {
  // Check if GitHub sync is enabled
  if (project.syncConfig?.enabled && project.syncConfig?.providerId === "github") {
    if (!deps.githubCLI) {
      console.warn("GitHub sync is enabled but GitHubCLI not provided - using NoOp client");
      return new NoOpProjectManagementClient();
    }
    return new GitHubProjectManagementClient(deps.githubCLI, project.syncConfig);
  }

  // No sync configured or not GitHub - return NoOp
  return new NoOpProjectManagementClient();
}

/**
 * Create a ProjectManagementService for a project
 *
 * This is the recommended way to get project management capabilities.
 * The service wraps the client and provides orchestration logic.
 *
 * @param project - The project containing provider configuration
 * @param deps - Dependencies for the client
 * @returns A configured service instance
 */
export function getProjectManagementService(
  project: Project,
  deps: ProviderDependencies
): ProjectManagementService {
  const client = getProjectManagementClient(project, deps);
  return new ProjectManagementService(client);
}
