/**
 * ProjectRoot Service Tag
 *
 * Makes the projectRoot string value (git root path) from the MCP container
 * yieldable in Effect generators.
 */

import { Service } from "@dev-workflow/effect";

export class ProjectRoot extends Service<string>()("projectRoot") {}
