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
 *
 * Note: Methods no longer require owner/repo parameters - the gh CLI
 * auto-detects the repository from git remotes. This simplifies the API
 * and works correctly in git worktrees.
 */
export interface GitHubCLI {
  /**
   * Check if gh CLI is installed and authenticated
   */
  checkAuth(): Promise<boolean>;

  /**
   * Check if we're in a git repo with a GitHub remote
   */
  checkCurrentRepository(): Promise<boolean>;

  /**
   * Create a new GitHub issue
   */
  createIssue(
    title: string,
    body: string,
    labels: string[]
  ): Promise<GitHubIssueData>;

  /**
   * Update an existing GitHub issue
   */
  updateIssue(
    issueNumber: number,
    title: string,
    body: string,
    labels: string[]
  ): Promise<GitHubIssueData>;

  /**
   * Close a GitHub issue
   */
  closeIssue(issueNumber: number): Promise<void>;

  /**
   * Reopen a GitHub issue
   */
  reopenIssue(issueNumber: number): Promise<void>;

  /**
   * Get issue details
   */
  getIssue(issueNumber: number): Promise<GitHubIssueData | null>;

  /**
   * List labels on the repository
   */
  listLabels(): Promise<string[]>;

  /**
   * Create a label on the repository
   */
  createLabel(
    name: string,
    color?: string,
    description?: string
  ): Promise<void>;

  /**
   * Add issue to a GitHub Project (GraphQL mutation via gh api)
   */
  addToProject(projectId: string, issueNodeId: string): Promise<string>;

  /**
   * Check if a GitHub Project exists and is accessible
   */
  checkProject(projectId: string): Promise<boolean>;

  /**
   * Get GitHub Project details including URL
   *
   * @param projectId - GitHub Project ID (PVT_...)
   * @returns Project info with URL, or null if not found
   */
  getProjectDetails(projectId: string): Promise<{ id: string; title: string; url: string } | null>;

  /**
   * Create a new pull request
   *
   * @param headBranch - Source branch for the PR
   * @param baseBranch - Target branch for the PR
   * @param title - PR title
   * @param body - PR body/description
   * @param draft - Whether to create as draft PR
   * @returns PR data including number and URL
   */
  createPR(
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string,
    draft?: boolean
  ): Promise<GitHubPRData>;

  /**
   * Merge a pull request
   *
   * @param prNumber - PR number to merge
   * @param strategy - Merge strategy (merge, squash, rebase)
   * @param commitTitle - Optional custom commit title for squash/merge
   * @returns Updated PR data
   */
  mergePR(
    prNumber: number,
    strategy?: GitHubMergeStrategy,
    commitTitle?: string
  ): Promise<GitHubPRData>;

  /**
   * Get pull request details
   *
   * @param prNumber - PR number
   * @returns PR data or null if not found
   */
  getPR(prNumber: number): Promise<GitHubPRData | null>;

  /**
   * Find a pull request by head branch name
   *
   * @param headBranch - The source branch name
   * @returns PR data or null if no PR exists for this branch
   */
  findPRByBranch(headBranch: string): Promise<GitHubPRData | null>;

  /**
   * Run arbitrary gh CLI command
   */
  run(args: string[]): Promise<GitHubCLIResult>;
}

/**
 * Node.js implementation of GitHubCLI using the gh CLI
 *
 * Requires gh CLI to be installed and authenticated.
 * Auto-detects repository from git remotes - no need to specify owner/repo.
 */
export class NodeGitHubCLI implements GitHubCLI {
  async checkAuth(): Promise<boolean> {
    const result = await this.run(["auth", "status", "-h", "github.com"]);
    return result.success;
  }

  async checkCurrentRepository(): Promise<boolean> {
    // gh repo view without -R will use the current repo from git remotes
    const result = await this.run(["repo", "view", "--json", "name"]);
    return result.success;
  }

  async createIssue(
    title: string,
    body: string,
    labels: string[]
  ): Promise<GitHubIssueData> {
    const args = ["issue", "create", "--title", title, "--body", body];

    for (const label of labels) {
      args.push("--label", label);
    }

    // gh issue create outputs the URL of the created issue
    const result = await this.run(args);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to create issue: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }

