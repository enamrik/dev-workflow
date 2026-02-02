/**
 * GitHubProjectManagementClient - GitHub implementation of ProjectManagementClient
 *
 * This is a LOW-LEVEL client that handles ONLY GitHub API calls.
 * NO orchestration, NO null checks, NO timestamp management - that's in ProjectManagementService.
 *
 * Design:
 * - Composition: wraps GitHubCLI
 * - Type mapping: converts GitHubIssueData → ExternalIssue
 * - Methods may throw on errors - caller handles
 * - PR operations are NOT included (Git-hosting specific)
 */

import type {
  AuthResult,
  RepositoryResult,
  CreateIssueParams,
  ExternalIssue,
  ProjectItemResult,
  ProjectDetails,
  ProjectStatusField,
  ProjectColumn,
  ProjectField,
  ProjectFieldType,
  SetFieldResult,
  AvailableLabel,
  AvailableLabelsResult,
} from "../project-management-provider.js";
import type { TaskStatus } from "../../domain/tasks/task.js";
import type { ProjectManagementClient } from "../project-management-client.js";
import { ProjectManagementClientError } from "../project-management-client.js";
import type { GitHubCLI, GitHubIssueData } from "./github-cli.js";
import type { ProjectManagementConfig } from "../project-management-config.js";
import { DEFAULT_COLUMN_MAPPING } from "@dev-workflow/database/schema.js";

/**
 * GitHubProjectManagementClient - Low-level GitHub API operations
 *
 * All methods are direct API calls. Orchestration happens in ProjectManagementService.
 */
export class GitHubProjectManagementClient implements ProjectManagementClient {
  readonly providerId = "github";
  readonly displayName = "GitHub";

  // Cache for project fields to minimize API calls
  private readonly fieldCache = new Map<string, { fields: ProjectField[]; fetchedAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly githubCLI: GitHubCLI,
    private readonly config: ProjectManagementConfig | null
  ) {}

  // ===========================================================================
  // Configuration Accessors
  // ===========================================================================

  isEnabled(): boolean {
    return this.config?.enabled ?? false;
  }

  getProjectId(): string | null {
    return this.config?.projectId ?? null;
  }

  getColumnForStatus(status: TaskStatus): string | null {
    if (!this.config) {
      return null;
    }
    const configuredMapping = this.config.columnMapping ?? {};
    const columnMapping: Record<TaskStatus, string> = {
      ...DEFAULT_COLUMN_MAPPING,
      ...configuredMapping,
    };
    return columnMapping[status] ?? null;
  }

  getLabelFieldMapping(): Record<string, string> {
    return this.config?.labelFieldMapping ?? {};
  }

  getAssignee(): string | null {
    return this.config?.assignee ?? null;
  }

  getCustomLabels(): string[] {
    return this.config?.labels?.customLabels ?? [];
  }

  // ===========================================================================
  // Authentication & Validation
  // ===========================================================================

