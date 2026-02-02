/**
 * GitHub CLI wrapper for interacting with GitHub via the `gh` CLI
 *
 * Uses the gh CLI for all GitHub operations. This approach:
 * - Leverages existing user authentication (no token management)
 * - Provides consistent interface across operations
 * - Is easy to mock for testing
 */

import { spawn } from "node:child_process";
import { Effect, Service } from "@dev-workflow/effect";
import type { GitHubPRData, GitHubMergeStrategy } from "./github.js";
export type { GitHubPRData, GitHubMergeStrategy } from "./github.js";

/**
 * GitHub issue data returned from gh CLI
 *
 * Internal type for GitHubCLI - mapped to ExternalIssue by the provider.
 */
export interface GitHubIssueData {
  number: number;
  url: string;
  nodeId: string;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  labels: string[];
}

/**
 * Result from a GitHub CLI command
 */
export interface GitHubCLIResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Custom error for GitHub CLI operations
 */
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

/**
 * Interface for GitHub CLI operations
 *
 * Abstracts the gh CLI for testability and follows DIP.
 *
 * Note: Methods no longer require owner/repo parameters - the gh CLI
 * auto-detects the repository from git remotes. This simplifies the API
 * and works correctly in git worktrees.
 *
 * Methods that handle errors internally use Effect<T> (never fail in E channel).
 * Methods that can throw use Effect<T, GitHubCLIError>.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface GitHubCLI {
  checkAuth(): Effect<boolean>;
  checkCurrentRepository(): Effect<boolean>;
  getRepoUrl(): Effect<string | null>;
  createIssue(
    title: string,
    body: string,
    labels: string[]
  ): Effect<GitHubIssueData, GitHubCLIError>;
  updateIssue(
    issueNumber: number,
    title: string,
    body: string,
    labels: string[]
  ): Effect<GitHubIssueData, GitHubCLIError>;
  closeIssue(issueNumber: number): Effect<void, GitHubCLIError>;
  reopenIssue(issueNumber: number): Effect<void, GitHubCLIError>;
  getIssue(issueNumber: number): Effect<GitHubIssueData | null, GitHubCLIError>;
  listLabels(): Effect<string[], GitHubCLIError>;
  createLabel(name: string, color?: string, description?: string): Effect<void, GitHubCLIError>;
  addToProject(projectId: string, issueNodeId: string): Effect<string, GitHubCLIError>;
  checkProject(projectId: string): Effect<boolean>;
  getProjectDetails(projectId: string): Effect<{ id: string; title: string; url: string } | null>;
  createPR(
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string,
    draft?: boolean
  ): Effect<GitHubPRData, GitHubCLIError>;
  mergePR(
    prNumber: number,
    strategy?: GitHubMergeStrategy,
    commitTitle?: string
  ): Effect<GitHubPRData, GitHubCLIError>;
  getPR(prNumber: number): Effect<GitHubPRData | null, GitHubCLIError>;
  findPRByBranch(headBranch: string): Effect<GitHubPRData | null, GitHubCLIError>;
  linkSubIssue(parentIssueNumber: number, childIssueId: number): Effect<void, GitHubCLIError>;
  searchIssues(
    query: string,
    state?: "open" | "closed" | "all",
    limit?: number
  ): Effect<GitHubIssueData[], GitHubCLIError>;
  commentOnIssue(issueNumber: number, comment: string): Effect<void, GitHubCLIError>;
  closeIssueWithComment(issueNumber: number, comment?: string): Effect<void, GitHubCLIError>;
  assignIssue(issueNumber: number, assignee: string): Effect<void, GitHubCLIError>;
  run(args: string[]): Effect<GitHubCLIResult>;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class GitHubCLI extends Service<GitHubCLI>()("githubCLI") {}

/** @deprecated Use GitHubCLI directly (it is now both interface and service tag via declaration merging) */
export const GitHubCLITag = GitHubCLI;

/**
 * Node.js implementation of GitHubCLI using the gh CLI
 *
 * Requires gh CLI to be installed and authenticated.
 * Auto-detects repository from git remotes - no need to specify owner/repo.
 */
export class NodeGitHubCLI implements GitHubCLI {
  // ===========================================================================
  // Public Effect-returning methods
  // ===========================================================================

  checkAuth(): Effect<boolean> {
    return Effect.promise(() => this._checkAuth());
  }

  checkCurrentRepository(): Effect<boolean> {
    return Effect.promise(() => this._checkCurrentRepository());
  }

  getRepoUrl(): Effect<string | null> {
    return Effect.promise(() => this._getRepoUrl());
  }

