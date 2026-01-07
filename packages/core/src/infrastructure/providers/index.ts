/**
 * Project Management Providers
 *
 * Provider implementations and infrastructure for external project management systems.
 *
 * Usage:
 *   import { getProjectManagementProvider, ProviderRegistry } from '@dev-workflow/core';
 *
 *   // Simple: use convenience function
 *   const provider = getProjectManagementProvider(project, { githubCLI });
 *
 *   // Advanced: use registry directly
 *   const registry = ProviderRegistry.getInstance();
 *   const provider = registry.createProvider(project, { githubCLI });
 */

// Provider implementation
export { GitHubProjectManagementProvider } from "./github-project-management-provider.js";

// Factory interfaces and implementations
export {
  type ProviderFactory,
  type ProviderDependencies,
  GitHubProviderFactory,
} from "./provider-factory.js";

// Registry
export {
  ProviderRegistry,
  ProviderNotFoundError,
  ProviderDependencyError,
  getProjectManagementProvider,
  type RegisteredProvider,
} from "./provider-registry.js";
