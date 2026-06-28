/**
 * PromptResolver — resolves a named, operator-customizable prompt.
 *
 * Prompts that drive worker Claude sessions are editable files so operators can
 * customize them WITHOUT rebuilding dfl. A named prompt (e.g. "worker-task") is
 * resolved by precedence, FIRST MATCH WINS:
 *
 *   1. Per-repo override:  <gitRoot>/.dfl/prompts/<name>.md
 *   2. Shared override:    <DFL_HOME-or-~/.dfl>/prompts/<name>.md
 *   3. Shipped default:    the string passed to resolve() (embedded in code).
 *
 * This is override-precedence: a per-repo file replaces a shared file, which
 * replaces the shipped default. The shipped default guarantees a fresh install
 * with no prompt files works unchanged.
 *
 * After resolving the raw template, placeholders of the form `{{key}}` are
 * replaced with the provided variable values. Replacement is a plain
 * string-substitution of KNOWN keys only — there is no eval. Unknown text
 * (including `{{unknownKey}}` not in `vars`) is left intact.
 *
 * All filesystem and path logic for prompts lives here; callers never reach for
 * fs/path themselves.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { resolveGlobalDflHome } from "@dev-workflow/git/track-directory-resolver.js";

/** Variables substituted into `{{key}}` placeholders. */
export type PromptVars = Record<string, string | number>;

/**
 * Resolve a named prompt against the override precedence and interpolate vars.
 *
 * @param name        prompt name without extension (e.g. "worker-task")
 * @param defaultText shipped default template (ultimate fallback)
 * @param vars        values for `{{key}}` placeholders
 * @param gitRoot     repo root for the per-repo override layer; when omitted,
 *                    only the shared + default layers are consulted
 */
export class PromptResolver {
  /**
   * Candidate file locations for a named prompt, in precedence order
   * (first match wins). Exposed so callers/docs can report exact paths.
   */
  candidatePaths(name: string, gitRoot?: string): string[] {
    const fileName = `${name}.md`;
    const paths: string[] = [];
    if (gitRoot) {
      paths.push(path.join(gitRoot, ".dfl", "prompts", fileName));
    }
    paths.push(path.join(resolveGlobalDflHome(), "prompts", fileName));
    return paths;
  }

  /**
   * Resolve a named prompt to its final, interpolated text.
   *
   * Reads the first existing candidate file (per-repo, then shared); falls back
   * to `defaultText` when none exist. Then substitutes `{{key}}` placeholders.
   */
  resolve(name: string, defaultText: string, vars: PromptVars = {}, gitRoot?: string): string {
    const template = this.readFirstExisting(this.candidatePaths(name, gitRoot)) ?? defaultText;
    return this.interpolate(template, vars);
  }

  /** Read the first path that exists and is readable; null if none. */
  private readFirstExisting(paths: string[]): string | null {
    for (const candidate of paths) {
      try {
        return readFileSync(candidate, "utf-8");
      } catch {
        // Missing/unreadable file → fall through to the next candidate.
      }
    }
    return null;
  }

  /**
   * Replace `{{key}}` with `vars[key]` for every KNOWN key. Unknown placeholders
   * and all other text are preserved verbatim. No eval — plain replacement.
   */
  private interpolate(template: string, vars: PromptVars): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.split(`{{${key}}}`).join(String(value));
    }
    return result;
  }
}
