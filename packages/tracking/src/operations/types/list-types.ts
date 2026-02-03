/**
 * listTypes - List all available issue/task types
 *
 * Types are global (not project-scoped). Returns type definitions
 * with name, description, and remote label for GitHub sync.
 */

import { TypeDomainService } from "../../domain/types/type-service.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Types
// =============================================================================

export interface TypeInfo {
  name: string;
  description: string;
  remoteLabel: string;
}

export interface ListTypesResult {
  types: TypeInfo[];
  message: string;
}

// =============================================================================
// Operation
// =============================================================================

export function listTypes() {
  return Effect.gen(function* () {
    const typeDomainService = yield* TypeDomainService;
    const types = yield* typeDomainService.getTypes();

    return {
      types: types.map((t) => ({
        name: t.name,
        description: t.description,
        remoteLabel: t.remoteLabel,
      })),
      message: `${types.length} type(s) available. Use these values for the 'type' field in generate_plan tasks.`,
    } satisfies ListTypesResult;
  });
}
