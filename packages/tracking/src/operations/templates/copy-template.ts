/**
 * copyTemplate - Copy a template between scopes
 *
 * Copies an issue or task template from one scope to another
 * (e.g., global to local for customization).
 */

import { z } from "zod";
import { TemplateService } from "../../templates/template-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const CopyTemplateSchema = z.object({
  filename: z.string(),
  category: z.enum(["issue", "task"]),
  fromScope: z.enum(["local", "global"]),
  toScope: z.enum(["local", "global"]),
});

export type CopyTemplateInput = z.infer<typeof CopyTemplateSchema>;

export interface CopyTemplateResult {
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

export function copyTemplate(input: CopyTemplateInput) {
  return Effect.gen(function* () {
    const { filename, category, fromScope, toScope } = validateInput(CopyTemplateSchema, input);
    const templateService = yield* TemplateService;

    const template = yield* Effect.promise(() =>
      templateService.copyTemplate(filename, category, fromScope, toScope)
    );

    return {
      success: true,
      message: `Template '${filename}' copied from ${fromScope} to ${toScope} ${category} templates`,
      template: {
        filename: template.filename,
        type: template.metadata.type,
        priority: template.metadata.priority,
        scope: toScope,
        category,
        isUserDefined: template.isUserDefined,
      },
    } satisfies CopyTemplateResult;
  });
}
