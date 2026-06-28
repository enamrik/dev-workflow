/**
 * GitHub CLI Service for PR operations
 *
 * Wraps `gh` CLI commands for creating and managing pull requests.
 * This is separate from external sync - it's basic GitHub operations
 * needed for the PR workflow.
 */

import { spawn } from "node:child_process";
import { Effect, Service } from "@dev-workflow/effect";

// =============================================================================
// Types
// =============================================================================

export interface PRInfo {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  merged: boolean;
  isDraft: boolean;
  headBranch: string;
  baseBranch: string;
}

export interface GitHubCLIResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

// =============================================================================
// Errors
// =============================================================================

export class GitHubCLIError extends Error {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = "GitHubCLIError";
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract the PR number from a `gh pr create` stdout URL
 * (e.g. "https://github.com/owner/repo/pull/506" -> 506).
 * Returns null when no `/pull/<number>` segment is present.
 */
export function parsePRNumberFromUrl(stdout: string): number | null {
  const match = stdout.match(/\/pull\/(\d+)/);
  return match ? Number(match[1]) : null;
}

// =============================================================================
// Service Interface
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface GitHubCLI {
  /**
   * Check if gh CLI is available and authenticated
   */
  checkAvailable(): Effect<boolean>;

  /**
   * Create a new pull request
   */
  createPR(
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string,
    draft?: boolean
  ): Effect<PRInfo, GitHubCLIError>;

  /**
   * Get a PR by number
   */
  getPR(prNumber: number): Effect<PRInfo | null, GitHubCLIError>;

  /**
   * Find PR by head branch
   */
  findPRByBranch(branchName: string): Effect<PRInfo | null, GitHubCLIError>;

  /**
   * Close an issue by number
   */
  closeIssue(issueNumber: number): Effect<void, GitHubCLIError>;

  /**
   * Run arbitrary gh command
   */
  run(args: string[]): Effect<GitHubCLIResult>;
}

// =============================================================================
// Service Tag
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class GitHubCLI extends Service<GitHubCLI>()("githubCLI") {}

// =============================================================================
// Node Implementation
// =============================================================================

export class NodeGitHubCLI implements GitHubCLI {
  /**
   * @param cwd - Working directory for `gh` invocations.
   * @param githubToken - When set, passed per-command as `GH_TOKEN` so `gh`
   *   acts as this project's configured account without a global
   *   `gh auth switch`. When undefined, `gh` uses the ambient active account.
   */
  constructor(
    private readonly cwd?: string,
    private readonly githubToken?: string
  ) {}

  checkAvailable(): Effect<boolean> {
    return Effect.gen(
      function* (this: NodeGitHubCLI) {
        const result = yield* this.run(["auth", "status"]);
        return result.success;
      }.bind(this)
    );
  }

  createPR(
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string,
    draft = false
  ): Effect<PRInfo, GitHubCLIError> {
    return Effect.gen(
      function* (this: NodeGitHubCLI) {
        const args = [
          "pr",
          "create",
          "--head",
          headBranch,
          "--base",
          baseBranch,
          "--title",
          title,
          "--body",
          body,
        ];
        if (draft) {
          args.push("--draft");
        }

        // `gh pr create` does NOT support --json — it prints the new PR's URL to
        // stdout. We read that URL, then fetch structured metadata with
        // `gh pr view --json` (via getPR) so the PR is recorded on the task.
        const result = yield* this.run(args);
        if (!result.success) {
          return yield* Effect.fail(
            new GitHubCLIError(
              `Failed to create PR: ${result.stderr}`,
              result.exitCode,
              result.stderr
            )
          );
        }

        const prNumber = parsePRNumberFromUrl(result.stdout);
        if (prNumber === null) {
          return yield* Effect.fail(
            new GitHubCLIError(
              `PR created but could not parse its number from gh output: ${result.stdout}`
            )
          );
        }

        const pr = yield* this.getPR(prNumber);
        if (pr === null) {
          return yield* Effect.fail(
            new GitHubCLIError(`PR #${prNumber} created but could not be read back via gh pr view`)
          );
        }
        return pr;
      }.bind(this)
    );
  }

