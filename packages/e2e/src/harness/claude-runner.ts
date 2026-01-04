/**
 * Claude CLI Runner
 *
 * TypeScript wrapper for running claude CLI commands.
 * Streams output to test stdout for visibility during test runs.
 */

import { spawn, type SpawnOptions } from "node:child_process";

export interface ClaudeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ClaudeOptions {
  /** Working directory for the command */
  cwd: string;
  /** List of allowed MCP tools (e.g., ["mcp__dev-workflow-tracker__create_issue"]) */
  allowedTools?: string[];
  /** Path to MCP config file or JSON string to load MCP servers from */
  mcpConfig?: string;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Stream output to test stdout (default: true) */
  streamOutput?: boolean;
  /** Additional environment variables */
  env?: Record<string, string>;
}

/**
 * Run claude CLI with a prompt, optionally streaming output to test stdout
 */
export async function runClaude(prompt: string, options: ClaudeOptions): Promise<ClaudeResult> {
  const args = ["--print", prompt];
  const streamOutput = options.streamOutput ?? true;
  const timeout = options.timeout ?? 60000;

  if (options.mcpConfig) {
    args.push("--mcp-config", options.mcpConfig);
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }

  return new Promise((resolve, reject) => {
    const truncatedPrompt = prompt.length > 50 ? `${prompt.slice(0, 50)}...` : prompt;
    console.log(`\n🤖 Running claude: "${truncatedPrompt}"\n`);

    const spawnOptions: SpawnOptions = {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    };

    console.log(`📍 cwd: ${options.cwd}`);
    console.log(`📍 args: claude ${args.join(" ")}`);

    const proc = spawn("claude", args, spawnOptions);

    // Close stdin immediately to signal no more input
    proc.stdin?.end();

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      console.log(`\n⏰ Claude process timed out after ${timeout}ms\n`);
    }, timeout);

    proc.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      if (streamOutput) {
        // Use console.log for vitest compatibility (process.stdout.write doesn't show in forks)
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.trim()) console.log(line);
        }
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      if (streamOutput) {
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.trim()) console.error(line);
        }
      }
    });

    proc.on("close", (code: number | null) => {
      clearTimeout(timeoutId);
      const exitCode = code ?? (timedOut ? 124 : 1);
      console.log(`\n✓ Claude exited with code ${exitCode}\n`);
      resolve({ stdout, stderr, exitCode });
    });

    proc.on("error", (error: Error) => {
      clearTimeout(timeoutId);
      console.log(`\n❌ Claude process error: ${error.message}\n`);
      reject(error);
    });
  });
}

/**
 * Check if claude CLI is available
 */
export async function isClaudeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], { stdio: "pipe" });

    proc.on("close", (code) => {
      resolve(code === 0);
    });

    proc.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Run a simple claude command and check for success
 */
export async function runClaudeSimple(prompt: string, cwd: string): Promise<boolean> {
  try {
    const result = await runClaude(prompt, {
      cwd,
      streamOutput: true,
      timeout: 30000,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
