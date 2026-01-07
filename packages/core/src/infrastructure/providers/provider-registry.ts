/**
 * ProviderRegistry - Registry for ProjectManagementProvider factories
 *
 * Manages registration and retrieval of provider factories.
 * Enables runtime provider selection without hardcoding specific implementations.
 *
 * Usage:
 *   const registry = ProviderRegistry.getInstance();
 *   const provider = registry.createProvider(project, { githubCLI });
 */

import type { ProviderFactory, ProviderDependencies } from "./provider-factory.js";
import { GitHubProviderFactory } from "./provider-factory.js";
import type { ProjectManagementProvider } from "../../domain/project-management-provider.js";
import type { Project } from "../../domain/project.js";
import { getProviderId } from "../../domain/project-management-config.js";

/**
 * Information about a registered provider
 */
export interface RegisteredProvider {
  /** Provider identifier */
  readonly providerId: string;

  /** Human-readable name */
  readonly displayName: string;

  /** Whether all required dependencies are available */
  available: boolean;

  /** Missing dependencies (if not available) */
  missingDependencies: string[];
}

/**
 * Error thrown when a provider is not found in the registry
 */
export class ProviderNotFoundError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly availableProviders: string[]
  ) {
    super(
      `Provider '${providerId}' not found. Available providers: ${availableProviders.join(", ") || "none"}`
    );
    this.name = "ProviderNotFoundError";
  }
}

/**
 * Error thrown when provider creation fails due to missing dependencies
 */
export class ProviderDependencyError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly missingDependencies: string[]
  ) {
    super(
      `Cannot create provider '${providerId}': missing dependencies: ${missingDependencies.join(", ")}`
    );
    this.name = "ProviderDependencyError";
  }
}

/**
 * Registry for ProjectManagementProvider factories
 *
 * Singleton pattern - use getInstance() to get the shared instance.
 * Pre-registers GitHub provider by default.
 */
export class ProviderRegistry {
  private static instance: ProviderRegistry | null = null;
  private factories: Map<string, ProviderFactory> = new Map();

  /**
   * Private constructor - use getInstance() instead
   */
  private constructor() {
    // Pre-register built-in providers
    this.register(new GitHubProviderFactory());
  }

  /**
   * Get the singleton instance of the registry
   */
  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  static resetInstance(): void {
    ProviderRegistry.instance = null;
  }

  /**
   * Register a provider factory
   *
   * @param factory - The factory to register
   * @throws Error if a factory with the same providerId is already registered
   */
  register(factory: ProviderFactory): void {
    if (this.factories.has(factory.providerId)) {
      throw new Error(`Provider '${factory.providerId}' is already registered`);
    }
    this.factories.set(factory.providerId, factory);
  }

  /**
   * Check if a provider is registered
   *
   * @param providerId - Provider identifier
   * @returns True if registered
   */
  has(providerId: string): boolean {
    return this.factories.has(providerId);
  }

  /**
   * Get a provider factory by ID
   *
   * @param providerId - Provider identifier
   * @returns The provider factory
   * @throws ProviderNotFoundError if not registered
   */
  get(providerId: string): ProviderFactory {
    const factory = this.factories.get(providerId);
    if (!factory) {
      throw new ProviderNotFoundError(providerId, this.listIds());
    }
    return factory;
  }

  /**
   * Get a provider factory by ID, or undefined if not found
   *
   * @param providerId - Provider identifier
   * @returns The provider factory or undefined
   */
  tryGet(providerId: string): ProviderFactory | undefined {
    return this.factories.get(providerId);
  }

  /**
   * List all registered provider IDs
   */
  listIds(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * List all registered providers with availability information
   *
   * @param deps - Available dependencies (to check availability)
   */
  list(deps: ProviderDependencies = {}): RegisteredProvider[] {
    return Array.from(this.factories.values()).map((factory) => ({
      providerId: factory.providerId,
      displayName: factory.displayName,
      available: factory.canCreate(deps),
      missingDependencies: factory.getMissingDependencies(deps),
    }));
  }

  /**
   * Create a provider instance for a project
   *
   * Convenience method that combines get() and createProvider().
   * The factory internally extracts the provider configuration from the project.
   *
   * @param project - The project containing provider configuration
   * @param deps - Provider dependencies
   * @returns A configured provider instance
   * @throws ProviderNotFoundError if provider not registered
   * @throws ProviderDependencyError if required dependencies missing
   */
  createProvider(project: Project, deps: ProviderDependencies): ProjectManagementProvider {
    // Extract provider ID from project's sync config - factory abstracts this detail
    const providerId = getProviderId(project.githubSync);
    const factory = this.get(providerId);

    const missing = factory.getMissingDependencies(deps);
    if (missing.length > 0) {
      throw new ProviderDependencyError(providerId, missing);
    }

    return factory.createProvider(project, deps);
  }
}

/**
 * Convenience function to get a ProjectManagementProvider for a project
 *
 * Uses the singleton ProviderRegistry instance.
 *
 * @param project - The project containing provider configuration
 * @param deps - Provider dependencies
 * @returns A configured provider instance
 * @throws ProviderNotFoundError if provider not registered
 * @throws ProviderDependencyError if required dependencies missing
 */
export function getProjectManagementProvider(
  project: Project,
  deps: ProviderDependencies
): ProjectManagementProvider {
  return ProviderRegistry.getInstance().createProvider(project, deps);
}
