# Multi-Provider Worker Support

> Research findings and architecture proposal for supporting multiple AI providers as workers in the dispatch queue.

## Executive Summary

The current worker system is tightly coupled to Claude Code. This document researches alternative AI providers (Cursor, Gemini, OpenAI Codex, Windsurf, Amazon Q Developer, Cody) and proposes an architecture for provider-agnostic worker dispatch.

**Key findings:**
- MCP adoption is now universal across major providers (all 6 researched support it)
- OpenAI Codex and Gemini CLI have the closest feature parity with Claude Code
- Headless/CLI execution is available in Claude, Codex, Gemini, Cursor, and Amazon Q
- Skill translation ranges from near-trivial (Codex) to impractical (Windsurf, Cody)
- The primary abstraction needed is a `WorkerProvider` interface that decouples task dispatch from Claude-specific process spawning

**Recommendation:** Implement a `WorkerProvider` abstraction layer, starting with a `ClaudeLocalWorkerProvider` that wraps the existing system. Add Codex and Gemini providers as the first alternatives due to strong MCP support and headless CLI availability.

---

## Table of Contents

- [1. Current Architecture](#1-current-architecture)
- [2. Provider Research](#2-provider-research)
- [3. Provider Comparison Matrix](#3-provider-comparison-matrix)
- [4. Skill Translation Analysis](#4-skill-translation-analysis)
- [5. Proposed Architecture](#5-proposed-architecture)
- [6. Trade-offs and Risks](#6-trade-offs-and-risks)
- [7. Recommendations](#7-recommendations)

---

## 1. Current Architecture

### Claude-Specific Coupling Points

The existing worker system has these assumptions baked in:

| Component | Assumption | Location |
|-----------|-----------|----------|
| Process spawning | `spawn("claude", [prompt])` | `ClaudeWorkerService` |
| Worker ID delivery | Embedded in natural language prompt | `ClaudeWorkerService.buildPrompt()` |
| Execution mode | Workers always use isolated mode (git worktree) | `load_task_session` validation |
| Tool access | Worker has MCP tools via same project config | Claude Code MCP integration |
| Skill system | `.claude/skills/` markdown files drive behavior | `dwf-worker-task` skill |
| Completion signal | `end_worker_session` MCP tool sets `claudeDone` flag | dispatch queue polling |
| Session monitoring | Poll `claudeDone` flag every 2 seconds | `ClaudeWorkerService` |
| File system access | Worker operates in local git worktree | Worktree management |
| Signal handling | SIGINT/SIGTERM for graceful shutdown | Process lifecycle |

### Existing Abstractions

The dispatch system already has some provider-agnostic design:

- **`WorkerQueueDb` interface** (`packages/dispatch/`) - Queue operations are abstracted
- **`ProjectsResolver`** - Project discovery is provider-independent
- **`DataSourceProvider`** - Database access is abstracted
- **Task state machine** - Status transitions are independent of who performs them

What's missing is an abstraction for the **worker execution engine** itself.

---

## 2. Provider Research

### 2.1 Claude Code (Current)

**MCP Support:** Native. Claude Code is the reference implementation for MCP clients. Full support for stdio, SSE, and HTTP transports. Skills system provides structured task instructions.

**Headless/CLI:** Production-ready. `claude` CLI with full tool access, MCP support, and interactive or headless operation.

**Skill System:** `.claude/skills/SKILL.md` files with semantic discovery. Hierarchical `CLAUDE.md` for project context. Skills can be explicitly invoked (slash commands) or implicitly matched by description.

**Worker Suitability:** Excellent. Purpose-built for the current system. Local process with full file system and git access.

### 2.2 OpenAI Codex CLI

**MCP Support:** Native (production). Multiple integration points:
- **Codex CLI:** Supports consuming MCP servers and exposing itself as an MCP server via stdio
- **Responses API:** Hosted MCP tool connects models directly to MCP servers
- **Agents SDK:** `HostedMCPTool` (remote), `MCPServerStdio` (local), `MCPServerStreamableHttp` (HTTP)

**Headless/CLI:** Production-ready. `codex exec` (alias `codex e`) for non-interactive execution. Outputs structured events to stdout or JSONL. Supports session resumption.

**Execution Modes:**
- `--suggest` - Read-only, shows proposed changes
- `--auto-edit` - Writes within project, asks for external
- `--full-auto` - Read anywhere, run commands with network
- `--yolo` - No approval prompts

**Skill System:** Near 1:1 mapping with Claude Code:
- `AGENTS.md` = `CLAUDE.md` (hierarchical instruction files, 32 KiB limit)
- `.codex/skills/SKILL.md` = `.claude/skills/SKILL.md` (reusable capability bundles)
- Supports both explicit (slash commands, `$skill` mentions) and implicit (description matching) invocation
- `AGENTS.override.md` for precedence control

**Sandboxing:** macOS seatbelt or Linux landlock for security.

**Worker Suitability:** Strong. Closest feature parity with Claude Code. Same skill/instruction file paradigm. MCP support means it can use the same dev-workflow MCP server. Headless mode enables programmatic dispatch.

### 2.3 Gemini CLI

**MCP Support:** Native (production). Broad integration:
- **Gemini CLI:** `gemini mcp add` command. Supports stdio and SSE transports. Config in `~/.gemini/settings.json`
- **Gemini SDKs** (Python, JS): Built-in MCP with automatic tool calling loop
- **Google Cloud:** Fully-managed remote MCP servers for Google services
- **Agent Development Kit (ADK):** Native MCP for agent building

**Headless/CLI:** Production-ready. `--headless` flag produces JSON output (response, statistics, metadata). Free tier: 60 requests/min, 1000 requests/day.

**Built-in Tools:**
- `read_file` / `write_file` - File system operations
- `run_shell_command` - Bash execution (captures stdout, stderr, exit code)
- `web_fetch` / `google_web_search` - Web access

**Skill System:** Partial mapping:
- `GEMINI.md` = `CLAUDE.md` (hierarchical: global -> project -> subdirectory)
- Supports `@file.md` imports for modular instructions
- `/init` auto-generates `GEMINI.md` from project analysis
- No dedicated skills system - instructions must be inlined in `GEMINI.md`

**Approval Modes:** `--yolo` flag enables auto-approval for file writes and shell commands.

**Worker Suitability:** Good. Strong MCP support and headless mode. Main gap is no skills system - the `dwf-worker-task` skill would need to be converted to prompt instructions or a `GEMINI.md` section. Free tier is generous for development use.

### 2.4 Cursor

**MCP Support:** Native (production). Supports stdio, SSE, and Streamable HTTP transports. Configuration via Settings > Features > MCP or `.cursor/mcp.json`. One-click MCP marketplace. Maximum of 40 MCP tools.

**Headless/CLI:** Beta (released August 2025). `cursor auth login` or `CURSOR_API_KEY` for authentication. Non-interactive execution for CI/CD. Background Agent API for programmatic agent management (paid plans).

**Skill System:** Different paradigm:
- `.cursor/rules/*.mdc` files (Project Rules) replace `.cursorrules`
- Rules can be: Always active, Agent Requested, Auto Attached, User Rules
- Also reads `AGENTS.md` files
- Translation requires restructuring into `.mdc` format

**Limitations:** MCP limited to tools only (not resources). May not work over SSH/remote. Background Agent API requires paid plan.

**Worker Suitability:** Moderate. MCP support is solid but the IDE-first architecture is a friction point. Headless CLI is beta. Rule system requires non-trivial translation from skills. Background Agent API is the most promising integration path but requires paid plan.

### 2.5 Windsurf (Codeium)

**MCP Support:** Native (production). Supports stdio, HTTP, and SSE. Configuration via `~/.codeium/windsurf/mcp_config.json` or MCP Marketplace.

**Headless/CLI:** None. IDE-only tool with no terminal-based or headless execution mode.

**Skill System:** Custom Workflows (slash commands) only. No documented equivalent of hierarchical instruction files. Skill translation would be lossy and require manual conversion.

**Worker Suitability:** Poor. No headless mode makes programmatic dispatch impossible with current architecture. Would require a fundamentally different integration approach (IDE extension/plugin that polls the queue).

### 2.6 Amazon Q Developer

**MCP Support:** Native (production). CLI and IDE support. Configuration uses its own JSON MCP config. Users can upgrade to Kiro CLI which retains Q Developer functionality.

**Headless/CLI:** Production-ready. Open source CLI (`aws/amazon-q-developer-cli`). Agentic chat in terminal with file system and shell access.

**Skill System:** No documented equivalent to instruction files or skills. Focus is on AWS service integration.

**Worker Suitability:** Moderate. Good CLI capabilities but no skill system means complex task instructions would need to be embedded entirely in the dispatch prompt. Strong for AWS-focused tasks but general-purpose coding may be weaker.

### 2.7 Sourcegraph Cody

**MCP Support:** Native (Enterprise only). Sourcegraph MCP Server exposes code search and navigation. OAuth support.

**Headless/CLI:** None. IDE-only (VS Code, JetBrains). Cody Free and Pro were discontinued July 2025.

**Worker Suitability:** Poor. Enterprise-only, no headless mode, no skill system. Better suited as a context provider (via MCP server) than as a worker.

---

## 3. Provider Comparison Matrix

| Capability | Claude | Codex | Gemini | Cursor | Windsurf | Amazon Q | Cody |
|---|---|---|---|---|---|---|---|
| **MCP Support** | Native | Native | Native | Native | Native | Native | Enterprise |
| **MCP Transports** | stdio, SSE, HTTP | stdio, SSE, HTTP | stdio, SSE | stdio, SSE, HTTP | stdio, HTTP, SSE | stdio, SSE | SSE |
| **Headless CLI** | Yes | Yes | Yes | Beta | No | Yes | No |
| **File System Access** | Full | Graduated | Full | Full (project) | Full (project) | Full | IDE-scoped |
| **Code Execution** | Shell commands | Sandbox + shell | Shell commands | Terminal | Terminal | Shell | No |
| **Skill System** | `.claude/skills/` | `.codex/skills/` | None (GEMINI.md) | `.cursor/rules/` | Workflows | None | None |
| **Instruction Files** | `CLAUDE.md` | `AGENTS.md` | `GEMINI.md` | `.mdc` + AGENTS.md | None | None | None |
| **Skill Translation** | N/A (baseline) | Near-trivial | Medium | Medium-High | Impractical | Low | Impractical |
| **Open Source CLI** | No | Yes | Yes | No | No | Yes | No |
| **Worker Viability** | Excellent | Strong | Good | Moderate | Poor | Moderate | Poor |

### Viability Tiers

**Tier 1 - Ready for integration:**
- **Claude Code** (current) - Production-proven
- **OpenAI Codex** - Near-identical architecture, skill system maps 1:1

**Tier 2 - Feasible with adaptation:**
- **Gemini CLI** - Strong MCP + headless, skills need inlining
- **Cursor** - Good MCP, headless in beta, different skill paradigm

**Tier 3 - Significant barriers:**
- **Amazon Q Developer** - No skill system, AWS-focused
- **Windsurf** - No headless mode
- **Cody** - Enterprise-only, no headless, IDE-only

---

## 4. Skill Translation Analysis

The `dwf-worker-task` skill is the critical piece that guides worker behavior. Here's how it maps across providers:

### Claude -> Codex (Near-trivial)

| Claude Concept | Codex Equivalent | Notes |
|---|---|---|
| `.claude/skills/dwf-worker-task/SKILL.md` | `.codex/skills/dwf-worker-task/SKILL.md` | Rename directory, adjust tool references |
| `CLAUDE.md` project instructions | `AGENTS.md` project instructions | Rename file, minor formatting changes |
| MCP tool calls | MCP tool calls | Identical - same MCP server |
| `end_worker_session` MCP tool | `end_worker_session` MCP tool | Works via MCP, provider-agnostic |

**Effort:** Rename files, test with Codex CLI. The skill markdown content is largely provider-agnostic since it references MCP tools by name.

### Claude -> Gemini (Medium)

| Claude Concept | Gemini Equivalent | Notes |
|---|---|---|
| `.claude/skills/dwf-worker-task/SKILL.md` | Inline in `GEMINI.md` or prompt | No skills system |
| `CLAUDE.md` project instructions | `GEMINI.md` project instructions | Similar hierarchy, different filename |
| MCP tool calls | MCP tool calls | Works via `gemini mcp add` |
| Skill discovery | N/A | Must be explicit in prompt |

**Effort:** Embed skill content directly in the dispatch prompt or create a `GEMINI.md` section. The MCP tool layer works identically.

### Claude -> Cursor (Medium-High)

| Claude Concept | Cursor Equivalent | Notes |
|---|---|---|
| `.claude/skills/dwf-worker-task/SKILL.md` | `.cursor/rules/dwf-worker-task.mdc` | Different format, activation model |
| `CLAUDE.md` project instructions | `.cursor/rules/project.mdc` or `AGENTS.md` | Cursor reads `AGENTS.md` too |
| MCP tool calls | MCP tool calls | Works, 40-tool limit |
| Skill discovery | Rule activation types | Agent Requested, Auto Attached |

**Effort:** Convert skill to `.mdc` format with YAML frontmatter. Test with Cursor's headless CLI (beta). The Background Agent API may provide better integration than CLI spawning.

---

## 5. Proposed Architecture

### 5.1 WorkerProvider Interface

The core abstraction - decouples task dispatch from execution engine:

```typescript
// packages/dispatch/src/worker-provider.ts

interface WorkerProvider {
  readonly providerId: string;     // "claude-local", "codex-local", "gemini-local"
  readonly displayName: string;    // "Claude Code", "OpenAI Codex", "Gemini CLI"

  // Capability detection
  readonly capabilities: WorkerCapabilities;

  // Lifecycle
  spawnWorker(config: SpawnConfig): Promise<WorkerHandle>;
  buildTaskPrompt(context: TaskDispatchContext): string;
}

interface WorkerCapabilities {
  supportsMcp: boolean;
  supportsIsolatedMode: boolean;   // Git worktrees
  supportsSkills: boolean;         // Native skill system
  headlessMode: "production" | "beta" | "none";
  maxMcpTools?: number;            // e.g., 40 for Cursor
}

interface SpawnConfig {
  workerId: string;
  workerName: string;
  projectConfig: ProjectConfig;
}

interface WorkerHandle {
  readonly pid: number | null;     // null for remote/API workers
  readonly process: ChildProcess | null;

  // Monitoring
  isAlive(): boolean;
  onExit(callback: (code: number | null) => void): void;

  // Control
  terminate(): Promise<void>;
}

interface TaskDispatchContext {
  taskId: string;
  taskNumber: number;
  issueNumber: number;
  workerId: string;
  worktreePath: string;
  branchName: string;
}
```

### 5.2 Prompt Building Strategy

The key insight: **MCP tools are provider-agnostic, but skills are not.**

Three strategies for providers without native skill support:

1. **Inline prompt injection** - Embed the skill content directly in the dispatch prompt. Works for all providers but increases prompt size.

2. **Instruction file generation** - Generate provider-specific instruction files (`AGENTS.md`, `GEMINI.md`, `.cursor/rules/`) at worktree setup time. Each worktree gets the right files for its provider.

3. **MCP-based skill delivery** - Create an MCP tool that returns skill content when called. The dispatch prompt tells the worker to call `get_worker_skill()` first. Provider-agnostic but adds a round-trip.

**Recommended:** Use strategy 2 (instruction file generation) as primary, with strategy 1 (inline prompt) as fallback for providers without instruction file support.

```typescript
// Instruction file mapping
interface InstructionFileMapper {
  // Generate provider-specific instruction files in the worktree
  generateInstructionFiles(
    worktreePath: string,
    provider: WorkerProvider,
    taskContext: TaskDispatchContext
  ): Promise<void>;
}

// Implementation generates the right files:
// Claude:  .claude/skills/dwf-worker-task/SKILL.md + CLAUDE.md
// Codex:   .codex/skills/dwf-worker-task/SKILL.md + AGENTS.md
// Gemini:  GEMINI.md (with skill content inlined)
// Cursor:  .cursor/rules/dwf-worker-task.mdc + AGENTS.md
```

### 5.3 Integration with ClaudeWorkerService

The existing `ClaudeWorkerService` becomes a **generic `WorkerService`** that delegates to a `WorkerProvider`:

```
Current:
  ClaudeWorkerService
    → spawn("claude", [prompt])
    → poll claudeDone
    → SIGTERM on exit

Proposed:
  WorkerService
    → provider.spawnWorker(config)
    → provider.buildTaskPrompt(context)
    → handle.onExit(callback)
    → poll completion flag (unchanged)
    → handle.terminate() on exit
```

The dispatch queue, heartbeat mechanism, and task claiming remain unchanged. Only the spawning and prompt building are abstracted.

### 5.4 Provider Registration

```typescript
// packages/dispatch/src/worker-provider-registry.ts

class WorkerProviderRegistry {
  private providers = new Map<string, WorkerProvider>();

  register(provider: WorkerProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  get(providerId: string): WorkerProvider | undefined {
    return this.providers.get(providerId);
  }

  getDefault(): WorkerProvider {
    // Return first registered provider, or Claude if available
    return this.providers.get("claude-local")
      ?? this.providers.values().next().value;
  }

  listAvailable(): WorkerProvider[] {
    return [...this.providers.values()];
  }
}
```

### 5.5 Configuration

Workers would specify their provider when starting:

```bash
# Current
dev-workflow worker

# Proposed
dev-workflow worker                    # Default (Claude)
dev-workflow worker --provider codex   # Use Codex
dev-workflow worker --provider gemini  # Use Gemini
```

Or configure globally:

```yaml
# .track/config.yaml
workers:
  defaultProvider: claude-local
  providers:
    claude-local:
      enabled: true
    codex-local:
      enabled: true
      binary: codex       # CLI binary name
      autoApprove: true   # --full-auto mode
    gemini-local:
      enabled: true
      binary: gemini
      headless: true
```

### 5.6 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WorkerService                                │
│  (Polling, Heartbeat, Claim, Lifecycle - provider-agnostic)         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ delegates to
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    WorkerProviderRegistry                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Claude       │  │ Codex        │  │ Gemini       │  ...         │
│  │ Provider     │  │ Provider     │  │ Provider     │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
└─────────┼──────────────────┼──────────────────┼─────────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
   spawn("claude",    spawn("codex",    spawn("gemini",
     [prompt])          ["exec",          ["--headless",
                         prompt])          prompt])
          │                  │                  │
          ▼                  ▼                  ▼
   ┌─────────────────────────────────────────────────┐
   │              MCP Server (shared)                 │
   │  dispatch_task, load_task_session,               │
   │  end_worker_session, etc.                        │
   └─────────────────────────────────────────────────┘
```

All providers interact with the **same MCP server** and **same dispatch queue**. The only differences are:
1. How the worker process is spawned
2. How the task prompt is formatted
3. How instruction/skill files are generated

---

## 6. Trade-offs and Risks

### 6.1 Abstraction Overhead vs. Simplicity

**Risk:** The `WorkerProvider` abstraction adds complexity before there's a concrete second provider.

**Mitigation:** Start by extracting the existing Claude-specific code into a `ClaudeLocalWorkerProvider` without changing behavior. This is a refactor, not a feature. The interface emerges from the extraction.

### 6.2 Prompt Compatibility

**Risk:** Different models interpret the same prompt differently. The `dwf-worker-task` skill is optimized for Claude's behavior patterns.

**Mitigation:** Provider-specific prompt templates. The `buildTaskPrompt()` method allows each provider to format instructions optimally for its model. Common MCP tool names remain the same.

### 6.3 Capability Gaps

**Risk:** Some providers may not support all workflow features (e.g., git worktrees, PR creation via `gh` CLI).

**Mitigation:** The `WorkerCapabilities` interface enables capability-based task routing. Tasks requiring specific features (isolated worktrees, GitHub integration) can be routed to capable providers.

### 6.4 MCP Tool Limits

**Risk:** Cursor limits MCP tools to 40. The dev-workflow MCP server exposes many tools.

**Mitigation:** Create a minimal MCP tool set for workers that only includes dispatch-relevant tools. Workers don't need all 40+ tools - they need ~15 core tools.

### 6.5 Quality Variance

**Risk:** Different models produce different quality code. A task completed by Gemini may differ significantly from one completed by Claude.

**Mitigation:** Acceptance criteria and automated validation (tests, linting, type checking) are provider-agnostic. The PR review process catches quality issues regardless of which model wrote the code.

### 6.6 Authentication and Cost

**Risk:** Each provider has different authentication mechanisms and pricing models.

**Mitigation:** Provider configuration handles auth (API keys, CLI login). Cost tracking could be added per-provider to help users optimize spend.

---

## 7. Recommendations

### Phase 1: Extract Abstraction (No new providers)

**Goal:** Refactor `ClaudeWorkerService` to use the `WorkerProvider` interface without adding new providers.

**Steps:**
1. Define `WorkerProvider`, `WorkerCapabilities`, `WorkerHandle` interfaces
2. Extract `ClaudeLocalWorkerProvider` from `ClaudeWorkerService`
3. Rename `ClaudeWorkerService` to `WorkerService` (generic)
4. Inject `WorkerProvider` via constructor
5. All existing tests pass without modification

**Outcome:** Clean separation of generic worker lifecycle from Claude-specific execution.

### Phase 2: Add Codex Provider

**Goal:** Support OpenAI Codex CLI as a second worker provider.

**Why Codex first:**
- Near-identical skill system (`.codex/skills/` maps 1:1)
- Production headless CLI (`codex exec`)
- Full MCP support (same MCP server works)
- Open source CLI (inspectable, debuggable)
- Strong sandboxing (macOS seatbelt, Linux landlock)

**Steps:**
1. Implement `CodexLocalWorkerProvider`
2. Create instruction file mapper (CLAUDE.md -> AGENTS.md, skills -> .codex/skills/)
3. Add `--provider` flag to `dev-workflow worker` command
4. Test full lifecycle: dispatch -> claim -> execute -> PR -> complete

### Phase 3: Add Gemini Provider

**Goal:** Support Gemini CLI as a third provider.

**Why Gemini third:**
- Strong MCP support and headless mode
- Free tier is generous for development
- No native skill system requires prompt inlining
- Different from Codex (validates the abstraction handles variety)

**Steps:**
1. Implement `GeminiLocalWorkerProvider`
2. Create prompt builder that inlines skill content
3. Handle Gemini-specific approval flags (`--yolo`)
4. Test full lifecycle

### Future Considerations

- **Remote/cloud workers** - The `WorkerHandle` interface supports `pid: null` for API-based workers
- **Task routing** - Route tasks to providers based on capabilities, cost, or availability
- **Mixed-provider teams** - Multiple provider workers polling the same queue simultaneously
- **Provider-specific optimizations** - Some providers may excel at certain task types
- **Cost tracking** - Per-provider usage metrics to optimize spend
