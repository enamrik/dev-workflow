/**
 * createType - Create a new issue/task type definition
 *
 * Types are global (not project-scoped). Validates name format
 * and delegates to TypeService for persistence.
 */

import { z } from "zod";
import { TypeDomainService } from "../../domain/types/type-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const CreateTypeSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  keywords: z.array(z.string()).optional(),
  color: z.string().optional(),
});
export type CreateTypeInput = z.infer<typeof CreateTypeSchema>;

export interface CreateTypeResult {
  type: {
    name: string;
    displayName: string;
    description: string;
    keywords: string[];
    remoteLabel: string;
  };
  message: string;
}

// =============================================================================
// Operation
// =============================================================================

export function createType(input: CreateTypeInput) {
  return Effect.gen(function* () {
    const { name, displayName, description, keywords, color } = validateInput(
      CreateTypeSchema,
      input
    );
    const typeDomainService = yield* TypeDomainService;
    const type = typeDomainService.createType({ name, displayName, description, keywords, color });

    return {
      type: {
        name: type.name,
        displayName,
        description: type.description,
        keywords: type.keywords,
        remoteLabel: type.remoteLabel,
      },
      message: `Type '${type.name}' created successfully.`,
    } satisfies CreateTypeResult;
  });
}
