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

// Import project resolution + server-level control state
import { resolveConfigFromGit, ProjectConfigError } from "@dev-workflow/tracking";
import { ServerControl } from "./server-control.js";

// Import tool definitions and registry
import {
  controlToolDefinitions,
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

// Server-level control state: owns the active project, the cwd-resolved project
// (the mismatch signal), the per-slug container/registry cache, and the live
// tools registry the dispatcher serves. Starts degraded so a tool call that
// arrives before main() resolves the project gets a clean error, not a crash.
const serverControl = new ServerControl();

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
    ...controlToolDefinitions,
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

  // Server-level control tools run FIRST so they work even when the per-project
  // registry is degraded — they are the escape hatch for switching/inspecting
  // the active project from any directory.
  if (serverControl.isControlTool(name)) {
    return serverControl.handleControlTool(name, args ?? {});
  }

  // Hot dispatch path (unchanged): look up the bound handler for the active project.
  const tool = serverControl.tools[name];
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

  // Compute the cwd-resolved project ONCE — the "where you physically are" signal
  // that powers the cross-project guard. Independent of the active project below
  // (which may be pinned via DFL_PROJECT_SLUG), so a pinned server still reports an
  // honest cwd-vs-active mismatch.
  await serverControl.resolveCwdSlug(process.cwd());

  // Resolve which project this server serves at startup (cwd-based unless pinned via env).
  let slug: string;
  try {
    slug = await resolveProjectSlug();
  } catch (error) {
    const reason = degradeReason(error);
    console.error(reason);
    serverControl.degrade(reason);
    return; // stay connected + degraded
  }

  console.error(`Loading config from slug: ${slug}`);

  try {
    // Build (or reuse) the project's container + registry and make it active.
    await serverControl.setActiveProject(slug);
  } catch (error) {
    const reason = `Failed to initialize for project "${slug}": ${
      error instanceof Error ? error.message : String(error)
    }. Run 'dfl init' to (re)create its config.`;
    console.error(reason);
    serverControl.degrade(reason);
    return; // stay connected + degraded
  }

  console.error(`Active project: ${slug}`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

// Cleanup on exit — close all DB connections opened across selected projects.
process.on("SIGINT", () => {
  serverControl.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  serverControl.close();
  process.exit(0);
});
