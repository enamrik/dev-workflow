/**
 * deleteType - Soft-delete a type definition
 *
 * Types are global (not project-scoped). Soft deletes the type
 * so existing records referencing it are preserved.
 */

import { z } from "zod";
import { TypeDomainService } from "../../domain/types/type-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const DeleteTypeSchema = z.object({
  name: z.string(),
});
export type DeleteTypeInput = z.infer<typeof DeleteTypeSchema>;

export interface DeleteTypeResult {
  type: {
    name: string;
    description: string;
  };
  message: string;
}

// =============================================================================
// Operation
// =============================================================================

export function deleteType(input: DeleteTypeInput) {
  return Effect.gen(function* () {
    const { name } = validateInput(DeleteTypeSchema, input);
    const typeDomainService = yield* TypeDomainService;
    const type = typeDomainService.deleteType(name);

    return {
      type: {
        name: type.name,
        description: type.description,
      },
      message: `Type '${type.name}' deleted successfully. Existing records are preserved.`,
    } satisfies DeleteTypeResult;
  });
}
