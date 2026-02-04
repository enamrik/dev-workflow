/**
 * Task Body Builder - Utilities for building external issue bodies and labels
 *
 * Pure functions for body/label construction used by operations.
 * Used by operations that create external issues for tasks.
 */

import type { Issue } from "../domain/issues/issue.js";
import type { Task } from "../domain/tasks/task.js";
import type { TemplateService } from "../templates/template-service.js";
import type { TypeDomainService } from "../domain/types/type-service.js";
import type { ProjectManagementService } from "./project-management-service.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Pure Functions (no deps)
// =============================================================================

/**
 * Build default task body (fallback when no template)
 */
export function buildDefaultTaskBody(issue: Issue, task: Task): string {
  const sections: string[] = [task.description];

  if (task.acceptanceCriteria.length > 0) {
    sections.push("\n## Acceptance Criteria\n");
    for (const criterion of task.acceptanceCriteria) {
      sections.push(`- [ ] ${criterion}`);
    }
  }

  // Add dev-workflow reference as unobtrusive footer note
  sections.push("");
  sections.push("---");
  sections.push(`Task ${issue.number}.${task.number}: ${task.title}`);

  return sections.join("\n");
}

/**
 * Apply placeholders to task template content
 */
export function applyTaskPlaceholders(content: string, issue: Issue, task: Task): string {
  let result = content;

  // Replace {{description}}
  result = result.replace(/\{\{description\}\}/g, task.description);

  // Replace {{acceptanceCriteria}}
  const criteriaList =
    task.acceptanceCriteria.length > 0
      ? task.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n")
      : "_No acceptance criteria defined._";
  result = result.replace(/\{\{acceptanceCriteria\}\}/g, criteriaList);

  // Replace {{parentIssueLink}}
  const parentLink = `dev-workflow issue #${issue.number}: ${issue.title}`;
  result = result.replace(/\{\{parentIssueLink\}\}/g, parentLink);

  return result;
}

/**
 * Append dev-workflow footer to body
 */
export function appendFooter(body: string, issue: Issue, task: Task): string {
  return `${body}\n\n---\nTask ${issue.number}.${task.number}: ${task.title}`;
}

// =============================================================================
// Effect Functions (need service deps)
// =============================================================================

/**
 * Build the external issue body for a task.
 * Tries template first (via TemplateService), falls back to default format.
 *
 * @param issue - The parent dev-workflow issue
 * @param task - The task to build a body for
 * @param templateService - Optional TemplateService for template-based body generation
 * @returns Effect that resolves to the body string
 */
export function buildTaskBody(
  issue: Issue,
  task: Task,
  templateService?: TemplateService
): Effect<string> {
  return Effect.gen(function* () {
    // Try template if TemplateService is available
    if (templateService) {
      try {
        const template = yield* templateService.getTaskTemplate(task.type);
        if (template) {
          const body = applyTaskPlaceholders(template.content, issue, task);
          return appendFooter(body, issue, task);
        }
      } catch {
        console.warn(
          `Failed to load task template for type ${task.type}, falling back to default format`
        );
      }
    }

    return buildDefaultTaskBody(issue, task);
  });
}

/**
 * Build labels array from task type.
 * Looks up remote label via TypeDomainService, adds custom labels from PM config.
 *
 * @param taskType - The task type name (e.g., "FEATURE", "BUG")
 * @param pm - The ProjectManagementService for custom labels
 * @param typeDomainService - Optional TypeDomainService for remote label lookup
 * @returns Effect that resolves to array of label strings
 */
export function buildTaskLabels(
  taskType: string,
  pm: ProjectManagementService,
  typeDomainService?: TypeDomainService
): Effect<string[]> {
  return Effect.gen(function* () {
    const labels: string[] = [];

    // Look up the remote label for this task type via TypeDomainService
    let typeLabel: string | undefined;

    if (typeDomainService) {
      try {
        const typeDef = yield* typeDomainService.getTypeByName(taskType);
        if (typeDef) {
          typeLabel = typeDef.remoteLabel;
        }
      } catch {
        console.warn(`Failed to look up type ${taskType}, falling back to lowercase`);
      }
    }

    // Fallback to lowercase type name
    if (!typeLabel) {
      typeLabel = taskType.toLowerCase();
    }
    labels.push(typeLabel);

    // Add custom labels from provider config
    labels.push(...pm.getCustomLabels());

    // Add a "task" label to distinguish task issues from regular issues
    labels.push("task");

    return labels;
  });
}
