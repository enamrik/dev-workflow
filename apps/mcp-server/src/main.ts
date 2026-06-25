#!/usr/bin/env node

/**
 * dev-workflow MCP Server
 *
 * Model Context Protocol server for issue tracking and task management.
 * Uses Awilix for dependency injection with server-lifetime singleton scope.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Import DI container and types
import { createMcpContainer, type McpContainer } from "./di/container.js";

// Import tool definitions and registry
import {
  issueToolDefinitions,
  planToolDefinitions,
  taskToolDefinitions,
  snapshotToolDefinitions,
  milestoneToolDefinitions,
  worktreeToolDefinitions,
  prToolDefinitions,
  mergeToolDefinitions,
  typeToolDefinitions,
  dispatchToolDefinitions,
} from "./tools/tool-definitions.js";
import { errorResponse } from "./tools/types.js";
import { createToolsRegistry, type ToolsRegistry } from "./tools/tools-registry.js";

// =============================================================================
// Environment Variable Configuration
// =============================================================================
//
// Required environment variables (set by CLI when registering MCP server):
// - PROJECT_SLUG: Project identifier (e.g., "dev-workflow-b9bccf")
// - GIT_ROOT: Absolute path to the git repository root
//
// Optional:
// - TRACK_DIR: Override global track directory (for testing)
// =============================================================================

const PROJECT_SLUG = process.env["PROJECT_SLUG"];

// Awilix container and tools registry (initialized in main)
let container: McpContainer;
let tools: ToolsRegistry;

// Create MCP server
const server = new Server(
  {
    name: "dev-workflow-tracker",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...issueToolDefinitions,
    ...planToolDefinitions,
    ...taskToolDefinitions,
    ...snapshotToolDefinitions,
    ...milestoneToolDefinitions,
    ...worktreeToolDefinitions,
    ...prToolDefinitions,
    ...mergeToolDefinitions,
    ...typeToolDefinitions,
    ...dispatchToolDefinitions,
  ],
}));

// Handle tool calls - dispatch via tools registry
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
  const { name, arguments: args } = request.params;

  const tool = tools[name];
  if (!tool) {
    return errorResponse(`Unknown tool: ${name}`);
  }

  return tool(args ?? {});
});

/**
 * Initialize all services and start the server
 */
async function main() {
  // Validate PROJECT_SLUG
  if (!PROJECT_SLUG) {
    console.error("Error: PROJECT_SLUG environment variable is required.");
    console.error("Run 'dev-workflow init' to set up the project correctly.");
    process.exit(1);
  }

  console.error(`Loading config from slug: ${PROJECT_SLUG}`);

  try {
    // Create Awilix container - this wires up all dependencies
    container = await createMcpContainer(PROJECT_SLUG);

    // Create tools registry - binds all handlers to container
    tools = createToolsRegistry(container);
  } catch (error) {
    console.error(`Error: Failed to initialize for slug "${PROJECT_SLUG}"`);
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run 'dev-workflow init' to create the config file.");
    process.exit(1);
  }

  const cradle = container.cradle;

  // Log startup info
  console.error(`Project: ${cradle.project.name} (${cradle.project.id.slice(0, 8)}...)`);

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dev-workflow MCP server running on stdio");
  console.error(`Database: ${cradle.config.databasePath}`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

// Cleanup on exit
process.on("SIGINT", () => {
  container?.cradle.dbSource.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  container?.cradle.dbSource.close();
  process.exit(0);
});
