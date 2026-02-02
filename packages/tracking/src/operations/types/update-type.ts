/**
 * updateType - Update an existing type definition
 *
 * Types are global (not project-scoped). Supports updating
 * displayName, description, keywords, and color.
 */

import { z } from "zod";
import { TypeService } from "../../domain/types/type-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const UpdateTypeSchema = z.object({
  name: z.string(),
  updates: z.object({
    displayName: z.string().optional(),
    description: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    color: z.string().nullable().optional(),
  }),
});
export type UpdateTypeInput = z.infer<typeof UpdateTypeSchema>;

export interface UpdateTypeResult {
  type: {
    name: string;
    description: string;
    keywords: string[];
    remoteLabel: string;
  };
  message: string;
}

// =============================================================================
// Operation
// =============================================================================

export function updateType(input: UpdateTypeInput) {
  return Effect.gen(function* () {
    const { name, updates } = validateInput(UpdateTypeSchema, input);
    const typeService = yield* TypeService;
    const type = typeService.updateType(name, updates);

    return {
      type: {
        name: type.name,
        description: type.description,
        keywords: type.keywords,
        remoteLabel: type.remoteLabel,
      },
      message: `Type '${type.name}' updated successfully.`,
    } satisfies UpdateTypeResult;
  });
}