  getPR(prNumber: number): Effect<PRInfo | null, GitHubCLIError> {
    return Effect.gen(
      function* (this: NodeGitHubCLI) {
        const result = yield* this.run([
          "pr",
          "view",
          String(prNumber),
          "--json",
          "number,title,url,state,isDraft,headRefName,baseRefName,mergedAt",
        ]);

        if (!result.success) {
          if (
            result.stderr.includes("no pull requests found") ||
            result.stderr.includes("not found")
          ) {
            return null;
          }
          return yield* Effect.fail(
            new GitHubCLIError(`Failed to get PR: ${result.stderr}`, result.exitCode, result.stderr)
          );
        }

        const data = JSON.parse(result.stdout) as {
          number: number;
          title: string;
          url: string;
          state: string;
          isDraft: boolean;
          headRefName: string;
          baseRefName: string;
          mergedAt: string | null;
        };

        const merged = data.mergedAt !== null;
        const state: PRInfo["state"] = merged ? "MERGED" : (data.state as "OPEN" | "CLOSED");

        return {
          number: data.number,
          title: data.title,
          url: data.url,
          state,
          merged,
          isDraft: data.isDraft,
          headBranch: data.headRefName,
          baseBranch: data.baseRefName,
        } satisfies PRInfo;
      }.bind(this)
    );
  }

  findPRByBranch(branchName: string): Effect<PRInfo | null, GitHubCLIError> {
    return Effect.gen(
      function* (this: NodeGitHubCLI) {
        const result = yield* this.run([
          "pr",
          "list",
          "--head",
          branchName,
          "--json",
          "number,title,url,state,isDraft,headRefName,baseRefName,mergedAt",
          "--limit",
          "1",
        ]);

        if (!result.success) {
          return yield* Effect.fail(
            new GitHubCLIError(
              `Failed to find PR: ${result.stderr}`,
              result.exitCode,
              result.stderr
            )
          );
        }

        const data = JSON.parse(result.stdout) as Array<{
          number: number;
          title: string;
          url: string;
          state: string;
          isDraft: boolean;
          headRefName: string;
          baseRefName: string;
          mergedAt: string | null;
        }>;

        if (data.length === 0) {
          return null;
        }

        const pr = data[0]!;
        const merged = pr.mergedAt !== null;
        const state: PRInfo["state"] = merged ? "MERGED" : (pr.state as "OPEN" | "CLOSED");

        return {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          state,
          merged,
          isDraft: pr.isDraft,
          headBranch: pr.headRefName,
          baseBranch: pr.baseRefName,
        } satisfies PRInfo;
      }.bind(this)
    );
  }

  closeIssue(issueNumber: number): Effect<void, GitHubCLIError> {
    return Effect.gen(
      function* (this: NodeGitHubCLI) {
        const result = yield* this.run(["issue", "close", String(issueNumber)]);
        if (!result.success) {
          return yield* Effect.fail(
            new GitHubCLIError(
              `Failed to close issue: ${result.stderr}`,
              result.exitCode,
              result.stderr
            )
          );
        }
      }.bind(this)
    );
  }

  run(args: string[]): Effect<GitHubCLIResult> {
    const cwd = this.cwd;
    // Spread process.env so PATH (the MCP server injects an absolute PATH so
    // gh/git resolve regardless of launch context) survives; overlay GH_TOKEN
    // only when a per-project identity is configured.
    const env = this.githubToken ? { ...process.env, GH_TOKEN: this.githubToken } : process.env;
    return Effect.promise(
      () =>
        new Promise<GitHubCLIResult>((resolve) => {
          // No `shell: true` — spawn execs gh directly with the argv array, so
          // body/title content (backticks, $, parens, quotes, newlines) is passed
          // verbatim as discrete arguments and is never re-tokenized by a shell.
          // This is the same no-shell pattern NodeGitWorktreeService uses for git.
          const proc = spawn("gh", args, {
            cwd,
            env,
          });

          let stdout = "";
          let stderr = "";

          proc.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
          });

          proc.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });

          proc.on("close", (code) => {
            resolve({
              success: code === 0,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              exitCode: code ?? 1,
            });
          });

          proc.on("error", (err) => {
            resolve({
              success: false,
              stdout,
              stderr: err.message,
              exitCode: 1,
            });
          });
        })
    );
  }
}
