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
import { resolveConfigFromGit, ProjectConfigError } from "@dev-workflow/tracking";

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
// Project Resolution
// =============================================================================
//
// The server is registered ONCE globally (`claude mcp add --scope user`). It figures out
// which project it's serving from its working directory — Claude Code spawns one stdio server
// per session with cwd = that session's project dir — so a single registration covers every
// project.
//
// An explicit DWF_PROJECT_SLUG overrides cwd resolution (used by the E2E harness and any
// pinned registration).
//
// Other env:
// - DWF_HOME: override dwf's data root (for sandboxed/isolated runs)
// =============================================================================

/**
 * Resolve the project slug: DWF_PROJECT_SLUG wins, otherwise resolve from the working
 * directory's git root (the `.git`-stored slug). Throws ProjectConfigError if cwd isn't a
 * registered dev-workflow project.
 */
async function resolveProjectSlug(): Promise<string> {
  const explicit = process.env["DWF_PROJECT_SLUG"];
  if (explicit) {
    return explicit;
  }
  const config = await resolveConfigFromGit(process.cwd());
  return config.slug;
}

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
  // Resolve which project this server is serving (cwd-based unless pinned via env).
  let slug: string;
  try {
    slug = await resolveProjectSlug();
  } catch (error) {
    const code = error instanceof ProjectConfigError ? error.code : undefined;
    if (code === "NOT_GIT_REPO") {
      console.error(`Error: not a git repository (${process.cwd()}).`);
    } else if (code === "WORKTREE_DETECTED") {
      console.error(`Error: cannot serve from a git worktree (${process.cwd()}).`);
    } else {
      console.error(`Error: not a dev-workflow project (${process.cwd()}).`);
    }
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run 'dwf init' in your project's main repository to register it.");
    process.exit(1);
  }

  console.error(`Loading config from slug: ${slug}`);

  try {
    // Create Awilix container - this wires up all dependencies
    container = await createMcpContainer(slug);

    // Create tools registry - binds all handlers to container
    tools = createToolsRegistry(container);
  } catch (error) {
    console.error(`Error: Failed to initialize for slug "${slug}"`);
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run 'dwf init' to create the config file.");
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
