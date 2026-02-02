/**
 * listTemplates - List available issue or task templates
 *
 * Discovers templates from local and global scopes, optionally filtered
 * by category (issue/task), scope (local/global/all), and type.
 */

import { z } from "zod";
import { TemplateService } from "../../templates/template-service.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema & Types
// =============================================================================

export const ListTemplatesSchema = z.object({
  category: z.enum(["issue", "task"]).optional(),
  scope: z.enum(["local", "global", "all"]).optional(),
  type: z.string().optional(),
});

export type ListTemplatesInput = z.infer<typeof ListTemplatesSchema>;

export interface TemplateDetail {
  filename: string;
  type: string;
  priority: string;
  description: string | undefined;
  scope: "local" | "global";
  source: "user" | "default";
}

export interface ListTemplatesResult {
  category: string;
  scope: string;
  typeFilter: string | null;
  available: string[];
  details: TemplateDetail[];
}

// =============================================================================
// Operation
// =============================================================================

export function listTemplates(input: ListTemplatesInput) {
  return Effect.gen(function* () {
    const validated = validateInput(ListTemplatesSchema, input);
    const templateService = yield* TemplateService;

    const category = validated.category ?? "issue";
    const scope = validated.scope ?? "all";
    const typeFilter = validated.type?.toUpperCase();

    // Get templates based on category
    const discovery = yield* category === "task"
      ? templateService.discoverTaskTemplates()
      : templateService.discoverTemplates();

    // Select templates based on scope
    let templates;
    if (scope === "global") {
      templates = discovery.defaultTemplates;
    } else if (scope === "local") {
      templates = discovery.userTemplates;
    } else {
      templates = discovery.merged;
    }

    // Apply type filter if specified
    if (typeFilter) {
      templates = templates.filter((t) => t.metadata.type === typeFilter);
    }

    // Map to response format with description and scope
    const details = templates.map((t) => ({
      filename: t.filename,
      type: t.metadata.type,
      priority: t.metadata.priority,
      description: t.metadata.description,
      scope: t.isUserDefined ? ("local" as const) : ("global" as const),
      source: t.isUserDefined ? ("user" as const) : ("default" as const),
    }));

    return {
      category,
      scope,
      typeFilter: typeFilter ?? null,
      available: templates.map((t) => t.filename),
      details,
    } satisfies ListTemplatesResult;
  });
}
