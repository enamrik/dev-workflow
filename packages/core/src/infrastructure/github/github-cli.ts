/**
 * GitHub CLI wrapper for interacting with GitHub via the `gh` CLI
 *
 * Uses the gh CLI for all GitHub operations. This approach:
 * - Leverages existing user authentication (no token management)
 * - Provides consistent interface across operations
 * - Is easy to mock for testing
 */

import { spawn } from "node:child_process";
import type {
  GitHubIssueData,
  GitHubPRData,
  GitHubMergeStrategy,
} from "../../domain/github.js";

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
 */
export interface GitHubCLI {
  /**
   * Check if gh CLI is installed and authenticated
   */
  checkAuth(): Promise<boolean>;

  /**
   * Create a new GitHub issue
   */
  createIssue(
    owner: string,
    repo: string,
    title: string,
    body: string,
    labels: string[]
  ): Promise<GitHubIssueData>;

  /**
   * Update an existing GitHub issue
   */
  updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    title: string,
    body: string,
    labels: string[]
  ): Promise<GitHubIssueData>;

  /**
   * Close a GitHub issue
   */
  closeIssue(owner: string, repo: string, issueNumber: number): Promise<void>;

  /**
   * Reopen a GitHub issue
   */
  reopenIssue(owner: string, repo: string, issueNumber: number): Promise<void>;

  /**
   * Get issue details
   */
  getIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<GitHubIssueData | null>;

  /**
   * List labels on the repository
   */
  listLabels(owner: string, repo: string): Promise<string[]>;

  /**
   * Create a label on the repository
   */
  createLabel(
    owner: string,
    repo: string,
    name: string,
    color?: string,
    description?: string
  ): Promise<void>;

  /**
   * Add issue to a GitHub Project (GraphQL mutation via gh api)
   */
  addToProject(projectId: string, issueNodeId: string): Promise<string>;

  /**
   * Check if a repository exists and is accessible
   */
  checkRepository(owner: string, repo: string): Promise<boolean>;

  /**
   * Check if a GitHub Project exists and is accessible
   */
  checkProject(projectId: string): Promise<boolean>;

  /**
   * Create a new pull request
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param headBranch - Source branch for the PR
   * @param baseBranch - Target branch for the PR
   * @param title - PR title
   * @param body - PR body/description
   * @param draft - Whether to create as draft PR
   * @returns PR data including number and URL
   */
  createPR(
    owner: string,
    repo: string,
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string,
    draft?: boolean
  ): Promise<GitHubPRData>;

  /**
   * Merge a pull request
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - PR number to merge
   * @param strategy - Merge strategy (merge, squash, rebase)
   * @param commitTitle - Optional custom commit title for squash/merge
   * @returns Updated PR data
   */
  mergePR(
    owner: string,
    repo: string,
    prNumber: number,
    strategy?: GitHubMergeStrategy,
    commitTitle?: string
  ): Promise<GitHubPRData>;

  /**
   * Get pull request details
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - PR number
   * @returns PR data or null if not found
   */
  getPR(owner: string, repo: string, prNumber: number): Promise<GitHubPRData | null>;

  /**
   * Run arbitrary gh CLI command
   */
  run(args: string[]): Promise<GitHubCLIResult>;
}

/**
 * Node.js implementation of GitHubCLI using the gh CLI
 *
 * Requires gh CLI to be installed and authenticated.
 */
export class NodeGitHubCLI implements GitHubCLI {
  async checkAuth(): Promise<boolean> {
    const result = await this.run(["auth", "status", "-h", "github.com"]);
    return result.success;
  }

  async createIssue(
    owner: string,
    repo: string,
    title: string,
    body: string,
    labels: string[]
  ): Promise<GitHubIssueData> {
    const args = [
      "issue",
      "create",
      "-R",
      `${owner}/${repo}`,
      "--title",
      title,
      "--body",
      body,
    ];

    for (const label of labels) {
      args.push("--label", label);
    }

    // Get JSON output
    args.push("--json", "number,url,id,title,body,state,labels");

    const result = await this.run(args);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to create issue: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }

