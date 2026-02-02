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
import { Effect } from "@dev-workflow/effect";
import type { GitHubCLI, GitHubIssueData } from "./github-cli.js";
import type { ProjectManagementConfig } from "../project-management-config.js";
import { DEFAULT_COLUMN_MAPPING } from "@dev-workflow/database/schema.js";

/**
 * Convert an Effect with a typed error channel to one with never error channel.
 * The typed error is re-thrown as a regular exception.
 * This is needed because GitHubCLI methods return Effect<T, GitHubCLIError>
 * but the ProjectManagementClient interface declares Effect<T> (= Effect<T, never>).
 */
function rethrow<A>(effect: Effect<A, unknown>): Effect<A> {
  return Effect.catchAll(effect, (e: unknown) => {
    throw e;
  });
}

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

  checkAuth(): Effect<AuthResult> {
    const self = this;
    return Effect.gen(function* () {
      try {
        const authenticated = yield* self.githubCLI.checkAuth();
        if (authenticated) {
          return { authenticated: true } as AuthResult;
        }
        return {
          authenticated: false,
          error: "GitHub CLI is not authenticated. Run 'gh auth login' to authenticate.",
        } as AuthResult;
      } catch (error) {
        return {
          authenticated: false,
          error: `Authentication check failed: ${error instanceof Error ? error.message : String(error)}`,
        } as AuthResult;
      }
    });
  }

  checkRepository(): Effect<RepositoryResult> {
    const self = this;
    return Effect.gen(function* () {
      try {
        const accessible = yield* self.githubCLI.checkCurrentRepository();
        if (accessible) {
          return { accessible: true } as RepositoryResult;
        }
        return {
          accessible: false,
          error: "Not in a Git repository with a GitHub remote.",
        } as RepositoryResult;
      } catch (error) {
        return {
          accessible: false,
          error: `Repository check failed: ${error instanceof Error ? error.message : String(error)}`,
        } as RepositoryResult;
      }
    });
  }

  // ===========================================================================
  // Issue Operations (Low-Level API Calls)
  // ===========================================================================

  createIssue(params: CreateIssueParams): Effect<ExternalIssue> {
    const self = this;
    return rethrow(
      Effect.gen(function* () {
        try {
          const githubIssue = yield* self.githubCLI.createIssue(
            params.title,
            params.body,
            params.labels
          );
          return self.mapGitHubIssueToExternalIssue(githubIssue);
        } catch (error) {
          throw new ProjectManagementClientError(
            error instanceof Error ? error.message : String(error),
            self.providerId,
            "createIssue",
            error instanceof Error ? error : undefined
          );
        }
      })
    );
  }

  closeIssue(externalId: string, comment?: string): Effect<void> {
    const self = this;
    const issueNumber = this.parseIssueNumber(externalId);
    return rethrow(
      Effect.gen(function* () {
        try {
          if (comment) {
            yield* self.githubCLI.closeIssueWithComment(issueNumber, comment);
          } else {
            yield* self.githubCLI.closeIssue(issueNumber);
          }
        } catch (error) {
          throw new ProjectManagementClientError(
            error instanceof Error ? error.message : String(error),
            self.providerId,
            "closeIssue",
            error instanceof Error ? error : undefined
          );
        }
      })
    );
  }

  reopenIssue(externalId: string): Effect<void> {
    const self = this;
    const issueNumber = this.parseIssueNumber(externalId);
    return rethrow(
      Effect.gen(function* () {
        try {
          yield* self.githubCLI.reopenIssue(issueNumber);
        } catch (error) {
          throw new ProjectManagementClientError(
            error instanceof Error ? error.message : String(error),
            self.providerId,
            "reopenIssue",
            error instanceof Error ? error : undefined
          );
        }
      })
    );
  }

  getIssue(externalId: string): Effect<ExternalIssue | null> {
    const self = this;
    const issueNumber = this.parseIssueNumber(externalId);
    return rethrow(
      Effect.gen(function* () {
        try {
          const githubIssue = yield* self.githubCLI.getIssue(issueNumber);
          if (!githubIssue) {
            return null;
          }
          return self.mapGitHubIssueToExternalIssue(githubIssue);
        } catch (error) {
          throw new ProjectManagementClientError(
            error instanceof Error ? error.message : String(error),
            self.providerId,
            "getIssue",
            error instanceof Error ? error : undefined
          );
        }
      })
    );
  }

  searchIssues(
    query: string,
    state: "open" | "closed" | "all" = "all",
    limit = 10
  ): Effect<ExternalIssue[]> {
    const self = this;
    return rethrow(
      Effect.gen(function* () {
        try {
          const githubIssues = yield* self.githubCLI.searchIssues(query, state, limit);
          return githubIssues.map((issue) => self.mapGitHubIssueToExternalIssue(issue));
        } catch (error) {
          throw new ProjectManagementClientError(
            error instanceof Error ? error.message : String(error),
            self.providerId,
            "searchIssues",
            error instanceof Error ? error : undefined
          );
        }
      })
    );
  }

  // ===========================================================================
  // Project/Board Operations (Low-Level API Calls)
  // ===========================================================================

  addToProject(nodeId: string, projectId: string): Effect<ProjectItemResult> {
    const self = this;
    return rethrow(
      Effect.gen(function* () {
        try {
          const itemId = yield* self.githubCLI.addToProject(projectId, nodeId);
          return {
            success: true,
            itemId,
          } as ProjectItemResult;
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          } as ProjectItemResult;
        }
      })
    );
  }

  moveToColumn(itemId: string, projectId: string, columnName: string): Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      try {
        // Get the project's Status field info
        const fieldInfo = yield* self.getProjectStatusField(projectId);
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
        yield* self.updateProjectItemSingleSelectField(
          projectId,
          itemId,
          fieldInfo.fieldId,
          option.id
        );
      } catch (error) {
        throw new ProjectManagementClientError(
          error instanceof Error ? error.message : String(error),
          self.providerId,
          "moveToColumn",
          error instanceof Error ? error : undefined
        );
      }
    });
  }

  setProjectItemField(
    projectId: string,
    itemId: string,
    fieldId: string,
    value: string
  ): Effect<SetFieldResult> {
    const self = this;
    return Effect.gen(function* () {
      try {
        // Get field metadata to determine type and resolve options
        const fields = yield* self.getProjectFields(projectId);
        const field = fields.find((f) => f.id === fieldId);

        if (!field) {
          return {
            success: false,
            error: `Field ${fieldId} not found in project ${projectId}`,
          } as SetFieldResult;
        }

        if (field.type === "SINGLE_SELECT") {
          // Resolve value to option ID (case-insensitive)
          const option = field.options?.find((o) => o.name.toLowerCase() === value.toLowerCase());

          if (!option) {
            return {
              success: false,
              error: `Option "${value}" not found for field "${field.name}". Available options: ${field.options?.map((o) => o.name).join(", ")}`,
            } as SetFieldResult;
          }

          yield* self.updateProjectItemSingleSelectField(projectId, itemId, fieldId, option.id);
        } else if (field.type === "TEXT") {
          yield* self.updateProjectItemTextField(projectId, itemId, fieldId, value);
        } else if (field.type === "NUMBER") {
          const numValue = parseFloat(value);
          if (isNaN(numValue)) {
            return {
              success: false,
              error: `Invalid number value "${value}" for field "${field.name}"`,
            } as SetFieldResult;
          }
          yield* self.updateProjectItemNumberField(projectId, itemId, fieldId, numValue);
        } else {
          return {
            success: false,
            error: `Unsupported field type "${field.type}" for field "${field.name}"`,
          } as SetFieldResult;
        }

        return { success: true } as SetFieldResult;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        } as SetFieldResult;
      }
    });
  }

  clearProjectItemField(
    projectId: string,
    itemId: string,
    fieldId: string
  ): Effect<SetFieldResult> {
    const self = this;
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

    return Effect.gen(function* () {
      try {
        const result = yield* self.githubCLI.run([
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
          } as SetFieldResult;
        }

        return { success: true } as SetFieldResult;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        } as SetFieldResult;
      }
    });
  }

  // ===========================================================================
  // Project Metadata Operations
  // ===========================================================================

  checkProject(projectId: string): Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      try {
        return yield* self.githubCLI.checkProject(projectId);
      } catch {
        return false;
      }
    });
  }

  getProjectDetails(projectId: string): Effect<ProjectDetails | null> {
    const self = this;
    return Effect.gen(function* () {
      try {
        const details = yield* self.githubCLI.getProjectDetails(projectId);
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
    });
  }

  getProjectStatusField(projectId: string): Effect<ProjectStatusField | null> {
    const self = this;
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

    return Effect.gen(function* () {
      try {
        const result = yield* self.githubCLI.run([
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
    });
  }

  getProjectFields(projectId: string): Effect<ProjectField[]> {
    const self = this;

    // Check cache first
    const cached = this.fieldCache.get(projectId);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL_MS) {
      return Effect.succeed(cached.fields);
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

    return Effect.gen(function* () {
      try {
        const result = yield* self.githubCLI.run([
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
            self.providerId,
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
            type: self.mapDataTypeToFieldType(f.dataType),
            options: f.options?.map((o) => ({ id: o.id, name: o.name })),
          }));

        // Update cache
        self.fieldCache.set(projectId, { fields, fetchedAt: Date.now() });

        return fields;
      } catch (error) {
        if (error instanceof ProjectManagementClientError) {
          throw error;
        }
        throw new ProjectManagementClientError(
          error instanceof Error ? error.message : String(error),
          self.providerId,
          "getProjectFields",
          error instanceof Error ? error : undefined
        );
      }
    });
  }

  getAvailableLabels(): Effect<AvailableLabelsResult> {
    const self = this;
    const projectId = this.config?.projectId;
    if (!projectId) {
      return Effect.succeed({
        supported: false,
        labels: [],
        error: "No project configured - labels require a GitHub Project",
      });
    }

    return Effect.gen(function* () {
      try {
        const fields = yield* self.getProjectFields(projectId);

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
        } as AvailableLabelsResult;
      } catch (error) {
        return {
          supported: true,
          labels: [],
          error: error instanceof Error ? error.message : String(error),
        } as AvailableLabelsResult;
      }
    });
  }

  // ===========================================================================
  // Label Operations
  // ===========================================================================

  ensureLabelsExist(labels: string[]): Effect<void> {
    const self = this;
    return rethrow(
      Effect.gen(function* () {
        try {
          const existingLabels = yield* self.githubCLI.listLabels();
          const existingLabelSet = new Set(existingLabels.map((l) => l.toLowerCase()));

          for (const label of labels) {
            if (!existingLabelSet.has(label.toLowerCase())) {
              yield* self.githubCLI.createLabel(label);
            }
          }
        } catch (error) {
          throw new ProjectManagementClientError(
            error instanceof Error ? error.message : String(error),
            self.providerId,
            "ensureLabelsExist",
            error instanceof Error ? error : undefined
          );
        }
      })
    );
  }

  // ===========================================================================
  // Assignment
  // ===========================================================================

  assignIssue(externalId: string, assignee: string): Effect<void> {
    const self = this;
    const issueNumber = this.parseIssueNumber(externalId);
    return rethrow(
      Effect.gen(function* () {
        try {
          yield* self.githubCLI.assignIssue(issueNumber, assignee);
        } catch (error) {
          throw new ProjectManagementClientError(
            error instanceof Error ? error.message : String(error),
            self.providerId,
            "assignIssue",
            error instanceof Error ? error : undefined
          );
        }
      })
    );
  }

  // ===========================================================================
  // Comments
  // ===========================================================================

  addComment(externalId: string, body: string): Effect<void> {
    const self = this;
    const issueNumber = this.parseIssueNumber(externalId);
    return rethrow(
      Effect.gen(function* () {
        try {
          yield* self.githubCLI.commentOnIssue(issueNumber, body);
        } catch (error) {
          throw new ProjectManagementClientError(
            error instanceof Error ? error.message : String(error),
            self.providerId,
            "addComment",
            error instanceof Error ? error : undefined
          );
        }
      })
    );
  }

  // ===========================================================================
  // Hierarchical Issues
  // ===========================================================================

  linkParentChild(parentRef: string, childRef: string): Effect<void> {
    const self = this;
    return rethrow(
      Effect.gen(function* () {
        try {
          const parentNumber = self.parseIssueNumber(parentRef);
          const childNumber = self.parseIssueNumber(childRef);

          // Get the child's numeric database ID (needed for sub-issues API)
          const numericId = yield* self.getIssueNumericId(childNumber);
          if (!numericId) {
            throw new Error(`Could not get numeric ID for issue ${childRef}`);
          }

          yield* self.githubCLI.linkSubIssue(parentNumber, numericId);
        } catch (error) {
          throw new ProjectManagementClientError(
            error instanceof Error ? error.message : String(error),
            self.providerId,
            "linkParentChild",
            error instanceof Error ? error : undefined
          );
        }
      })
    );
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

  private getIssueNumericId(issueNumber: number): Effect<number | null> {
    const self = this;
    const query = `
      query($issueNumber: Int!) {
        repository(owner: "{owner}", name: "{repo}") {
          issue(number: $issueNumber) {
            databaseId
          }
        }
      }
    `;

    return Effect.gen(function* () {
      const result = yield* self.githubCLI.run([
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
    });
  }

  private updateProjectItemSingleSelectField(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string
  ): Effect<void> {
    const self = this;
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

    return Effect.gen(function* () {
      const result = yield* self.githubCLI.run([
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
    });
  }

  private updateProjectItemTextField(
    projectId: string,
    itemId: string,
    fieldId: string,
    text: string
  ): Effect<void> {
    const self = this;
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

    return Effect.gen(function* () {
      const result = yield* self.githubCLI.run([
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
    });
  }

  private updateProjectItemNumberField(
    projectId: string,
    itemId: string,
    fieldId: string,
    num: number
  ): Effect<void> {
    const self = this;
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

    return Effect.gen(function* () {
      const result = yield* self.githubCLI.run([
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
    });
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