    // Parse issue number from the URL (e.g., https://github.com/owner/repo/issues/123)
    const url = result.stdout.trim();
    const match = url.match(/\/issues\/(\d+)$/);
    if (!match) {
      throw new GitHubCLIError(
        `Failed to parse issue number from URL: ${url}`,
        0,
        ""
      );
    }

    const issueNumber = parseInt(match[1], 10);

    // Fetch full issue data
    const issue = await this.getIssue(issueNumber);
    if (!issue) {
      throw new GitHubCLIError(
        `Failed to fetch created issue: ${issueNumber}`,
        0,
        ""
      );
    }

    return issue;
  }

  async updateIssue(
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
      const current = await this.getIssue(issueNumber);
      const currentLabels = current?.labels ?? [];

      // Remove labels that are not in the new list
      for (const label of currentLabels) {
        if (!labels.includes(label)) {
          await this.run([
            "issue",
            "edit",
            String(issueNumber),
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
            "--add-label",
            label,
          ]);
        }
      }
    }

    // Fetch and return updated issue
    const issue = await this.getIssue(issueNumber);
    if (!issue) {
      throw new GitHubCLIError("Issue not found after update");
    }
    return issue;
  }

  async closeIssue(issueNumber: number): Promise<void> {
    const result = await this.run(["issue", "close", String(issueNumber)]);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to close issue: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
  }

  async reopenIssue(issueNumber: number): Promise<void> {
    const result = await this.run(["issue", "reopen", String(issueNumber)]);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to reopen issue: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
  }

  async getIssue(issueNumber: number): Promise<GitHubIssueData | null> {
    const result = await this.run([
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

  async listLabels(): Promise<string[]> {
    const result = await this.run(["label", "list", "--json", "name"]);

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
    name: string,
    color?: string,
    description?: string
  ): Promise<void> {
    const args = ["label", "create", name];

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


  async checkProject(projectId: string): Promise<boolean> {
    const details = await this.getProjectDetails(projectId);
    return details !== null;
  }

  async getProjectDetails(projectId: string): Promise<{ id: string; title: string; url: string } | null> {
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

    const result = await this.run([
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
        return {
          id: node.id,
          title: node.title,
          url: node.url,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async createPR(
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

    // Note: gh pr create doesn't support --json, so we create the PR first
    // then fetch its data using gh pr view
    const result = await this.run(args);
    if (!result.success) {
      throw new GitHubCLIError(
        `Failed to create PR: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }

    // The output contains the PR URL, extract the PR number from it
    // Format: https://github.com/owner/repo/pull/123
    const urlMatch = result.stdout.trim().match(/\/pull\/(\d+)/);
    if (!urlMatch) {
      throw new GitHubCLIError(
        `Failed to parse PR URL from output: ${result.stdout}`
      );
    }

    const prNumber = parseInt(urlMatch[1], 10);

    // Fetch full PR data
    const pr = await this.getPR(prNumber);
    if (!pr) {
      throw new GitHubCLIError("PR not found after creation");
    }
    return pr;
  }

  async mergePR(
    prNumber: number,
    strategy: GitHubMergeStrategy = "squash",
    commitTitle?: string
  ): Promise<GitHubPRData> {
    const args = ["pr", "merge", String(prNumber), `--${strategy}`];

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
    const pr = await this.getPR(prNumber);
    if (!pr) {
      throw new GitHubCLIError("PR not found after merge");
    }
    return pr;
  }

  async getPR(prNumber: number): Promise<GitHubPRData | null> {
    const result = await this.run([
      "pr",
      "view",
      String(prNumber),
      "--json",
      "number,url,id,title,body,state,isDraft,headRefName,baseRefName,mergedAt,mergeable",
    ]);

    if (!result.success) {
      if (
        result.stderr.includes("not found") ||
        result.stderr.includes("Could not resolve")
      ) {
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

  async findPRByBranch(headBranch: string): Promise<GitHubPRData | null> {
    const result = await this.run([
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
    // Derive merged status from mergedAt (gh CLI doesn't have a 'merged' field)
    const mergedAt = data["mergedAt"] as string | null;
    const isMerged = mergedAt !== null && mergedAt !== undefined;

    // Determine the state based on merged status and state fields
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
