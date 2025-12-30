import { exec } from "child_process";
import { promisify } from "util";
import type { HookResult, HookContext } from "../domain/hook-config.js";

const execAsync = promisify(exec);

/**
 * HookExecutor interface for executing lifecycle hooks
 *
 * Executes shell commands with timeout support, environment variables,
 * and structured result reporting.
 */
export interface HookExecutor {
  /**
   * Execute a list of hooks sequentially
   *
   * Stops on first failure. Returns results for all executed hooks.
   *
   * @param hooks - Array of shell commands to execute
   * @param context - Execution context (working directory, environment, timeout)
   * @returns Array of hook results (stops at first failure)
   */
  executeHooks(hooks: string[], context: HookContext): Promise<HookResult[]>;

  /**
   * Execute a single hook command
   *
   * @param command - Shell command to execute
   * @param context - Execution context
   * @returns Hook execution result with exit code and output
   */
  executeHook(command: string, context: HookContext): Promise<HookResult>;
}

/**
 * Shell-based implementation of HookExecutor
 *
 * Uses Node.js child_process.exec to run shell commands.
 * Supports:
 * - Variable substitution ({{taskId}}, {{taskTitle}})
 * - Working directory specification
 * - Environment variables
 * - Timeout handling
 * - Output capturing (stdout + stderr)
 */
export class ShellHookExecutor implements HookExecutor {
  async executeHooks(
    hooks: string[],
    context: HookContext
  ): Promise<HookResult[]> {
    const results: HookResult[] = [];

    for (const hook of hooks) {
      const result = await this.executeHook(hook, context);
      results.push(result);

      // Stop on first failure
      if (result.exitCode !== 0) {
        break;
      }
    }

    return results;
  }

  async executeHook(
    command: string,
    context: HookContext
  ): Promise<HookResult> {
    const executedAt = new Date().toISOString();

    // Perform variable substitution
    const processedCommand = this.substituteVariables(command, context);

    // Prepare execution options
    const timeout = context.timeout ?? 120000; // Default 2 minutes
    const env = {
      ...process.env,
      ...context.environment,
    };

    try {
      // Execute command with timeout
      const { stdout, stderr } = await execAsync(processedCommand, {
        cwd: context.workingDirectory,
        env,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB buffer
      });

      // Combine stdout and stderr
      const output = this.combineOutput(stdout, stderr);

      return {
        hookStage: "", // Will be set by caller
        command: processedCommand,
        exitCode: 0,
        output: this.truncateOutput(output),
        executedAt,
      };
    } catch (error: any) {
      // Handle execution errors
      const exitCode = error.code ?? 1;
      const stdout = error.stdout ?? "";
      const stderr = error.stderr ?? "";
      const output = this.combineOutput(stdout, stderr);

      // Add error message if available
      const fullOutput = error.message
        ? `${error.message}\n\n${output}`
        : output;

      return {
        hookStage: "",
        command: processedCommand,
        exitCode,
        output: this.truncateOutput(fullOutput),
        executedAt,
      };
    }
  }

  /**
   * Substitute variables in command string
   *
   * Supported variables:
   * - {{taskId}} - Task UUID
   * - {{taskTitle}} - Task title (shell-escaped)
   */
  private substituteVariables(
    command: string,
    context: HookContext
  ): string {
    return command
      .replace(/\{\{taskId\}\}/g, context.taskId)
      .replace(/\{\{taskTitle\}\}/g, this.escapeShellArg(context.taskTitle));
  }

  /**
   * Escape shell argument for safe substitution
   *
   * Wraps in single quotes and escapes any single quotes in the value.
   */
  private escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Combine stdout and stderr into single output string
   */
  private combineOutput(stdout: string, stderr: string): string {
    const parts: string[] = [];

    if (stdout.trim()) {
      parts.push(stdout.trim());
    }

    if (stderr.trim()) {
      parts.push(`STDERR:\n${stderr.trim()}`);
    }

    return parts.join("\n\n");
  }

  /**
   * Truncate output to reasonable length
   *
   * Keeps first 5000 characters and last 1000 characters if output is too long.
   */
  private truncateOutput(output: string, maxLength: number = 10000): string {
    if (output.length <= maxLength) {
      return output;
    }

    const headLength = 5000;
    const tailLength = 1000;
    const head = output.substring(0, headLength);
    const tail = output.substring(output.length - tailLength);

    return `${head}\n\n... [truncated ${output.length - headLength - tailLength} characters] ...\n\n${tail}`;
  }
}
