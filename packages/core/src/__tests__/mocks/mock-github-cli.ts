/**
 * Mock GitHub CLI for testing
 *
 * Provides a configurable mock implementation of the GitHubCLI interface.
 * Allows tests to control responses and verify calls without making real API requests.
 */

import type { GitHubCLI, GitHubCLIResult } from "../../infrastructure/github/github-cli.js";
import type { GitHubIssueData, GitHubPRData, GitHubMergeStrategy } from "../../domain/github.js";

/**
 * Recorded call to the mock GitHub CLI
 */
export interface MockGitHubCLICall {
  method: string;
  args: unknown[];
  timestamp: Date;
}

/**
 * Configuration for mock GitHub CLI responses
 */
export interface MockGitHubCLIConfig {
  /** Whether gh CLI is authenticated */
  isAuthenticated?: boolean;

  /** Whether we're in a valid GitHub repository */
  isInRepository?: boolean;

  /** Labels that exist on the repository */
  existingLabels?: string[];

  /** Next issue number to use when creating */
  nextIssueNumber?: number;

  /** Next PR number to use when creating */
  nextPRNumber?: number;

  /** Whether project operations should succeed */
  projectExists?: boolean;

  /** Project details to return */
  projectDetails?: { id: string; title: string; url: string } | null;

  /** Custom error to throw on specific operations */
  errors?: Partial<Record<keyof GitHubCLI, Error>>;
}

/**
 * Mock implementation of GitHubCLI for testing
 *
 * Features:
 * - Configurable responses via constructor or setConfig()
 * - Records all method calls for verification
 * - Simulates issue and PR creation with incrementing numbers
 * - In-memory storage of created issues and PRs
 */
export class MockGitHubCLI implements GitHubCLI {
  private config: Required<MockGitHubCLIConfig>;
  private calls: MockGitHubCLICall[] = [];
  private issues: Map<number, GitHubIssueData> = new Map();
  private prs: Map<number, GitHubPRData> = new Map();

