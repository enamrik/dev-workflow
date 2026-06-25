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
  constructor(private readonly cwd?: string) {}

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
        args.push("--json", "number,title,url,state,isDraft,headRefName,baseRefName");

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

        const data = JSON.parse(result.stdout) as {
          number: number;
          title: string;
          url: string;
          state: string;
          isDraft: boolean;
          headRefName: string;
          baseRefName: string;
        };

        return {
          number: data.number,
          title: data.title,
          url: data.url,
          state: data.state as "OPEN" | "CLOSED" | "MERGED",
          merged: data.state === "MERGED",
          isDraft: data.isDraft,
          headBranch: data.headRefName,
          baseBranch: data.baseRefName,
        };
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
    return Effect.promise(
      () =>
        new Promise<GitHubCLIResult>((resolve) => {
          const proc = spawn("gh", args, {
            cwd,
            shell: true,
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
