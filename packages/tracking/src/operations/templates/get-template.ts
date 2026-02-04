/**
 * getTemplate - Get a single template by filename
 *
 * Retrieves template content and metadata, optionally filtered
 * by category (issue/task) and scope (local/global).
 */

import { z } from "zod";
import { TemplateService } from "../../templates/template-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";
import { EntityNotFoundError } from "../../domain/errors.js";

// =============================================================================
// Schema & Types
// =============================================================================

export const GetTemplateSchema = z.object({
  filename: z.string(),
  category: z.enum(["issue", "task"]).optional(),
  scope: z.enum(["local", "global"]).optional(),
});

export type GetTemplateInput = z.infer<typeof GetTemplateSchema>;

export interface GetTemplateResult {
  category: string;
  filename: string;
  source: "user" | "default";
  scope: "local" | "global";
  content: string;
  metadata: {
    type: string;
    priority: string;
    description: string | undefined;
  };
  isUserDefined: boolean;
}

// =============================================================================
// Operation
// =============================================================================

export function getTemplate(input: GetTemplateInput) {
  return Effect.gen(function* () {
    const { filename, category = "issue", scope } = validateInput(GetTemplateSchema, input);
    const templateService = yield* TemplateService;

    const result = yield* templateService.getTemplate(filename, category, scope);

    if (!result) {
      const scopeLabel = scope ? `${scope} ` : "";
      return yield* Effect.fail(
        new EntityNotFoundError("Template", `${filename} in ${scopeLabel}${category} templates`)
      );
    }

    return {
      category,
      filename: result.template.filename,
      source: result.source,
      scope: result.template.isUserDefined ? "local" : "global",
      content: result.template.rawContent,
      metadata: {
        type: result.template.metadata.type,
        priority: result.template.metadata.priority,
        description: result.template.metadata.description,
      },
      isUserDefined: result.template.isUserDefined,
    } satisfies GetTemplateResult;
  });
}
