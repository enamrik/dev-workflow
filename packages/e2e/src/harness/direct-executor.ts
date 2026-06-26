/**
 * Direct Tool Executor for E2E Tests
 *
 * Calls MCP tool handlers directly without going through MCP protocol or Claude.
 * This allows testing full flows without API costs.
 *
 * Usage:
 *   const executor = await DirectToolExecutor.create(testDir);
 *   const result = await executor.createIssue({ title: "...", description: "..." });
 *   expect(result.issue.number).toBe(1);
 *   await executor.dispose();
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { createMcpContainer, type McpContainer } from "@dev-workflow/mcp-server/di/container.js";
import {
  createToolsRegistry,
  type ToolsRegistry,
} from "@dev-workflow/mcp-server/tools/tools-registry.js";
import { createTrackDirectoryResolver } from "@dev-workflow/git/track-directory-resolver.js";

export interface ExecutorOptions {
  /** Keep test directory even on success (for debugging) */
  keepOnSuccess?: boolean;
  /** Skip creating sample project files */
  skipSampleProject?: boolean;
}

/**
 * Parsed tool response - extracts JSON from MCP text content
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  raw: unknown;
}

/**
 * Direct executor for MCP tools - no MCP server, no Claude API calls.
 */
export class DirectToolExecutor {
  public readonly testDir: string;
  public readonly trackDir: string;
  public readonly dbPath: string;
  public projectSlug: string = "";
  public projectId: string = "";

  private container: McpContainer | null = null;
  private tools: ToolsRegistry | null = null;
  private cleanupOnSuccess: boolean;

  private constructor(testDir: string, options: ExecutorOptions = {}) {
    this.testDir = testDir;
    this.trackDir = join(testDir, ".track");
    this.dbPath = join(this.trackDir, "workflow.db");
    this.cleanupOnSuccess = !options.keepOnSuccess;
  }

  /**
   * Create a new executor with initialized test environment.
   */
  static async create(options: ExecutorOptions = {}): Promise<DirectToolExecutor> {
    // Create temp directory
    const testDir = realpathSync(mkdtempSync(join(tmpdir(), "dev-workflow-e2e-")));
    const executor = new DirectToolExecutor(testDir, options);

    try {
      await executor.setup(options);
      return executor;
    } catch (error) {
      // Cleanup on setup failure
      executor.forceCleanup();
      throw error;
    }
  }

  /**
   * Set up the test environment: git repo, database, container.
   */
  private async setup(options: ExecutorOptions): Promise<void> {
    // 1. Initialize git repo
    execSync("git init", { cwd: this.testDir, stdio: "pipe" });
    execSync('git config user.email "test@e2e-test.local"', {
      cwd: this.testDir,
      stdio: "pipe",
    });
    execSync('git config user.name "E2E Test"', {
      cwd: this.testDir,
      stdio: "pipe",
    });

    // 2. Create sample project files
    if (!options.skipSampleProject) {
      writeFileSync(join(this.testDir, "README.md"), "# E2E Test Project\n");
      mkdirSync(join(this.testDir, "src"), { recursive: true });
      writeFileSync(
        join(this.testDir, "src/utils.ts"),
        "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n"
      );
    } else {
      writeFileSync(join(this.testDir, "README.md"), "# E2E Test Project\n");
    }

    // 3. Initial commit
    execSync("git add .", { cwd: this.testDir, stdio: "pipe" });
    execSync('git commit -m "Initial commit"', {
      cwd: this.testDir,
      stdio: "pipe",
    });

    // 4. Set up isolated track directory
    mkdirSync(this.trackDir, { recursive: true });
    process.env["DFL_HOME"] = this.trackDir;

    // 5. Compute project slug from git
    const resolver = createTrackDirectoryResolver(this.testDir);
    this.projectSlug = resolver.getProjectId();

    // 6. Run dev-workflow init (creates config, database, etc.)
    // DFL_HOME env var points init to test directory instead of ~/.dfl/track
    const cliPath = join(__dirname, "../../../../apps/cli/dist/main.js");
    execSync(`node ${cliPath} init`, {
      cwd: this.testDir,
      stdio: "pipe",
      env: { ...process.env, DFL_HOME: this.trackDir },
    });

    // 7. Create MCP container and tools registry
    this.container = await createMcpContainer(this.projectSlug);

    // Debug: log cradle keys and check for undefined
    const cradle = this.container.cradle;
    console.log("Cradle keys:", Object.keys(cradle));
    console.log("templateService defined:", cradle.templateService !== undefined);
    console.log("issueDomainService defined:", cradle.issueDomainService !== undefined);

    this.tools = createToolsRegistry(this.container);

    // 8. Store project ID from container
    this.projectId = this.container.cradle.project.id;
  }

