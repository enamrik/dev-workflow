/**
 * Container Builder Utilities
 *
 * Provides a typed wrapper around Awilix for building DI containers
 * with clear singleton/scoped/transient semantics and support for
 * testing via scoped containers.
 */

import {
  createContainer,
  asClass,
  asFunction,
  asValue,
  InjectionMode,
  type AwilixContainer,
  type Resolver,
} from "awilix";

/**
 * A class constructor type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T> = new (...args: any[]) => T;

/**
 * Lifetime scopes for container registrations
 */
export type Lifetime = "singleton" | "scoped" | "transient";

/**
 * A registration entry for the container builder
 */
interface Registration<T> {
  resolver: Resolver<T>;
  lifetime: Lifetime;
}

/**
 * ContainerBuilder provides a typed, fluent API for building Awilix containers.
 *
 * Features:
 * - Type-safe registration with TypeScript inference
 * - Clear singleton/scoped/transient semantics
 * - Support for createScope() to clone containers for testing
 * - Compatible with Awilix's CLASSIC injection mode
 *
 * @example
 * ```typescript
 * // Define your cradle type (what's available for injection)
 * interface AppCradle {
 *   config: AppConfig;
 *   dbClient: DbClient;
 *   issueRepository: IssueRepository;
 *   issueService: IssueService;
 * }
 *
 * // Build the container
 * const container = new ContainerBuilder<AppCradle>()
 *   .registerValue('config', appConfig)
 *   .registerSingleton('dbClient', DbClient)
 *   .registerScoped('issueRepository', IssueRepository)
 *   .registerScoped('issueService', IssueService)
 *   .build();
 *
 * // Use the container
 * const service = container.cradle.issueService;
 * ```
 */
export class ContainerBuilder<TCradle extends object = object> {
  private registrations: Map<keyof TCradle, Registration<unknown>> = new Map();

  /**
   * Register a singleton class.
   *
   * Singletons are created once and shared for the lifetime of the container.
   * Use for stateless services, configuration, and shared infrastructure.
   *
   * @param name - The key in the cradle
   * @param Target - The class constructor
   */
  registerSingleton<K extends keyof TCradle>(
    name: K,
    Target: Constructor<TCradle[K]>
  ): ContainerBuilder<TCradle> {
    this.registrations.set(name, {
      resolver: asClass(Target).singleton(),
      lifetime: "singleton",
    });
    return this;
  }

  /**
   * Register a scoped class.
   *
   * Scoped instances are created once per container scope.
   * Use for request-scoped state, database connections, etc.
   *
   * @param name - The key in the cradle
   * @param Target - The class constructor
   */
  registerScoped<K extends keyof TCradle>(
    name: K,
    Target: Constructor<TCradle[K]>
  ): ContainerBuilder<TCradle> {
    this.registrations.set(name, {
      resolver: asClass(Target).scoped(),
      lifetime: "scoped",
    });
    return this;
  }

  /**
   * Register a transient class.
   *
   * Transient instances are created fresh every time they're resolved.
   * Use for stateful objects that shouldn't be shared.
   *
   * @param name - The key in the cradle
   * @param Target - The class constructor
   */
  registerTransient<K extends keyof TCradle>(
    name: K,
    Target: Constructor<TCradle[K]>
  ): ContainerBuilder<TCradle> {
    this.registrations.set(name, {
      resolver: asClass(Target).transient(),
      lifetime: "transient",
    });
    return this;
  }

  /**
   * Register a factory function.
   *
   * Use when you need custom construction logic beyond what asClass provides.
   *
   * @param name - The key in the cradle
   * @param factory - A factory function that receives the cradle and returns the value
   * @param lifetime - The lifetime scope (default: 'scoped')
   */
  registerFactory<K extends keyof TCradle>(
    name: K,
    factory: (cradle: TCradle) => TCradle[K],
    lifetime: Lifetime = "scoped"
  ): ContainerBuilder<TCradle> {
    let resolver = asFunction(factory);
    switch (lifetime) {
      case "singleton":
        resolver = resolver.singleton();
        break;
      case "scoped":
        resolver = resolver.scoped();
        break;
      case "transient":
        resolver = resolver.transient();
        break;
    }
    this.registrations.set(name, { resolver, lifetime });
    return this;
  }

  /**
   * Register a constant value.
   *
   * Values are stored as-is without any resolution or scoping.
   * Use for configuration, constants, and external dependencies.
   *
   * @param name - The key in the cradle
   * @param value - The value to register
   */
  registerValue<K extends keyof TCradle>(name: K, value: TCradle[K]): ContainerBuilder<TCradle> {
    this.registrations.set(name, {
      resolver: asValue(value),
      lifetime: "singleton", // Values are effectively singletons
    });
    return this;
  }

  /**
   * Build the container with all registrations.
   *
   * @returns A configured Awilix container
   */
  build(): AwilixContainer<TCradle> {
    const container = createContainer<TCradle>({
      injectionMode: InjectionMode.CLASSIC,
    });

    // Register each entry individually to maintain type safety
    for (const [name, { resolver }] of this.registrations.entries()) {
      container.register(name as string, resolver);
    }

    return container;
  }
}

/**
 * Creates a test container by cloning a production container and replacing
 * specific dependencies with test implementations.
 *
 * This is the recommended pattern for testing with DI:
 * 1. Start with the production container registrations
 * 2. Create a scope to isolate test state
 * 3. Replace infrastructure with mocks (repositories, external services)
 * 4. Test the handler/service with real business logic, fake infrastructure
 *
 * @example
 * ```typescript
 * // In test file
 * const testContainer = createTestContainer(prodContainer, {
 *   issueRepository: () => mockIssueRepository,
 *   gitHubProvider: () => mockGitHubProvider,
 * });
 *
 * // Test uses real services with mocked infrastructure
 * const result = await handler(mockRequest, testContainer.cradle);
 * expect(result).toMatchObject({ status: 200 });
 * ```
 *
 * @param container - The production container to clone
 * @param overrides - Factory functions for dependencies to replace
 * @returns A scoped container with overrides applied
 */
export function createTestContainer<TCradle extends object>(
  container: AwilixContainer<TCradle>,
  overrides: Partial<{ [K in keyof TCradle]: () => TCradle[K] }>
): AwilixContainer<TCradle> {
  const scope = container.createScope();

  // Register overrides in the scope individually
  for (const [name, factory] of Object.entries(overrides)) {
    if (factory) {
      scope.register(name, asFunction(factory as () => unknown).scoped());
    }
  }

  return scope;
}

// Re-export Awilix types and utilities that consumers will need
export {
  createContainer,
  asClass,
  asFunction,
  asValue,
  InjectionMode,
  type AwilixContainer,
  type Resolver,
};
