/**
 * createIssue - Create a new issue in PLANNED status
 *
 * Optionally selects a template for metadata defaults.
 * GitHub sync happens at the task level when the issue is activated.
 */

import { z } from "zod";
import type { Issue, IssueType, IssuePriority } from "../../domain/issues/issue.js";
import { DomainExecutorFactory } from "../../domain/domain-executor.js";
import { TypeDomainService } from "../../domain/types/type-service.js";
import { BusinessRuleError } from "../../domain/errors.js";
import { TemplateService } from "../../templates/template-service.js";
import { EventBus } from "../../events/event-bus.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const CreateIssueSchema = z.object({
  projectSlug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).optional().default([]),
  type: z.string().optional(),
  priority: z.string().optional().default("MEDIUM"),
  useTemplate: z.boolean().optional().default(true),
  labels: z.record(z.string(), z.string()).optional(),
  createdBy: z.string().optional().default("claude-code"),
});
export type CreateIssueInput = z.infer<typeof CreateIssueSchema>;

export interface CreateIssueResult {
  issue: Issue;
  templateUsed: string | undefined;
}

// =============================================================================
// Operation
// =============================================================================

/**
 * Create a new issue in PLANNED status.
 *
 * 1. Validate input and resolve project domain
 * 2. Optionally select a template for type/priority defaults
 * 3. Create issue via domain service
 * 4. Emit issue:created event
 */
export function createIssue(input: CreateIssueInput) {
  return Effect.gen(function* () {
    const {
      projectSlug,
      title,
      description,
      acceptanceCriteria,
      type,
      priority,
      useTemplate,
      labels,
      createdBy,
    } = validateInput(CreateIssueSchema, input);

    const domain = yield* DomainExecutorFactory;
    const pd = yield* domain.forProject(projectSlug);
    const eventBus = yield* EventBus;

    // Select template if requested and use metadata as defaults
    let templateUsed: string | undefined;
    let finalType: IssueType | undefined = type;
    let finalPriority: IssuePriority = priority as IssuePriority;

    if (useTemplate) {
      const templateService = yield* TemplateService;
      try {
        const template = yield* templateService.selectTemplate(description);
        templateUsed = template.filename;

        // Use template metadata as defaults (if not explicitly provided)
        if (!finalType) {
          finalType = template.metadata.type;
        }
        if (priority === "MEDIUM") {
          // Only override if using default priority
          finalPriority = template.metadata.priority;
        }
      } catch {
        // Log error but continue without template
        console.error("Failed to select template, continuing without template");
      }
    }

    const resolvedType: IssueType = finalType || "FEATURE";

    // Validate the resolved type against available types
    if (type) {
      const typeDomainService = yield* TypeDomainService;
      const isValid = yield* typeDomainService.isValidType(resolvedType);
      if (!isValid) {
        const types = yield* typeDomainService.getTypes();
        const availableNames = types.map((t) => t.name).join(", ");
        return yield* Effect.fail(
          new BusinessRuleError(`Invalid type: ${resolvedType}. Available types: ${availableNames}`)
        );
      }
    }

    // Create issue in PLANNED status
    const issue = yield* pd.issues.create({
      title,
      description,
      acceptanceCriteria,
      type: resolvedType,
      priority: finalPriority,
      status: "PLANNED",
      templateUsed,
      createdBy,
      labels,
    });

    eventBus.emit("issue:created", {
      issueId: issue.id,
      issueNumber: issue.number,
    });

    return { issue, templateUsed } satisfies CreateIssueResult;
  });
}