  async checkAuth(): Promise<AuthResult> {
    try {
      const authenticated = await this.githubCLI.checkAuth();
      if (authenticated) {
        return { authenticated: true };
      }
      return {
        authenticated: false,
        error: "GitHub CLI is not authenticated. Run 'gh auth login' to authenticate.",
      };
    } catch (error) {
      return {
        authenticated: false,
        error: `Authentication check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async checkRepository(): Promise<RepositoryResult> {
    try {
      const accessible = await this.githubCLI.checkCurrentRepository();
      if (accessible) {
        return { accessible: true };
      }
      return {
        accessible: false,
        error: "Not in a Git repository with a GitHub remote.",
      };
    } catch (error) {
      return {
        accessible: false,
        error: `Repository check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ===========================================================================
  // Issue Operations (Low-Level API Calls)
  // ===========================================================================

  async createIssue(params: CreateIssueParams): Promise<ExternalIssue> {
    try {
      const githubIssue = await this.githubCLI.createIssue(
        params.title,
        params.body,
        params.labels
      );
      return this.mapGitHubIssueToExternalIssue(githubIssue);
    } catch (error) {
      throw new ProjectManagementClientError(
        error instanceof Error ? error.message : String(error),
        this.providerId,
        "createIssue",
        error instanceof Error ? error : undefined
      );
    }
  }

  async closeIssue(externalId: string, comment?: string): Promise<void> {
    const issueNumber = this.parseIssueNumber(externalId);
    try {
      if (comment) {
        await this.githubCLI.closeIssueWithComment(issueNumber, comment);
      } else {
        await this.githubCLI.closeIssue(issueNumber);
      }
    } catch (error) {
      throw new ProjectManagementClientError(
        error instanceof Error ? error.message : String(error),
        this.providerId,
        "closeIssue",
        error instanceof Error ? error : undefined
      );
    }
  }

  async reopenIssue(externalId: string): Promise<void> {
    try {
      const issueNumber = this.parseIssueNumber(externalId);
      await this.githubCLI.reopenIssue(issueNumber);
    } catch (error) {
      throw new ProjectManagementClientError(
        error instanceof Error ? error.message : String(error),
        this.providerId,
        "reopenIssue",
        error instanceof Error ? error : undefined
      );
    }
  }

  async getIssue(externalId: string): Promise<ExternalIssue | null> {
    try {
      const issueNumber = this.parseIssueNumber(externalId);
      const githubIssue = await this.githubCLI.getIssue(issueNumber);
      if (!githubIssue) {
        return null;
      }
      return this.mapGitHubIssueToExternalIssue(githubIssue);
    } catch (error) {
      throw new ProjectManagementClientError(
        error instanceof Error ? error.message : String(error),
        this.providerId,
        "getIssue",
        error instanceof Error ? error : undefined
      );
    }
  }

  async searchIssues(
    query: string,
    state: "open" | "closed" | "all" = "all",
    limit = 10
  ): Promise<ExternalIssue[]> {
    try {
      const githubIssues = await this.githubCLI.searchIssues(query, state, limit);
      return githubIssues.map((issue) => this.mapGitHubIssueToExternalIssue(issue));
    } catch (error) {
      throw new ProjectManagementClientError(
        error instanceof Error ? error.message : String(error),
        this.providerId,
        "searchIssues",
        error instanceof Error ? error : undefined
      );
    }
  }

  // ===========================================================================
  // Project/Board Operations (Low-Level API Calls)
  // ===========================================================================

  async addToProject(nodeId: string, projectId: string): Promise<ProjectItemResult> {
    try {
      const itemId = await this.githubCLI.addToProject(projectId, nodeId);
      return {
        success: true,
        itemId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async moveToColumn(itemId: string, projectId: string, columnName: string): Promise<void> {
    try {
      // Get the project's Status field info
      const fieldInfo = await this.getProjectStatusField(projectId);
      if (!fieldInfo) {
        throw new Error(`Could not find Status field in project ${projectId}`);
      }

      // Find the option ID for the requested column
      const option = fieldInfo.options.find(
        (o) => o.name.toLowerCase() === columnName.toLowerCase()
      );
      if (!option) {
        throw new Error(`Could not find "${columnName}" column in project Status field`);
      }

      // Update the item's Status field
      await this.updateProjectItemSingleSelectField(
        projectId,
        itemId,
        fieldInfo.fieldId,
        option.id
      );
    } catch (error) {
      throw new ProjectManagementClientError(
        error instanceof Error ? error.message : String(error),
        this.providerId,
        "moveToColumn",
        error instanceof Error ? error : undefined
      );
    }
  }

  async setProjectItemField(
    projectId: string,
    itemId: string,
    fieldId: string,
    value: string
  ): Promise<SetFieldResult> {
    try {
      // Get field metadata to determine type and resolve options
      const fields = await this.getProjectFields(projectId);
      const field = fields.find((f) => f.id === fieldId);

      if (!field) {
        return {
          success: false,
          error: `Field ${fieldId} not found in project ${projectId}`,
        };
      }

      if (field.type === "SINGLE_SELECT") {
        // Resolve value to option ID (case-insensitive)
        const option = field.options?.find((o) => o.name.toLowerCase() === value.toLowerCase());

        if (!option) {
          return {
            success: false,
            error: `Option "${value}" not found for field "${field.name}". Available options: ${field.options?.map((o) => o.name).join(", ")}`,
          };
        }

        await this.updateProjectItemSingleSelectField(projectId, itemId, fieldId, option.id);
      } else if (field.type === "TEXT") {
        await this.updateProjectItemTextField(projectId, itemId, fieldId, value);
      } else if (field.type === "NUMBER") {
        const numValue = parseFloat(value);
        if (isNaN(numValue)) {
          return {
            success: false,
            error: `Invalid number value "${value}" for field "${field.name}"`,
          };
        }
        await this.updateProjectItemNumberField(projectId, itemId, fieldId, numValue);
      } else {
        return {
          success: false,
          error: `Unsupported field type "${field.type}" for field "${field.name}"`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async clearProjectItemField(
    projectId: string,
    itemId: string,
    fieldId: string
  ): Promise<SetFieldResult> {
    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
        clearProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    try {
      const result = await this.githubCLI.run([
        "api",
        "graphql",
        "-f",
        `query=${mutation}`,
        "-f",
        `projectId=${projectId}`,
        "-f",
        `itemId=${itemId}`,
        "-f",
        `fieldId=${fieldId}`,
      ]);

      if (!result.success) {
        return {
          success: false,
          error: result.stderr || "Failed to clear field",
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ===========================================================================
  // Project Metadata Operations
  // ===========================================================================

  async checkProject(projectId: string): Promise<boolean> {
    try {
      return await this.githubCLI.checkProject(projectId);
    } catch {
      return false;
    }
  }

  async getProjectDetails(projectId: string): Promise<ProjectDetails | null> {
    try {
      const details = await this.githubCLI.getProjectDetails(projectId);
      if (!details) {
        return null;
      }
      return {
        id: details.id,
        title: details.title,
        url: details.url,
      };
    } catch {
      return null;
    }
  }

  async getProjectStatusField(projectId: string): Promise<ProjectStatusField | null> {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 20) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const result = await this.githubCLI.run([
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

      const data = JSON.parse(result.stdout) as {
        data?: {
          node?: {
            fields?: {
              nodes?: Array<{
                id?: string;
                name?: string;
                options?: Array<{ id: string; name: string }>;
              }>;
            };
          };
        };
      };

      const fields = data.data?.node?.fields?.nodes ?? [];
      const statusField = fields.find((f) => f.name?.toLowerCase() === "status" && f.options);

      if (!statusField?.id || !statusField?.options) {
        return null;
      }

      const options: ProjectColumn[] = statusField.options.map((opt) => ({
        id: opt.id,
        name: opt.name,
      }));

      return {
        fieldId: statusField.id,
        fieldName: "Status",
        options,
      };
    } catch {
      return null;
    }
  }

  async getProjectFields(projectId: string): Promise<ProjectField[]> {
    // Check cache first
    const cached = this.fieldCache.get(projectId);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL_MS) {
      return cached.fields;
    }

    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 50) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  dataType
                  options {
                    id
                    name
                  }
                }
                ... on ProjectV2IterationField {
                  id
                  name
                  dataType
                }
              }
            }
          }
        }
      }
    `;

    try {
      const result = await this.githubCLI.run([
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-f",
        `projectId=${projectId}`,
      ]);

      if (!result.success) {
        throw new ProjectManagementClientError(
          result.stderr || "Failed to fetch project fields",
          this.providerId,
          "getProjectFields"
        );
      }

      const data = JSON.parse(result.stdout) as {
        data?: {
          node?: {
            fields?: {
              nodes?: Array<{
                id?: string;
                name?: string;
                dataType?: string;
                options?: Array<{ id: string; name: string }>;
              }>;
            };
          };
        };
      };

      const rawFields = data.data?.node?.fields?.nodes ?? [];
      const fields: ProjectField[] = rawFields
        .filter((f) => f.id && f.name)
        .map((f) => ({
          id: f.id!,
          name: f.name!,
          type: this.mapDataTypeToFieldType(f.dataType),
          options: f.options?.map((o) => ({ id: o.id, name: o.name })),
        }));

      // Update cache
      this.fieldCache.set(projectId, { fields, fetchedAt: Date.now() });

      return fields;
    } catch (error) {
      if (error instanceof ProjectManagementClientError) {
        throw error;
      }
      throw new ProjectManagementClientError(
        error instanceof Error ? error.message : String(error),
        this.providerId,
        "getProjectFields",
        error instanceof Error ? error : undefined
      );
    }
  }

  async getAvailableLabels(): Promise<AvailableLabelsResult> {
    const projectId = this.config?.projectId;
    if (!projectId) {
      return {
        supported: false,
        labels: [],
        error: "No project configured - labels require a GitHub Project",
      };
    }

    try {
      const fields = await this.getProjectFields(projectId);

      // Convert project fields to available labels (exclude Status)
      const labels: AvailableLabel[] = fields
        .filter((field) => field.name.toLowerCase() !== "status")
        .map((field) => ({
          name: field.name,
          validValues:
            field.type === "SINGLE_SELECT" && field.options
              ? field.options.map((o) => o.name)
              : null,
        }));

      return {
        supported: true,
        labels,
      };
    } catch (error) {
      return {
        supported: true,
        labels: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ===========================================================================
  // Label Operations
  // ===========================================================================

  async ensureLabelsExist(labels: string[]): Promise<void> {
    try {
      const existingLabels = await this.githubCLI.listLabels();
      const existingLabelSet = new Set(existingLabels.map((l) => l.toLowerCase()));

      for (const label of labels) {
        if (!existingLabelSet.has(label.toLowerCase())) {
          await this.githubCLI.createLabel(label);
        }
      }
    } catch (error) {
      throw new ProjectManagementClientError(
        error instanceof Error ? error.message : String(error),
        this.providerId,
        "ensureLabelsExist",
        error instanceof Error ? error : undefined
      );
    }
  }

  // ===========================================================================
  // Assignment
  // ===========================================================================

  async assignIssue(externalId: string, assignee: string): Promise<void> {
    try {
      const issueNumber = this.parseIssueNumber(externalId);
      await this.githubCLI.assignIssue(issueNumber, assignee);
    } catch (error) {
      throw new ProjectManagementClientError(
        error instanceof Error ? error.message : String(error),
        this.providerId,
        "assignIssue",
        error instanceof Error ? error : undefined
      );
    }
  }

  // ===========================================================================
  // Comments
  // ===========================================================================

  async addComment(externalId: string, body: string): Promise<void> {
    try {
      const issueNumber = this.parseIssueNumber(externalId);
      await this.githubCLI.commentOnIssue(issueNumber, body);
    } catch (error) {
      throw new ProjectManagementClientError(
        error instanceof Error ? error.message : String(error),
        this.providerId,
        "addComment",
        error instanceof Error ? error : undefined
      );
    }
  }

  // ===========================================================================
  // Hierarchical Issues
  // ===========================================================================

  async linkParentChild(parentRef: string, childRef: string): Promise<void> {
    try {
      const parentNumber = this.parseIssueNumber(parentRef);
      const childNumber = this.parseIssueNumber(childRef);

      // Get the child's numeric database ID (needed for sub-issues API)
      const numericId = await this.getIssueNumericId(childNumber);
      if (!numericId) {
        throw new Error(`Could not get numeric ID for issue ${childRef}`);
      }

      await this.githubCLI.linkSubIssue(parentNumber, numericId);
    } catch (error) {
      throw new ProjectManagementClientError(
        error instanceof Error ? error.message : String(error),
        this.providerId,
        "linkParentChild",
        error instanceof Error ? error : undefined
      );
    }
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  private parseIssueNumber(issueRef: string): number {
    const num = parseInt(issueRef, 10);
    if (isNaN(num) || num <= 0) {
      throw new Error(`Invalid GitHub issue reference: ${issueRef}`);
    }
    return num;
  }

  private mapGitHubIssueToExternalIssue(issue: GitHubIssueData): ExternalIssue {
    return {
      id: String(issue.number),
      numericId: issue.number,
      url: issue.url,
      nodeId: issue.nodeId,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: issue.labels,
    };
  }

  private async getIssueNumericId(issueNumber: number): Promise<number | null> {
    const query = `
      query($issueNumber: Int!) {
        repository(owner: "{owner}", name: "{repo}") {
          issue(number: $issueNumber) {
            databaseId
          }
        }
      }
    `;

    const result = await this.githubCLI.run([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `issueNumber=${issueNumber}`,
    ]);

    if (!result.success) {
      return null;
    }

    try {
      const data = JSON.parse(result.stdout) as {
        data?: { repository?: { issue?: { databaseId?: number } } };
      };
      return data.data?.repository?.issue?.databaseId ?? null;
    } catch {
      return null;
    }
  }

  private async updateProjectItemSingleSelectField(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string
  ): Promise<void> {
    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { singleSelectOptionId: $optionId }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    const result = await this.githubCLI.run([
      "api",
      "graphql",
      "-f",
      `query=${mutation}`,
      "-f",
      `projectId=${projectId}`,
      "-f",
      `itemId=${itemId}`,
      "-f",
      `fieldId=${fieldId}`,
      "-f",
      `optionId=${optionId}`,
    ]);

    if (!result.success) {
      throw new Error(`Failed to update project item field: ${result.stderr}`);
    }
  }

  private async updateProjectItemTextField(
    projectId: string,
    itemId: string,
    fieldId: string,
    text: string
  ): Promise<void> {
    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { text: $text }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    const result = await this.githubCLI.run([
      "api",
      "graphql",
      "-f",
      `query=${mutation}`,
      "-f",
      `projectId=${projectId}`,
      "-f",
      `itemId=${itemId}`,
      "-f",
      `fieldId=${fieldId}`,
      "-f",
      `text=${text}`,
    ]);

    if (!result.success) {
      throw new Error(`Failed to update project item text field: ${result.stderr}`);
    }
  }

  private async updateProjectItemNumberField(
    projectId: string,
    itemId: string,
    fieldId: string,
    num: number
  ): Promise<void> {
    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $num: Float!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { number: $num }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    const result = await this.githubCLI.run([
      "api",
      "graphql",
      "-f",
      `query=${mutation}`,
      "-f",
      `projectId=${projectId}`,
      "-f",
      `itemId=${itemId}`,
      "-f",
      `fieldId=${fieldId}`,
      "-F",
      `num=${num}`,
    ]);

    if (!result.success) {
      throw new Error(`Failed to update project item number field: ${result.stderr}`);
    }
  }

  private mapDataTypeToFieldType(dataType?: string): ProjectFieldType {
    switch (dataType) {
      case "TEXT":
        return "TEXT";
      case "NUMBER":
        return "NUMBER";
      case "DATE":
        return "DATE";
      case "SINGLE_SELECT":
        return "SINGLE_SELECT";
      case "ITERATION":
        return "ITERATION";
      default:
        return "OTHER";
    }
  }
}