    const data = JSON.parse(result.stdout) as Record<string, unknown>;
    return this.mapIssueData(data);
  }

  async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    title: string,
    body: string,
    labels: string[]
  ): Promise<GitHubIssueData> {
    // Update title and body
    const editArgs = [
      "issue",
      "edit",
      String(issueNumber),
      "-R",
      `${owner}/${repo}`,
      "--title",
      title,
      "--body",
      body,
    ];

    const editResult = await this.run(editArgs);
    if (!editResult.success) {
      throw new GitHubCLIError(
        `Failed to update issue: ${editResult.stderr}`,
        editResult.exitCode,
        editResult.stderr
      );
    }

    // Update labels - first get current labels, then update
    if (labels.length > 0) {
      // Get current issue to find existing labels
      const current = await this.getIssue(owner, repo, issueNumber);
      const currentLabels = current?.labels ?? [];

      // Remove labels that are not in the new list
      for (const label of currentLabels) {
        if (!labels.includes(label)) {
          await this.run([
            "issue",
            "edit",
            String(issueNumber),
            "-R",
            `${owner}/${repo}`,
            "--remove-label",
            label,
          ]);
        }
      }

      // Add labels that are not in current
      for (const label of labels) {
        if (!currentLabels.includes(label)) {
          await this.run([
            "issue",
            "edit",
            String(issueNumber),
            "-R",
            `${owner}/${repo}`,
            "--add-label",
            label,
          ]);
        }
      }
    }

    // Fetch and return updated issue
    const issue = await this.getIssue(owner, repo, issueNumber);
    if (!issue) {
      throw new GitHubCLIError("Issue not found after update");
    }
    return issue;
  }

  async closeIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<void> {
    const result = await this.run([
      "issue",
      "close",
      String(issueNumber),
      "-R",
      `${owner}/${repo}`,
    ]);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to close issue: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
  }

  async reopenIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<void> {
    const result = await this.run([
      "issue",
      "reopen",
      String(issueNumber),
      "-R",
      `${owner}/${repo}`,
    ]);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to reopen issue: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
  }

  async getIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<GitHubIssueData | null> {
    const result = await this.run([
      "issue",
      "view",
      String(issueNumber),
      "-R",
      `${owner}/${repo}`,
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

  async listLabels(owner: string, repo: string): Promise<string[]> {
    const result = await this.run([
      "label",
      "list",
      "-R",
      `${owner}/${repo}`,
      "--json",
      "name",
    ]);

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

  async createLabel(
    owner: string,
    repo: string,
    name: string,
    color?: string,
    description?: string
  ): Promise<void> {
    const args = ["label", "create", name, "-R", `${owner}/${repo}`];

    if (color) {
      args.push("--color", color);
    }
    if (description) {
      args.push("--description", description);
    }

    const result = await this.run(args);
    // Label might already exist, which is fine
    if (!result.success && !result.stderr.includes("already exists")) {
      throw new GitHubCLIError(
        `Failed to create label: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
  }

  async addToProject(projectId: string, issueNodeId: string): Promise<string> {
    // GraphQL mutation via gh api
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

    const result = await this.run([
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

  async checkRepository(owner: string, repo: string): Promise<boolean> {
    const result = await this.run([
      "repo",
      "view",
      `${owner}/${repo}`,
      "--json",
      "name",
    ]);
    return result.success;
  }

  async checkProject(projectId: string): Promise<boolean> {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            id
            title
          }
        }
      }
    `;

    const result = await this.run([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `projectId=${projectId}`,
    ]);

    if (!result.success) {
      return false;
    }

    try {
      const data = JSON.parse(result.stdout) as {
        data?: { node?: { id?: string } };
      };
      return data.data?.node?.id !== undefined;
    } catch {
      return false;
    }
  }

  async createPR(
    owner: string,
    repo: string,
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string,
    draft = false
  ): Promise<GitHubPRData> {
    const args = [
      "pr",
      "create",
      "-R",
      `${owner}/${repo}`,
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

    // Get JSON output
    args.push(
      "--json",
      "number,url,id,title,body,state,isDraft,headRefName,baseRefName,merged,mergeable"
    );

    const result = await this.run(args);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to create PR: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }

    const data = JSON.parse(result.stdout) as Record<string, unknown>;
    return this.mapPRData(data);
  }

  async mergePR(
    owner: string,
    repo: string,
    prNumber: number,
    strategy: GitHubMergeStrategy = "squash",
    commitTitle?: string
  ): Promise<GitHubPRData> {
    const args = [
      "pr",
      "merge",
      String(prNumber),
      "-R",
      `${owner}/${repo}`,
      `--${strategy}`,
    ];

    if (commitTitle) {
      args.push("--subject", commitTitle);
    }

    const result = await this.run(args);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to merge PR: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }

    // Fetch updated PR data after merge
    const pr = await this.getPR(owner, repo, prNumber);
    if (!pr) {
      throw new GitHubCLIError("PR not found after merge");
    }
    return pr;
  }

  async getPR(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<GitHubPRData | null> {
    const result = await this.run([
      "pr",
      "view",
      String(prNumber),
      "-R",
      `${owner}/${repo}`,
      "--json",
      "number,url,id,title,body,state,isDraft,headRefName,baseRefName,merged,mergeable",
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

  async run(args: string[]): Promise<GitHubCLIResult> {
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
        // gh CLI not installed
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
    // Determine the state based on merged and state fields
    let state: GitHubPRData["state"];
    if (data["merged"] === true) {
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
      merged: (data["merged"] as boolean) ?? false,
      mergeable: (data["mergeable"] as GitHubPRData["mergeable"]) ?? "UNKNOWN",
    };
  }
}
