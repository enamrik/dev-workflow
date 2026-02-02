/**
 * deleteTemplate - Delete a template
 *
 * Deletes an issue or task template from the specified scope.
 * The template must exist at the given scope.
 */

import { z } from "zod";
import { TemplateService } from "../../templates/template-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const DeleteTemplateSchema = z.object({
  filename: z.string(),
  category: z.enum(["issue", "task"]).optional(),
  scope: z.enum(["local", "global"]).optional(),
});

export type DeleteTemplateInput = z.infer<typeof DeleteTemplateSchema>;

export interface DeleteTemplateResult {
  success: true;
  message: string;
}

// =============================================================================
// Operation
// =============================================================================

export function deleteTemplate(input: DeleteTemplateInput) {
  return Effect.gen(function* () {
    const {
      filename,
      category = "issue",
      scope = "local",
    } = validateInput(DeleteTemplateSchema, input);
    const templateService = yield* TemplateService;

    yield* templateService.deleteTemplate(filename, category, scope);

    return {
      success: true,
      message: `Template '${filename}' deleted successfully from ${scope} ${category} templates`,
    } satisfies DeleteTemplateResult;
  });
}