  /**
   * Get direct database connection for assertions.
   */
  getDatabase(): Database.Database {
    return new Database(this.dbPath);
  }

  // ===========================================================================
  // Issue Tools
  // ===========================================================================

  async createIssue(args: {
    title: string;
    description: string;
    type?: string;
    priority?: string;
    acceptance_criteria?: string[];
  }): Promise<ToolResult> {
    return this.callTool("create_issue", args);
  }

  async getIssue(args: { issue_number: number }): Promise<ToolResult> {
    // Map issue_number to issueNumber for the tool schema
    return this.callTool("get_issue", { issueNumber: args.issue_number });
  }

  async updateIssue(args: {
    issue_number: number;
    title?: string;
    description?: string;
    type?: string;
    priority?: string;
    acceptance_criteria?: string[];
  }): Promise<ToolResult> {
    const { issue_number, ...updates } = args;
    return this.callTool("update_issue", {
      issueNumber: issue_number,
      updates: {
        title: updates.title,
        description: updates.description,
        type: updates.type,
        priority: updates.priority,
        acceptanceCriteria: updates.acceptance_criteria,
      },
    });
  }

  async closeIssue(args: { issue_number: number; force?: boolean }): Promise<ToolResult> {
    // Map issue_number to issueNumber for the tool schema
    return this.callTool("close_issue", { issueNumber: args.issue_number, force: args.force });
  }

  async deleteIssue(args: { issue_number: number }): Promise<ToolResult> {
    // Map issue_number to issueNumber for the tool schema
    return this.callTool("delete_issue", { issueNumber: args.issue_number });
  }

  async searchIssues(args: { query: string }): Promise<ToolResult> {
    return this.callTool("search_issues", { query: args.query });
  }

  // ===========================================================================
  // Plan Tools
  // ===========================================================================

  async generatePlan(args: {
    issue_number: number;
    summary: string;
    approach: string;
    tasks: Array<{
      id: string;
      title: string;
      description: string;
      type: string;
      acceptanceCriteria?: string[];
    }>;
    estimatedComplexity?: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  }): Promise<ToolResult> {
    return this.callTool("generate_plan", {
      issueNumber: args.issue_number,
      summary: args.summary,
      approach: args.approach,
      tasks: args.tasks,
      estimatedComplexity: args.estimatedComplexity ?? "MEDIUM",
    });
  }

  async getPlan(args: { issue_number: number }): Promise<ToolResult> {
    // Map issue_number to issueNumber for the tool schema
    return this.callTool("get_plan", { issueNumber: args.issue_number });
  }

  async moveIssueToReady(args: { issue_number: number }): Promise<ToolResult> {
    // Map issue_number to issueNumber for the tool schema
    return this.callTool("move_issue_to_ready", { issueNumber: args.issue_number });
  }

  async moveIssueToBacklog(args: { issue_number: number }): Promise<ToolResult> {
    // Map issue_number to issueNumber for the tool schema
    return this.callTool("move_issue_to_backlog", { issueNumber: args.issue_number });
  }

  // ===========================================================================
  // Task Tools
  // ===========================================================================

