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
import {
  createToolsRegistry,
  createDegradedToolsRegistry,
  type ToolsRegistry,
} from "./tools/tools-registry.js";

// =============================================================================
// Project Resolution
// =============================================================================
//
// The server is registered ONCE globally (`claude mcp add --scope user`). It figures out
// which project it's serving from its working directory — Claude Code spawns one stdio server
// per session with cwd = that session's project dir — so a single registration covers every
// project.
//
// An explicit DFL_PROJECT_SLUG overrides cwd resolution (used by the E2E harness and any
// pinned registration).
//
// Other env:
// - DFL_HOME: override dfl's data root (for sandboxed/isolated runs)
// =============================================================================

/**
 * Resolve the project slug: DFL_PROJECT_SLUG wins, otherwise resolve from the working
 * directory's git root (the `.git`-stored slug). Throws ProjectConfigError if cwd isn't a
 * registered dev-workflow project.
 */
async function resolveProjectSlug(): Promise<string> {
  const explicit = process.env["DFL_PROJECT_SLUG"];
  if (explicit) {
    return explicit;
  }
  const config = await resolveConfigFromGit(process.cwd());
  return config.slug;
}

// Awilix container and tools registry (initialized in main).
// `tools` starts as a degraded registry so a tool call that arrives before main()
// finishes resolving the project (or when there is no project) gets a clean error
// rather than crashing on an undefined handler.
let container: McpContainer;
let tools: ToolsRegistry = createDegradedToolsRegistry(
  "dev-workflow MCP server is still starting up; retry in a moment."
);

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
 * Build the user-facing reason a directory can't be served, mirroring the
 * ProjectConfigError cases. Surfaced via the degraded registry's tool errors (#45).
 */
function degradeReason(error: unknown): string {
  const cwd = process.cwd();
  const code = error instanceof ProjectConfigError ? error.code : undefined;
  if (code === "NOT_GIT_REPO") {
    return `This directory is not a git repository (${cwd}). Run 'dfl init' in your project's main repository to register it.`;
  }
  if (code === "WORKTREE_DETECTED") {
    return `This worktree's main repository is not a dev-workflow project (${cwd}). Run 'dfl init' in the main repository to register it.`;
  }
  return `This directory isn't a dev-workflow project (${cwd}). Run 'dfl init' in the main repository to register it.`;
}

/**
 * Initialize all services and start the server.
 *
 * The transport connects FIRST so the MCP handshake always completes — even in a
 * directory that isn't a dev-workflow project. If we can't resolve a project (or
 * build its container) we serve a DEGRADED registry whose tools return a clean
 * "run dfl init" error, rather than exiting on startup (which Claude Code surfaces
 * as -32000, with nothing to reconnect to). See #45.
 */
async function main() {
  // Connect first — never let project resolution gate the MCP handshake.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dev-workflow MCP server running on stdio");

  // Resolve which project this server is serving (cwd-based unless pinned via env).
  let slug: string;
  try {
    slug = await resolveProjectSlug();
  } catch (error) {
    const reason = degradeReason(error);
    console.error(reason);
    tools = createDegradedToolsRegistry(reason);
    return; // stay connected + degraded
  }

  console.error(`Loading config from slug: ${slug}`);

  try {
    // Create Awilix container - this wires up all dependencies
    container = await createMcpContainer(slug);
    // Create tools registry - binds all handlers to container
    tools = createToolsRegistry(container);
  } catch (error) {
    const reason = `Failed to initialize for project "${slug}": ${
      error instanceof Error ? error.message : String(error)
    }. Run 'dfl init' to (re)create its config.`;
    console.error(reason);
    tools = createDegradedToolsRegistry(reason);
    return; // stay connected + degraded
  }

  const cradle = container.cradle;
  console.error(`Project: ${cradle.project.name} (${cradle.project.id.slice(0, 8)}...)`);
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
