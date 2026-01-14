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
  createCommand,
  createCommandHandler,
  handleCliError,
  CliValidationError,
  compose,
  registerWorkingDirectory,
  registerPackageRoot,
  defaultMiddleware,
  type CliHandler,
  type CliMiddleware,
  type CliCommand,
} from "./bootstrap.js";
