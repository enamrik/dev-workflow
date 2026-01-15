/**
 * CLI Dependency Injection
 *
 * Exports for Awilix-based DI in CLI commands.
 */

// Container factory and types
export { createCliContainer, type CliCradle, type CliContainer } from "./container.js";

// React context provider and hooks (for Ink commands)
export {
  DIContainerProvider,
  useContainer,
  useDeps,
  type DIContainerProviderProps,
} from "./context.js";

// Bootstrap functions for command handlers
export {
  // Handler/command factories
  createCliHandler,
  createCliCommand,
  // Test helper
  createTestCliCommand,
  // Error handling
  handleCliError,
  CliValidationError,
  // Middleware
  composeMiddleware,
  defaultMiddleware,
  registerWorkingDirectory,
  registerPackageRoot,
  // Config middleware (for commands needing project config)
  resolveConfigMiddleware,
  withConfigMiddleware,
  resolveResolverMiddleware,
  withResolverMiddleware,
  // Types
  type CliHandler,
  type WrappedCliHandler,
  type CliCommand,
  type ContainerMiddleware,
} from "./bootstrap.js";
