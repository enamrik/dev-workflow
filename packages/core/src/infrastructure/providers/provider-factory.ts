/**
 * ProviderFactory - Interface for creating ProjectManagementProvider instances
 *
 * Factories encapsulate provider instantiation and dependency injection.
 * Each provider type has its own factory that knows how to create instances
 * with the appropriate dependencies.
 */

import type { ProjectManagementProvider } from "../../domain/project-management-provider.js";
import type { Project } from "../../domain/project.js";
import { GitHubProjectManagementProvider } from "./github-project-management-provider.js";

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
  githubCLI?: import("../github/github-cli.js").GitHubCLI;

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
    const projectId = project.githubSync?.projectId;
    return new GitHubProjectManagementProvider(deps.githubCLI, projectId);
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
