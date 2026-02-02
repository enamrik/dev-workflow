/**
 * updateTemplate - Update an existing template
 *
 * Updates the content of an existing issue or task template
 * at the specified scope. Validates the new content format.
 */

import { z } from "zod";
import { TemplateService } from "../../templates/template-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const UpdateTemplateSchema = z.object({
  filename: z.string(),
  content: z.string(),
  category: z.enum(["issue", "task"]).optional(),
  scope: z.enum(["local", "global"]).optional(),
});

export type UpdateTemplateInput = z.infer<typeof UpdateTemplateSchema>;

export interface UpdateTemplateResult {
  success: true;
  message: string;
  template: {
    filename: string;
    type: string;
    priority: string;
    scope: string;
    category: string;
    isUserDefined: boolean;
  };
}

// =============================================================================
// Operation
// =============================================================================

export function updateTemplate(input: UpdateTemplateInput) {
  return Effect.gen(function* () {
    const {
      filename,
      content,
      category = "issue",
      scope = "local",
    } = validateInput(UpdateTemplateSchema, input);
    const templateService = yield* TemplateService;

    const template = yield* Effect.promise(() =>
      templateService.updateTemplate(filename, content, category, scope)
    );

    return {
      success: true,
      message: `Template '${filename}' updated successfully in ${scope} ${category} templates`,
      template: {
        filename: template.filename,
        type: template.metadata.type,
        priority: template.metadata.priority,
        scope,
        category,
        isUserDefined: template.isUserDefined,
      },
    } satisfies UpdateTemplateResult;
  });
}
