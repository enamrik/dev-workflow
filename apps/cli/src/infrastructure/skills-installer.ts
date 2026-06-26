import * as os from "node:os";
import * as path from "node:path";
import type { FileSystem } from "./file-system.js";

/** The global Claude Code skills directory (loaded across all projects). */
export function globalSkillsDir(): string {
  return path.join(os.homedir(), ".claude", "skills");
}

/**
 * Install dev-workflow's skills into the GLOBAL ~/.claude/skills directory so they apply to
 * every project automatically — dev-workflow is a globally-installed tool, so there's no
 * reason to copy skills into each repo. Claude Code loads personal (~/.claude/skills) skills
 * across all projects.
 *
 * Also removes any stale per-project dwf-* skill copies (from older versions that installed
 * per-project) so the global copies are the single source of truth. Only dwf-* directories
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
  if (!(await fileSystem.exists(projectSkills))) return;
  for (const entry of await fileSystem.readdirWithFileTypes(projectSkills)) {
    if (entry.isDirectory() && entry.name.startsWith("dwf-")) {
      await fileSystem.rmdir(path.join(projectSkills, entry.name), { recursive: true });
    }
  }
}