  createIssue(
    title: string,
    body: string,
    labels: string[]
  ): Effect<GitHubIssueData, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._createIssue(title, body, labels),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  updateIssue(
    issueNumber: number,
    title: string,
    body: string,
    labels: string[]
  ): Effect<GitHubIssueData, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._updateIssue(issueNumber, title, body, labels),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  closeIssue(issueNumber: number): Effect<void, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._closeIssue(issueNumber),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  reopenIssue(issueNumber: number): Effect<void, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._reopenIssue(issueNumber),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  getIssue(issueNumber: number): Effect<GitHubIssueData | null, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._getIssue(issueNumber),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  listLabels(): Effect<string[], GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._listLabels(),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  createLabel(name: string, color?: string, description?: string): Effect<void, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._createLabel(name, color, description),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  addToProject(projectId: string, issueNodeId: string): Effect<string, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._addToProject(projectId, issueNodeId),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  checkProject(projectId: string): Effect<boolean> {
    return Effect.promise(() => this._checkProject(projectId));
  }

  getProjectDetails(projectId: string): Effect<{ id: string; title: string; url: string } | null> {
    return Effect.promise(() => this._getProjectDetails(projectId));
  }

  createPR(
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string,
    draft?: boolean
  ): Effect<GitHubPRData, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._createPR(headBranch, baseBranch, title, body, draft),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  mergePR(
    prNumber: number,
    strategy?: GitHubMergeStrategy,
    commitTitle?: string
  ): Effect<GitHubPRData, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._mergePR(prNumber, strategy, commitTitle),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  getPR(prNumber: number): Effect<GitHubPRData | null, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._getPR(prNumber),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  findPRByBranch(headBranch: string): Effect<GitHubPRData | null, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._findPRByBranch(headBranch),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  linkSubIssue(parentIssueNumber: number, childIssueId: number): Effect<void, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._linkSubIssue(parentIssueNumber, childIssueId),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  searchIssues(
    query: string,
    state?: "open" | "closed" | "all",
    limit?: number
  ): Effect<GitHubIssueData[], GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._searchIssues(query, state, limit),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  commentOnIssue(issueNumber: number, comment: string): Effect<void, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._commentOnIssue(issueNumber, comment),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  closeIssueWithComment(issueNumber: number, comment?: string): Effect<void, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._closeIssueWithComment(issueNumber, comment),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  assignIssue(issueNumber: number, assignee: string): Effect<void, GitHubCLIError> {
    return Effect.tryPromise({
      try: () => this._assignIssue(issueNumber, assignee),
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  run(args: string[]): Effect<GitHubCLIResult> {
    return Effect.promise(() => this._run(args));
  }

  // ===========================================================================
  // Private async implementations
  // ===========================================================================

  private async _checkAuth(): Promise<boolean> {
    const result = await this._run(["auth", "status", "-h", "github.com"]);
    return result.success;
  }

  private async _checkCurrentRepository(): Promise<boolean> {
    const result = await this._run(["repo", "view", "--json", "name"]);
    return result.success;
  }

  private async _getRepoUrl(): Promise<string | null> {
    const result = await this._run(["repo", "view", "--json", "url"]);
    if (!result.success) {
      return null;
    }
    try {
      const data = JSON.parse(result.stdout) as { url?: string };
      return data.url ?? null;
    } catch {
      return null;
    }
  }

  private async _createIssue(
    title: string,
    body: string,
    labels: string[]
  ): Promise<GitHubIssueData> {
    const args = ["issue", "create", "--title", title, "--body", body];
    for (const label of labels) {
      args.push("--label", label);
    }
    const result = await this._run(args);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to create issue: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
    const url = result.stdout.trim();
    const match = url.match(/\/issues\/(\d+)$/);
    if (!match) {
      throw new GitHubCLIError(`Failed to parse issue number from URL: ${url}`, 0, "");
    }
    const issueNumber = parseInt(match[1], 10);
    const issue = await this._getIssue(issueNumber);
    if (!issue) {
      throw new GitHubCLIError(`Failed to fetch created issue: ${issueNumber}`, 0, "");
    }
    return issue;
  }

  private async _updateIssue(
    issueNumber: number,
    title: string,
    body: string,
    labels: string[]
  ): Promise<GitHubIssueData> {
    const editArgs = ["issue", "edit", String(issueNumber), "--title", title, "--body", body];
    const editResult = await this._run(editArgs);
    if (!editResult.success) {
      throw new GitHubCLIError(
        `Failed to update issue: ${editResult.stderr}`,
        editResult.exitCode,
        editResult.stderr
      );
    }
    if (labels.length > 0) {
      const current = await this._getIssue(issueNumber);
      const currentLabels = current?.labels ?? [];
      for (const label of currentLabels) {
        if (!labels.includes(label)) {
          await this._run(["issue", "edit", String(issueNumber), "--remove-label", label]);
        }
      }
      for (const label of labels) {
        if (!currentLabels.includes(label)) {
          await this._run(["issue", "edit", String(issueNumber), "--add-label", label]);
        }
      }
    }
    const issue = await this._getIssue(issueNumber);
    if (!issue) {
      throw new GitHubCLIError("Issue not found after update");
    }
    return issue;
  }

  private async _closeIssue(issueNumber: number): Promise<void> {
    const result = await this._run(["issue", "close", String(issueNumber)]);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to close issue: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
  }

  private async _reopenIssue(issueNumber: number): Promise<void> {
    const result = await this._run(["issue", "reopen", String(issueNumber)]);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to reopen issue: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
  }

  private async _getIssue(issueNumber: number): Promise<GitHubIssueData | null> {
    const result = await this._run([
      "issue",
      "view",
      String(issueNumber),
      "--json",
      "number,url,id,title,body,state,labels",
    ]);
    if (!result.success) {
      if (result.stderr.includes("not found")) {
        return null;
      }
      throw new GitHubCLIError(
        `Failed to get issue: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
    const data = JSON.parse(result.stdout) as Record<string, unknown>;
    return this.mapIssueData(data);
  }

  private async _listLabels(): Promise<string[]> {
    const result = await this._run(["label", "list", "--json", "name"]);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to list labels: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
    const labels = JSON.parse(result.stdout) as Array<{ name: string }>;
    return labels.map((l) => l.name);
  }

  private async _createLabel(name: string, color?: string, description?: string): Promise<void> {
    const args = ["label", "create", name];
    if (color) {
      args.push("--color", color);
    }
    if (description) {
      args.push("--description", description);
    }
    const result = await this._run(args);
    if (!result.success && !result.stderr.includes("already exists")) {
      throw new GitHubCLIError(
        `Failed to create label: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
  }

  private async _addToProject(projectId: string, issueNodeId: string): Promise<string> {
    const mutation = `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: {
          projectId: $projectId
          contentId: $contentId
        }) {
          item {
            id
          }
        }
      }
    `;
    const result = await this._run([
      "api",
      "graphql",
      "-f",
      `query=${mutation}`,
      "-f",
      `projectId=${projectId}`,
      "-f",
      `contentId=${issueNodeId}`,
    ]);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to add to project: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
    const data = JSON.parse(result.stdout) as {
      data: { addProjectV2ItemById: { item: { id: string } } };
    };
    return data.data.addProjectV2ItemById.item.id;
  }

  private async _checkProject(projectId: string): Promise<boolean> {
    const details = await this._getProjectDetails(projectId);
    return details !== null;
  }

  private async _getProjectDetails(
    projectId: string
  ): Promise<{ id: string; title: string; url: string } | null> {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            id
            title
            url
          }
        }
      }
    `;
    const result = await this._run([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `projectId=${projectId}`,
    ]);
    if (!result.success) {
      return null;
    }
    try {
      const data = JSON.parse(result.stdout) as {
        data?: { node?: { id?: string; title?: string; url?: string } };
      };
      const node = data.data?.node;
      if (node?.id && node?.title && node?.url) {
        return { id: node.id, title: node.title, url: node.url };
      }
      return null;
    } catch {
      return null;
    }
  }

  private async _createPR(
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string,
    draft = false
  ): Promise<GitHubPRData> {
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
    const result = await this._run(args);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to create PR: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
    const urlMatch = result.stdout.trim().match(/\/pull\/(\d+)/);
    if (!urlMatch) {
      throw new GitHubCLIError(`Failed to parse PR URL from output: ${result.stdout}`);
    }
    const prNumber = parseInt(urlMatch[1], 10);
    const pr = await this._getPR(prNumber);
    if (!pr) {
      throw new GitHubCLIError("PR not found after creation");
    }
    return pr;
  }

  private async _mergePR(
    prNumber: number,
    strategy: GitHubMergeStrategy = "squash",
    commitTitle?: string
  ): Promise<GitHubPRData> {
    const args = ["pr", "merge", String(prNumber), `--${strategy}`];
    if (commitTitle) {
      args.push("--subject", commitTitle);
    }
    const result = await this._run(args);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to merge PR: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
    const pr = await this._getPR(prNumber);
    if (!pr) {
      throw new GitHubCLIError("PR not found after merge");
    }
    return pr;
  }

  private async _getPR(prNumber: number): Promise<GitHubPRData | null> {
    const result = await this._run([
      "pr",
      "view",
      String(prNumber),
      "--json",
      "number,url,id,title,body,state,isDraft,headRefName,baseRefName,mergedAt,mergeable",
    ]);
    if (!result.success) {
      if (result.stderr.includes("not found") || result.stderr.includes("Could not resolve")) {
        return null;
      }
      throw new GitHubCLIError(
        `Failed to get PR: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
    const data = JSON.parse(result.stdout) as Record<string, unknown>;
    return this.mapPRData(data);
  }

  private async _findPRByBranch(headBranch: string): Promise<GitHubPRData | null> {
    const result = await this._run([
      "pr",
      "list",
      "--head",
      headBranch,
      "--state",
      "all",
      "--json",
      "number,url,id,title,body,state,isDraft,headRefName,baseRefName,mergedAt,mergeable",
      "--limit",
      "1",
    ]);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to find PR by branch: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
    const prs = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    if (prs.length === 0) {
      return null;
    }
    return this.mapPRData(prs[0]);
  }

  private async _linkSubIssue(parentIssueNumber: number, childIssueId: number): Promise<void> {
    const result = await this._run([
      "api",
      `repos/{owner}/{repo}/issues/${parentIssueNumber}/sub_issues`,
      "-X",
      "POST",
      "-f",
      `sub_issue_id=${childIssueId}`,
    ]);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to link sub-issue: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
  }

  private async _searchIssues(
    query: string,
    state: "open" | "closed" | "all" = "all",
    limit = 10
  ): Promise<GitHubIssueData[]> {
    const args = [
      "issue",
      "list",
      "--search",
      query,
      "--state",
      state,
      "--json",
      "number,url,id,title,body,state,labels",
      "--limit",
      String(limit),
    ];
    const result = await this._run(args);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to search issues: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
    const issues = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    return issues.map((data) => this.mapIssueData(data));
  }

  private async _commentOnIssue(issueNumber: number, comment: string): Promise<void> {
    const result = await this._run(["issue", "comment", String(issueNumber), "-b", comment]);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to comment on issue: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
  }

  private async _closeIssueWithComment(issueNumber: number, comment?: string): Promise<void> {
    if (comment) {
      await this._commentOnIssue(issueNumber, comment);
    }
    await this._closeIssue(issueNumber);
  }

  private async _assignIssue(issueNumber: number, assignee: string): Promise<void> {
    const result = await this._run([
      "issue",
      "edit",
      String(issueNumber),
      "--add-assignee",
      assignee,
    ]);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to assign issue: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
  }

  private async _run(args: string[]): Promise<GitHubCLIResult> {
    return new Promise((resolve) => {
      const process = spawn("gh", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      process.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      process.on("error", (err) => {
        resolve({
          success: false,
          stdout: "",
          stderr: `gh CLI not found: ${err.message}. Install from https://cli.github.com`,
          exitCode: 127,
        });
      });

      process.on("close", (code) => {
        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });
    });
  }

  // ===========================================================================
  // Private mapping helpers
  // ===========================================================================

  private mapIssueData(data: Record<string, unknown>): GitHubIssueData {
    const labels = data["labels"] as Array<{ name: string }> | undefined;
    return {
      number: data["number"] as number,
      url: data["url"] as string,
      nodeId: data["id"] as string,
      title: data["title"] as string,
      body: (data["body"] as string) ?? "",
      state: data["state"] as "OPEN" | "CLOSED",
      labels: labels?.map((l) => l.name) ?? [],
    };
  }

  private mapPRData(data: Record<string, unknown>): GitHubPRData {
    const mergedAt = data["mergedAt"] as string | null;
    const isMerged = mergedAt !== null && mergedAt !== undefined;

    let state: GitHubPRData["state"];
    if (isMerged) {
      state = "MERGED";
    } else {
      state = data["state"] as "OPEN" | "CLOSED";
    }

    return {
      number: data["number"] as number,
      url: data["url"] as string,
      nodeId: data["id"] as string,
      title: data["title"] as string,
      body: (data["body"] as string) ?? "",
      state,
      isDraft: (data["isDraft"] as boolean) ?? false,
      headBranch: data["headRefName"] as string,
      baseBranch: data["baseRefName"] as string,
      merged: isMerged,
      mergeable: (data["mergeable"] as GitHubPRData["mergeable"]) ?? "UNKNOWN",
    };
  }
}