  constructor(config: MockGitHubCLIConfig = {}) {
    this.config = {
      isAuthenticated: config.isAuthenticated ?? true,
      isInRepository: config.isInRepository ?? true,
      existingLabels: config.existingLabels ?? [],
      nextIssueNumber: config.nextIssueNumber ?? 1,
      nextPRNumber: config.nextPRNumber ?? 1,
      projectExists: config.projectExists ?? true,
      projectDetails: config.projectDetails ?? {
        id: "PVT_test123",
        title: "Test Project",
        url: "https://github.com/orgs/test/projects/1",
      },
      errors: config.errors ?? {},
    };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<MockGitHubCLIConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get all recorded calls
   */
  getCalls(): MockGitHubCLICall[] {
    return [...this.calls];
  }

  /**
   * Get calls to a specific method
   */
  getCallsTo(method: keyof GitHubCLI): MockGitHubCLICall[] {
    return this.calls.filter((c) => c.method === method);
  }

  /**
   * Clear recorded calls
   */
  clearCalls(): void {
    this.calls = [];
  }

  /**
   * Reset all state (calls, issues, PRs)
   */
  reset(): void {
    this.calls = [];
    this.issues.clear();
    this.prs.clear();
    this.config.nextIssueNumber = 1;
    this.config.nextPRNumber = 1;
  }

  /**
   * Get a created issue by number
   */
  getCreatedIssue(number: number): GitHubIssueData | undefined {
    return this.issues.get(number);
  }

  /**
   * Get a created PR by number
   */
  getCreatedPR(number: number): GitHubPRData | undefined {
    return this.prs.get(number);
  }

  private recordCall(method: string, args: unknown[]): void {
    this.calls.push({ method, args, timestamp: new Date() });
  }

  private checkError(method: keyof GitHubCLI): void {
    const error = this.config.errors[method];
    if (error) {
      throw error;
    }
  }

  async checkAuth(): Promise<boolean> {
    this.recordCall("checkAuth", []);
    this.checkError("checkAuth");
    return this.config.isAuthenticated;
  }

  async checkCurrentRepository(): Promise<boolean> {
    this.recordCall("checkCurrentRepository", []);
    this.checkError("checkCurrentRepository");
    return this.config.isInRepository;
  }

  async createIssue(title: string, body: string, labels: string[]): Promise<GitHubIssueData> {
    this.recordCall("createIssue", [title, body, labels]);
    this.checkError("createIssue");

    const number = this.config.nextIssueNumber++;
    const issue: GitHubIssueData = {
      number,
      url: `https://github.com/test/repo/issues/${number}`,
      nodeId: `I_test_${number}`,
      title,
      body,
      state: "OPEN",
      labels,
    };

    this.issues.set(number, issue);
    return issue;
  }

  async updateIssue(
    issueNumber: number,
    title: string,
    body: string,
    labels: string[]
  ): Promise<GitHubIssueData> {
    this.recordCall("updateIssue", [issueNumber, title, body, labels]);
    this.checkError("updateIssue");

    const existing = this.issues.get(issueNumber);
    const issue: GitHubIssueData = {
      number: issueNumber,
      url: existing?.url ?? `https://github.com/test/repo/issues/${issueNumber}`,
      nodeId: existing?.nodeId ?? `I_test_${issueNumber}`,
      title,
      body,
      state: existing?.state ?? "OPEN",
      labels,
    };

    this.issues.set(issueNumber, issue);
    return issue;
  }

  async closeIssue(issueNumber: number): Promise<void> {
    this.recordCall("closeIssue", [issueNumber]);
    this.checkError("closeIssue");

    const existing = this.issues.get(issueNumber);
    if (existing) {
      this.issues.set(issueNumber, { ...existing, state: "CLOSED" });
    }
  }

  async reopenIssue(issueNumber: number): Promise<void> {
    this.recordCall("reopenIssue", [issueNumber]);
    this.checkError("reopenIssue");

    const existing = this.issues.get(issueNumber);
    if (existing) {
      this.issues.set(issueNumber, { ...existing, state: "OPEN" });
    }
  }

  async getIssue(issueNumber: number): Promise<GitHubIssueData | null> {
    this.recordCall("getIssue", [issueNumber]);
    this.checkError("getIssue");

    return this.issues.get(issueNumber) ?? null;
  }

  async listLabels(): Promise<string[]> {
    this.recordCall("listLabels", []);
    this.checkError("listLabels");

    return [...this.config.existingLabels];
  }

  async createLabel(name: string, color?: string, description?: string): Promise<void> {
    this.recordCall("createLabel", [name, color, description]);
    this.checkError("createLabel");

    if (!this.config.existingLabels.includes(name)) {
      this.config.existingLabels.push(name);
    }
  }

  async addToProject(projectId: string, issueNodeId: string): Promise<string> {
    this.recordCall("addToProject", [projectId, issueNodeId]);
    this.checkError("addToProject");

    if (!this.config.projectExists) {
      throw new Error(`Project ${projectId} not found`);
    }

    return `PVTI_${issueNodeId}_${Date.now()}`;
  }

  async checkProject(projectId: string): Promise<boolean> {
    this.recordCall("checkProject", [projectId]);
    this.checkError("checkProject");

    return this.config.projectExists;
  }

  async getProjectDetails(
    projectId: string
  ): Promise<{ id: string; title: string; url: string } | null> {
    this.recordCall("getProjectDetails", [projectId]);
    this.checkError("getProjectDetails");

    if (!this.config.projectExists) {
      return null;
    }

    return this.config.projectDetails;
  }

  async createPR(
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string,
    draft = false
  ): Promise<GitHubPRData> {
    this.recordCall("createPR", [headBranch, baseBranch, title, body, draft]);
    this.checkError("createPR");

    const number = this.config.nextPRNumber++;
    const pr: GitHubPRData = {
      number,
      url: `https://github.com/test/repo/pull/${number}`,
      nodeId: `PR_test_${number}`,
      title,
      body,
      state: "OPEN",
      isDraft: draft,
      headBranch,
      baseBranch,
      merged: false,
      mergeable: "MERGEABLE",
    };

    this.prs.set(number, pr);
    return pr;
  }

  async mergePR(
    prNumber: number,
    _strategy?: GitHubMergeStrategy,
    _commitTitle?: string
  ): Promise<GitHubPRData> {
    this.recordCall("mergePR", [prNumber, _strategy, _commitTitle]);
    this.checkError("mergePR");

    const existing = this.prs.get(prNumber);
    if (!existing) {
      throw new Error(`PR #${prNumber} not found`);
    }

    const merged: GitHubPRData = {
      ...existing,
      state: "MERGED",
      merged: true,
    };

    this.prs.set(prNumber, merged);
    return merged;
  }

  async getPR(prNumber: number): Promise<GitHubPRData | null> {
    this.recordCall("getPR", [prNumber]);
    this.checkError("getPR");

    return this.prs.get(prNumber) ?? null;
  }

  async findPRByBranch(headBranch: string): Promise<GitHubPRData | null> {
    this.recordCall("findPRByBranch", [headBranch]);
    this.checkError("findPRByBranch");

    for (const pr of this.prs.values()) {
      if (pr.headBranch === headBranch) {
        return pr;
      }
    }
    return null;
  }

  async run(args: string[]): Promise<GitHubCLIResult> {
    this.recordCall("run", [args]);
    this.checkError("run");

    return {
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    };
  }
}
