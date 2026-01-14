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
  // Handler/runner factories
  createCliHandler,
  createCliRunner,
  // Error handling
  handleCliError,
  CliValidationError,
  // Middleware
  composeMiddleware,
  defaultMiddleware,
  registerWorkingDirectory,
  registerPackageRoot,
  // Types
  type CliHandler,
  type WrappedCliHandler,
  type CliRunner,
  type ContainerMiddleware,
} from "./bootstrap.js";
