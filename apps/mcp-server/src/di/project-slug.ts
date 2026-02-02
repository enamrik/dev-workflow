/**
 * ProjectSlug Service Tag
 *
 * Makes the projectSlug string value from the MCP container
 * yieldable in Effect generators.
 */

import { Service } from "@dev-workflow/effect";

export class ProjectSlug extends Service<string>()("projectSlug") {}