  async getTask(args: { task_id: string }): Promise<ToolResult> {
    return this.callTool("get_task", { taskId: args.task_id });
  }

  async loadTaskSession(args: { task_id: string; session_id: string }): Promise<ToolResult> {
    return this.callTool("load_task_session", {
      taskId: args.task_id,
      sessionId: args.session_id,
    });
  }

  async abandonTask(args: {
    task_id: string;
    session_id: string;
    reason?: string;
  }): Promise<ToolResult> {
    return this.callTool("abandon_task", {
      taskId: args.task_id,
      sessionId: args.session_id,
      reason: args.reason,
    });
  }

  async completeTask(args: {
    task_id: string;
    session_id: string;
    final_log_entry: string;
    force?: boolean;
    auto_close_issue?: boolean;
  }): Promise<ToolResult> {
    return this.callTool("complete_task", {
      taskId: args.task_id,
      sessionId: args.session_id,
      finalLogEntry: args.final_log_entry,
      force: args.force,
      autoCloseIssue: args.auto_close_issue,
    });
  }

  async listAvailableTasks(args?: Record<string, never>): Promise<ToolResult> {
    return this.callTool("list_available_tasks", args ?? {});
  }

  // ===========================================================================
  // Milestone Tools
  // ===========================================================================

  async createMilestone(args: {
    title: string;
    description?: string;
    due_date?: string;
  }): Promise<ToolResult> {
    return this.callTool("create_milestone", args);
  }

  async listMilestones(): Promise<ToolResult> {
    return this.callTool("list_milestones", {});
  }

  async assignIssueToMilestone(args: {
    issue_number: number;
    milestone_number: number;
  }): Promise<ToolResult> {
    // Map to tool schema parameter names
    return this.callTool("assign_issue_to_milestone", {
      issueNumber: args.issue_number,
      milestoneNumber: args.milestone_number,
    });
  }

  // ===========================================================================
  // Generic Tool Call
  // ===========================================================================

  /**
   * Call any tool by name with arbitrary arguments.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.tools) {
      throw new Error("Executor not initialized. Call create() first.");
    }

    const tool = this.tools[name];
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${name}`,
        raw: null,
      };
    }

    try {
      const response = await tool(args);
      return this.parseResponse(response);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        raw: error,
      };
    }
  }

  /**
   * Parse MCP tool response to extract data.
   */
  private parseResponse(response: unknown): ToolResult {
    // MCP responses have format: { content: [{ type: "text", text: "..." }] }
    const resp = response as { content?: Array<{ type: string; text: string }> };

    if (!resp.content || resp.content.length === 0) {
      return { success: false, error: "Empty response", raw: response };
    }

    const textContent = resp.content.find((c) => c.type === "text");
    if (!textContent) {
      return { success: false, error: "No text content in response", raw: response };
    }

    try {
      const data = JSON.parse(textContent.text);

      // Check for error responses
      if (data.error) {
        return { success: false, error: data.error, data, raw: response };
      }

      return { success: true, data, raw: response };
    } catch {
      // Not JSON - might be plain text response
      return { success: true, data: textContent.text, raw: response };
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Dispose of resources and optionally clean up test directory.
   */
  async dispose(testPassed = true): Promise<void> {
    // Close database connections
    if (this.container) {
      try {
        this.container.cradle.dbSource.close();
      } catch {
        // Ignore close errors
      }
      this.container = null;
      this.tools = null;
    }

    // Clean up test directory
    if (testPassed && this.cleanupOnSuccess) {
      this.forceCleanup();
    } else if (!testPassed) {
      console.log(`\n⚠️ Test failed. Directory preserved: ${this.testDir}`);
    }

    // Reset environment
    delete process.env["DFL_HOME"];
  }

  /**
   * Force cleanup of test directory.
   */
  private forceCleanup(): void {
    try {
      if (existsSync(this.testDir)) {
        rmSync(this.testDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
