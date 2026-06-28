import * as os from "node:os";
import * as path from "node:path";
import { realpathSync } from "node:fs";
import type { FileSystem } from "./file-system.js";

/**
 * Canonicalize a path so two spellings of the same location compare equal even across
 * symlinked ancestors (e.g. macOS /tmp → /private/tmp). Resolves the real path of the nearest
 * existing ancestor and re-appends the remaining, not-yet-created segments.
 */
function canonicalize(target: string): string {
  let current = path.resolve(target);
  const tail: string[] = [];
  // Walk up until we hit a path that exists on disk, then realpath that and re-append the tail.
  for (;;) {
    try {
      return path.join(realpathSync(current), ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target); // reached root, give up
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * The global Claude Code skills directory (loaded across all projects).
 *
 * Honors CLAUDE_CONFIG_DIR — Claude Code's own override for its config home (normally
 * ~/.claude) — so we install skills exactly where Claude reads them, and so sandboxed test
 * runs that relocate CLAUDE_CONFIG_DIR stay fully isolated from the real ~/.claude.
 */
export function globalSkillsDir(): string {
  const configDir = process.env["CLAUDE_CONFIG_DIR"];
  const base = configDir ? path.resolve(configDir) : path.join(os.homedir(), ".claude");
  return path.join(base, "skills");
}

/**
 * Install dev-workflow's skills into the GLOBAL ~/.claude/skills directory so they apply to
 * every project automatically — dev-workflow is a globally-installed tool, so there's no
 * reason to copy skills into each repo. Claude Code loads personal (~/.claude/skills) skills
 * across all projects.
 *
 * Also removes any stale per-project dfl-* skill copies (from older versions that installed
 * per-project) so the global copies are the single source of truth. Only dfl-* directories
 * are touched; other project skills are left alone.
 */
export async function installSkillsGlobally(
  fileSystem: FileSystem,
  packageRoot: string,
  projectDir?: string
): Promise<void> {
  const source = path.join(packageRoot, "skills");
  const target = globalSkillsDir();
  await fileSystem.mkdir(target, { recursive: true });
  await fileSystem.copyDirectory(source, target);

  if (projectDir) {
    await removeStaleProjectSkills(fileSystem, projectDir);
  }
}

async function removeStaleProjectSkills(fileSystem: FileSystem, projectDir: string): Promise<void> {
  const projectSkills = path.join(projectDir, ".claude", "skills");
  // When CLAUDE_CONFIG_DIR points at <projectDir>/.claude (e.g. an isolated E2E run), the
  // "global" skills target and this per-project dir are the SAME path — pruning dfl-* here would
  // delete the skills we just installed. Skip in that case; there are no stale copies to clean.
  if (canonicalize(projectSkills) === canonicalize(globalSkillsDir())) return;
  if (!(await fileSystem.exists(projectSkills))) return;
  for (const entry of await fileSystem.readdirWithFileTypes(projectSkills)) {
    if (entry.isDirectory() && entry.name.startsWith("dfl-")) {
      await fileSystem.rmdir(path.join(projectSkills, entry.name), { recursive: true });
    }
  }
}
