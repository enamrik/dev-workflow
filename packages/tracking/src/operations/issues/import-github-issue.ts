/**
 * importGitHubIssue - Import an existing GitHub issue into dev-workflow
 *
 * Fetches a GitHub issue by number or URL, infers type and priority from
 * labels, and creates a local PLANNED issue. Emits an issue:created event
 * for real-time UI updates.
 */

import { z } from "zod";
import type { IssueType, IssuePriority } from "../../domain/issues/issue.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { GitHubCLITag } from "../../project-sync/github/github-cli.js";
import { EventBus } from "../../events/event-bus.js";
import { BusinessRuleError } from "../../domain/errors.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const ImportGitHubIssueSchema = z
  .object({
    projectSlug: z.string().min(1),
    githubIssueNumber: z.number().int().positive().optional(),
    githubIssueUrl: z.string().url().optional(),
  })
  .refine((data) => data.githubIssueNumber !== undefined || data.githubIssueUrl !== undefined, {
    message: "Either githubIssueNumber or githubIssueUrl is required",
  });
export type ImportGitHubIssueInput = z.infer<typeof ImportGitHubIssueSchema>;

export interface ImportGitHubIssueResult {
  success: boolean;
  message: string;
  issue: {
    id: string;
    number: number;
    title: string;
    type: IssueType;
    priority: IssuePriority;
    status: string;
    sourceGitHubIssueNumber: number;
  };
  githubIssue: {
    number: number;
    url: string;
    state: string;
    labels: string[];
  };
  inferred: {
    type: IssueType;
    priority: IssuePriority;
  };
}

// =============================================================================
// Label Inference Helpers
// =============================================================================

/**
 * Parse GitHub issue number from URL.
 * Matches patterns like github.com/owner/repo/issues/42
 */
function parseGitHubIssueUrl(url: string): number | null {
  const match = url.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
  if (!match?.[1]) {
    return null;
  }
  return parseInt(match[1], 10);
}

/**
 * Infer issue type from GitHub labels.
 */
function inferTypeFromLabels(labels: string[]): IssueType {
  const lowerLabels = labels.map((l) => l.toLowerCase());

  for (const label of lowerLabels) {
    if (label === "bug" || label.includes(":bug") || label.includes("bug:")) {
      return "BUG";
    }
    if (label === "feature" || label.includes(":feature") || label.includes("feature:")) {
      return "FEATURE";
    }
    if (
      label === "enhancement" ||
      label.includes(":enhancement") ||
      label.includes("enhancement:")
    ) {
      return "ENHANCEMENT";
    }
  }

  return "TASK";
}

/**
 * Infer issue priority from GitHub labels.
 */
function inferPriorityFromLabels(labels: string[]): IssuePriority {
  const lowerLabels = labels.map((l) => l.toLowerCase());

  for (const label of lowerLabels) {
    if (
      label === "critical" ||
      label === "p0" ||
      label.includes(":critical") ||
      label.includes("critical:")
    ) {
      return "CRITICAL";
    }
    if (
      label === "high" ||
      label === "p1" ||
      label.includes(":high") ||
      label.includes("high:") ||
      label === "high priority"
    ) {
      return "HIGH";
    }
    if (
      label === "low" ||
      label === "p3" ||
      label.includes(":low") ||
      label.includes("low:") ||
      label === "low priority"
    ) {
      return "LOW";
    }
  }

  return "MEDIUM";
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Import an existing GitHub issue into dev-workflow.
 *
 * 1. Validate input and resolve project domain
 * 2. Resolve GitHub issue number from URL or direct parameter
 * 3. Check if issue was already imported (prevent duplicates)
 * 4. Fetch GitHub issue via GitHubCLI
 * 5. Infer type and priority from GitHub labels
 * 6. Create local dev-workflow issue in PLANNED status
 * 7. Emit issue:created event for real-time UI updates
 */
export function importGitHubIssue(input: ImportGitHubIssueInput) {
  return Effect.gen(function* () {
    const { projectSlug, githubIssueNumber, githubIssueUrl } = validateInput(
      ImportGitHubIssueSchema,
      input
    );
    const domain = yield* DomainExecutorFactory;
    const pd = yield* domain.forProject(projectSlug);
    const githubCLI = yield* GitHubCLITag;

    // Resolve issue number from URL or direct parameter
    let resolvedIssueNumber: number;

    if (githubIssueNumber !== undefined) {
      resolvedIssueNumber = githubIssueNumber;
    } else if (githubIssueUrl) {
      const parsed = parseGitHubIssueUrl(githubIssueUrl);
      if (parsed === null) {
        return yield* Effect.fail(
          new BusinessRuleError(
            `Invalid GitHub issue URL: ${githubIssueUrl}. Expected format: https://github.com/owner/repo/issues/42`
          )
        );
      }
      resolvedIssueNumber = parsed;
    } else {
      return yield* Effect.fail(
        new BusinessRuleError("Either githubIssueNumber or githubIssueUrl is required")
      );
    }

    // Check if this issue was already imported
    const existingIssues = yield* pd.issues.findMany({ includeDeleted: false });
    const alreadyImported = existingIssues.find(
      (i) => i.sourceExternalId === String(resolvedIssueNumber)
    );
    if (alreadyImported) {
      return yield* Effect.fail(
        new BusinessRuleError(
          `GitHub issue #${resolvedIssueNumber} was already imported as dev-workflow issue #${alreadyImported.number}`
        )
      );
    }

    // Fetch GitHub issue
    const githubIssue = yield* Effect.tryPromise({
      try: () => githubCLI.getIssue(resolvedIssueNumber),
      catch: (error) =>
        new BusinessRuleError(
          `Failed to fetch GitHub issue #${resolvedIssueNumber}: ${error instanceof Error ? error.message : String(error)}`
        ),
    });

    if (!githubIssue) {
      return yield* Effect.fail(
        new BusinessRuleError(`GitHub issue #${resolvedIssueNumber} not found`)
      );
    }

    // Infer type and priority from labels
    const inferredType = inferTypeFromLabels(githubIssue.labels);
    const inferredPriority = inferPriorityFromLabels(githubIssue.labels);

    // Create dev-workflow issue
    const issue = yield* pd.issues.create({
      title: githubIssue.title,
      description: githubIssue.body || `Imported from GitHub issue #${resolvedIssueNumber}`,
      acceptanceCriteria: [],
      type: inferredType,
      priority: inferredPriority,
      status: "PLANNED",
      createdBy: "claude-code",
      sourceExternalId: String(resolvedIssueNumber),
    });

    // Emit issue:created event for real-time UI updates
    const eventBus = EventBus.getInstance();
    eventBus.emit("issue:created", {
      issueId: issue.id,
      issueNumber: issue.number,
    });

    return {
      success: true,
      message: `Imported GitHub issue #${resolvedIssueNumber} as dev-workflow issue #${issue.number}`,
      issue: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        type: issue.type,
        priority: issue.priority,
        status: issue.status,
        sourceGitHubIssueNumber: resolvedIssueNumber,
      },
      githubIssue: {
        number: githubIssue.number,
        url: githubIssue.url,
        state: githubIssue.state,
        labels: githubIssue.labels,
      },
      inferred: {
        type: inferredType,
        priority: inferredPriority,
      },
    } satisfies ImportGitHubIssueResult;
  });
}
