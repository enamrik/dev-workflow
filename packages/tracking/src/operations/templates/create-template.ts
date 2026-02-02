/**
 * createTemplate - Create a new template
 *
 * Creates a new issue or task template at the specified scope.
 * Content must be valid markdown with YAML frontmatter.
 */

import { z } from "zod";
import { TemplateService } from "../../templates/template-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const CreateTemplateSchema = z.object({
  filename: z.string(),
  content: z.string(),
  category: z.enum(["issue", "task"]).optional(),
  scope: z.enum(["local", "global"]).optional(),
});

export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;

export interface CreateTemplateResult {
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

export function createTemplate(input: CreateTemplateInput) {
  return Effect.gen(function* () {
    const {
      filename,
      content,
      category = "issue",
      scope = "local",
    } = validateInput(CreateTemplateSchema, input);
    const templateService = yield* TemplateService;

    const template = yield* templateService.createTemplate(filename, content, category, scope);

    return {
      success: true,
      message: `Template '${filename}' created successfully in ${scope} ${category} templates`,
      template: {
        filename: template.filename,
        type: template.metadata.type,
        priority: template.metadata.priority,
        scope,
        category,
        isUserDefined: template.isUserDefined,
      },
    } satisfies CreateTemplateResult;
  });
}
