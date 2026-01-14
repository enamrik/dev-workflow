/**
 * MCP Server Dependency Injection
 *
 * Barrel export for DI container and handler bootstrap utilities.
 *
 * @example
 * ```typescript
 * import {
 *   createMcpContainer,
 *   initializeContainer,
 *   createMcpHandler,
 *   validateToolArgs,
 *   compose,
 * } from './di';
 *
 * // Initialize container at startup
 * const container = await createMcpContainer(projectSlug);
 * initializeContainer(container);
 *
 * // Define a handler
 * const handleCreateIssue = createMcpHandler(
 *   createIssueHandler,
 *   (cradle) => ({ issueService: cradle.issueService }),
 *   compose(requireProject)
 * );
 * ```
 */

// Container setup
export { createMcpContainer, createTestScope } from "./container.js";
export type { McpConfig, McpCradle, McpContainer } from "./container.js";

// Handler bootstrap
export {
  createMcpHandler,
  createNoArgsHandler,
  validateToolArgs,
  initializeContainer,
  getContainer,
  compose,
} from "./bootstrap.js";
export type { McpHandler, McpMiddleware, McpToolHandler, ValidationResult } from "./bootstrap.js";
