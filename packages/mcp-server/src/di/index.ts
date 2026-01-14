/**
 * MCP Server Dependency Injection
 *
 * Barrel export for DI container and bootstrap utilities.
 */

export { createMcpContainer, createTestScope } from "./container.js";
export type { McpConfig, McpCradle, McpContainer } from "./container.js";

export {
  createTool,
  createToolHandler,
  createFullCradleHandler,
  createNoArgsToolHandler,
} from "./bootstrap.js";
export type {
  ToolHandler,
  DepsSelector,
  WrappedTool,
  DIToolHandler,
  CreateToolOptions,
  NoArgsToolHandler,
} from "./bootstrap.js";
