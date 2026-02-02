/**
 * Mock GitHub CLI for testing
 *
 * Provides a configurable mock implementation of the GitHubCLI interface.
 * Allows tests to control responses and verify calls without making real API requests.
 */

import { Effect } from "@dev-workflow/effect";
import type {
  GitHubCLI,
  GitHubCLIResult,
  GitHubIssueData,
  GitHubPRData,
  GitHubMergeStrategy,
} from "./github-cli.js";
import { GitHubCLIError } from "./github-cli.js";

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
  errors?: Partial<Record<string, Error>>;

  /** Project Status field configuration for GraphQL queries */
  projectStatusField?: {
    fieldId: string;
    options: Array<{ id: string; name: string }>;
  };

  /** Search results to return from searchIssues */
  searchResults?: GitHubIssueData[];

  /** Project custom fields to return for getProjectFields queries */
  projectFields?: Array<{
    id: string;
    name: string;
    type: "TEXT" | "NUMBER" | "DATE" | "SINGLE_SELECT" | "ITERATION" | "OTHER";
    options?: Array<{ id: string; name: string }>;
  }>;
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
      projectStatusField: config.projectStatusField ?? {
        fieldId: "PVTSSF_test_status",
        options: [
          { id: "opt_backlog", name: "Backlog" },
          { id: "opt_ready", name: "Ready" },
          { id: "opt_in_progress", name: "In Progress" },
          { id: "opt_in_review", name: "In Review" },
          { id: "opt_done", name: "Done" },
        ],
      },
      searchResults: config.searchResults ?? [],
      projectFields: config.projectFields ?? [],
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
  getCallsTo(method: string): MockGitHubCLICall[] {
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
   * Set issues for testing (e.g., to simulate pre-existing GitHub issues)
   */
  setIssues(issues: GitHubIssueData[]): void {
    this.issues.clear();
    for (const issue of issues) {
      this.issues.set(issue.number, issue);
    }
  }

  /**
   * Get a created PR by number
   */
  getCreatedPR(number: number): GitHubPRData | undefined {
    return this.prs.get(number);
  }

  /**
   * Set PR status for testing.
   * Pass null to simulate PR not found on GitHub.
   * Pass an object with merged/state to simulate specific PR state.
   */
  setPRStatus(prNumber: number, status: { merged: boolean; state: string } | null): void {
    if (status === null) {
      this.prs.delete(prNumber);
    } else {
      const existing = this.prs.get(prNumber);
      const pr: GitHubPRData = {
        number: prNumber,
        url: existing?.url ?? `https://github.com/test/repo/pull/${prNumber}`,
        nodeId: existing?.nodeId ?? `PR_test_${prNumber}`,
        title: existing?.title ?? `PR #${prNumber}`,
        body: existing?.body ?? "",
        state: status.state as "OPEN" | "CLOSED" | "MERGED",
        isDraft: existing?.isDraft ?? false,
        headBranch: existing?.headBranch ?? `branch-${prNumber}`,
        baseBranch: existing?.baseBranch ?? "main",
        merged: status.merged,
        mergeable: existing?.mergeable ?? "MERGEABLE",
      };
      this.prs.set(prNumber, pr);
    }
  }

  private recordCall(method: string, args: unknown[]): void {
    this.calls.push({ method, args, timestamp: new Date() });
  }

  private checkError(method: string): void {
    const error = this.config.errors[method];
    if (error) {
      throw error;
    }
  }

  // ===========================================================================
  // Effect-returning methods (matching the GitHubCLI interface)
  // ===========================================================================

  checkAuth(): Effect<boolean> {
    return Effect.promise(async () => {
      this.recordCall("checkAuth", []);
      this.checkError("checkAuth");
      return this.config.isAuthenticated;
    });
  }

  checkCurrentRepository(): Effect<boolean> {
    return Effect.promise(async () => {
      this.recordCall("checkCurrentRepository", []);
      this.checkError("checkCurrentRepository");
      return this.config.isInRepository;
    });
  }

  getRepoUrl(): Effect<string | null> {
    return Effect.promise(async () => {
      this.recordCall("getRepoUrl", []);
      this.checkError("getRepoUrl");
      return this.config.isInRepository ? "https://github.com/test-owner/test-repo" : null;
    });
  }

  createIssue(
    title: string,
    body: string,
    labels: string[]
  ): Effect<GitHubIssueData, GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
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
      },
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
      try: async () => {
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
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  closeIssue(issueNumber: number): Effect<void, GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
        this.recordCall("closeIssue", [issueNumber]);
        this.checkError("closeIssue");
        const existing = this.issues.get(issueNumber);
        if (existing) {
          this.issues.set(issueNumber, { ...existing, state: "CLOSED" });
        }
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  reopenIssue(issueNumber: number): Effect<void, GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
        this.recordCall("reopenIssue", [issueNumber]);
        this.checkError("reopenIssue");
        const existing = this.issues.get(issueNumber);
        if (existing) {
          this.issues.set(issueNumber, { ...existing, state: "OPEN" });
        }
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  getIssue(issueNumber: number): Effect<GitHubIssueData | null, GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
        this.recordCall("getIssue", [issueNumber]);
        this.checkError("getIssue");
        return this.issues.get(issueNumber) ?? null;
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  searchIssues(
    query: string,
    state: "open" | "closed" | "all" = "all",
    limit = 10
  ): Effect<GitHubIssueData[], GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
        this.recordCall("searchIssues", [query, state, limit]);
        this.checkError("searchIssues");
        let results = [...this.config.searchResults];
        if (state !== "all") {
          const stateUpper = state.toUpperCase();
          results = results.filter((issue) => issue.state === stateUpper);
        }
        return results.slice(0, limit);
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  commentOnIssue(issueNumber: number, comment: string): Effect<void, GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
        this.recordCall("commentOnIssue", [issueNumber, comment]);
        this.checkError("commentOnIssue");
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  closeIssueWithComment(issueNumber: number, comment?: string): Effect<void, GitHubCLIError> {
    const self = this;
    return Effect.catchAll(
      Effect.gen(function* () {
        self.recordCall("closeIssueWithComment", [issueNumber, comment]);
        self.checkError("closeIssueWithComment");
        if (comment) {
          yield* self.commentOnIssue(issueNumber, comment);
        }
        yield* self.closeIssue(issueNumber);
      }),
      (e: GitHubCLIError) => Effect.fail(e)
    );
  }

  listLabels(): Effect<string[], GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
        this.recordCall("listLabels", []);
        this.checkError("listLabels");
        return [...this.config.existingLabels];
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  createLabel(name: string, color?: string, description?: string): Effect<void, GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
        this.recordCall("createLabel", [name, color, description]);
        this.checkError("createLabel");
        if (!this.config.existingLabels.includes(name)) {
          this.config.existingLabels.push(name);
        }
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  addToProject(projectId: string, issueNodeId: string): Effect<string, GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
        this.recordCall("addToProject", [projectId, issueNodeId]);
        this.checkError("addToProject");
        if (!this.config.projectExists) {
          throw new Error(`Project ${projectId} not found`);
        }
        return `PVTI_${issueNodeId}_${Date.now()}`;
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  checkProject(projectId: string): Effect<boolean> {
    return Effect.promise(async () => {
      this.recordCall("checkProject", [projectId]);
      this.checkError("checkProject");
      return this.config.projectExists;
    });
  }

  getProjectDetails(projectId: string): Effect<{ id: string; title: string; url: string } | null> {
    return Effect.promise(async () => {
      this.recordCall("getProjectDetails", [projectId]);
      this.checkError("getProjectDetails");
      if (!this.config.projectExists) {
        return null;
      }
      return this.config.projectDetails;
    });
  }

  createPR(
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string,
    draft = false
  ): Effect<GitHubPRData, GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
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
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  mergePR(
    prNumber: number,
    _strategy?: GitHubMergeStrategy,
    _commitTitle?: string
  ): Effect<GitHubPRData, GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
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
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  getPR(prNumber: number): Effect<GitHubPRData | null, GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
        this.recordCall("getPR", [prNumber]);
        this.checkError("getPR");
        return this.prs.get(prNumber) ?? null;
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  findPRByBranch(headBranch: string): Effect<GitHubPRData | null, GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
        this.recordCall("findPRByBranch", [headBranch]);
        this.checkError("findPRByBranch");
        for (const pr of this.prs.values()) {
          if (pr.headBranch === headBranch) {
            return pr;
          }
        }
        return null;
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  linkSubIssue(parentIssueNumber: number, childIssueId: number): Effect<void, GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
        this.recordCall("linkSubIssue", [parentIssueNumber, childIssueId]);
        this.checkError("linkSubIssue");
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  assignIssue(issueNumber: number, assignee: string): Effect<void, GitHubCLIError> {
    return Effect.tryPromise({
      try: async () => {
        this.recordCall("assignIssue", [issueNumber, assignee]);
        this.checkError("assignIssue");
      },
      catch: (e) => (e instanceof GitHubCLIError ? e : new GitHubCLIError(String(e))),
    });
  }

  run(args: string[]): Effect<GitHubCLIResult> {
    return Effect.promise(async () => {
      this.recordCall("run", [args]);
      this.checkError("run");

      // Check if this is a GraphQL query and return appropriate mock response
      const queryArg = args.find((arg) => arg.startsWith("query="));
      if (queryArg) {
        const query = queryArg.substring(6); // Remove "query=" prefix

        // Check if this is a project fields query
        if (query.includes("ProjectV2") && query.includes("fields")) {
          // If custom projectFields are configured, return them
          if (this.config.projectFields.length > 0) {
            const nodes = this.config.projectFields.map((f) => ({
              id: f.id,
              name: f.name,
              dataType: f.type,
              options: f.options,
            }));
            const response = {
              data: {
                node: {
                  fields: {
                    nodes,
                  },
                },
              },
            };
            return {
              success: true,
              stdout: JSON.stringify(response),
              stderr: "",
              exitCode: 0,
            };
          }

          // Default: return status field from projectStatusField config
          const { fieldId, options } = this.config.projectStatusField;
          const response = {
            data: {
              node: {
                fields: {
                  nodes: [
                    {
                      id: fieldId,
                      name: "Status",
                      dataType: "SINGLE_SELECT",
                      options: options,
                    },
                  ],
                },
              },
            },
          };
          return {
            success: true,
            stdout: JSON.stringify(response),
            stderr: "",
            exitCode: 0,
          };
        }

        // Check if this is an updateProjectV2ItemFieldValue mutation
        if (query.includes("updateProjectV2ItemFieldValue")) {
          const itemIdArg = args.find((arg) => arg.startsWith("itemId="));
          const itemId = itemIdArg ? itemIdArg.substring(7) : "PVTI_test_item";
          const response = {
            data: {
              updateProjectV2ItemFieldValue: {
                projectV2Item: {
                  id: itemId,
                },
              },
            },
          };
          return {
            success: true,
            stdout: JSON.stringify(response),
            stderr: "",
            exitCode: 0,
          };
        }
      }

      // Check if this is a REST API call to get issue ID
      const issueApiMatch = args[0]?.match(/repos\/\{owner\}\/\{repo\}\/issues\/(\d+)/);
      if (issueApiMatch && args.includes("--jq") && args.includes(".id")) {
        const issueNumber = parseInt(issueApiMatch[1], 10);
        return {
          success: true,
          stdout: String(1000000 + issueNumber),
          stderr: "",
          exitCode: 0,
        };
      }

      // Default response for other commands
      return {
        success: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
      };
    });
  }
}
