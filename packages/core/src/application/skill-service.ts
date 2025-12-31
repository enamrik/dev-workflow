import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Represents a loaded skill with name and content
 */
export interface Skill {
  readonly name: string;
  readonly content: string;
}

/**
 * SkillService loads and manages skill files
 *
 * Skills are markdown files in .track/skills/{label}.md that provide
 * contextual guidance for task execution. When a task has labels,
 * the corresponding skill files are loaded and returned as context.
 *
 * Skills define the vocabulary of available labels - labels can only
 * be assigned if a corresponding skill file exists.
 */
export class SkillService {
  private readonly skillsDirectory: string;

  constructor(trackDirectory: string) {
    this.skillsDirectory = path.join(trackDirectory, "skills");
  }

  /**
   * Load skill files for given labels
   *
   * Labels map to .track/skills/{label}.md files.
   * Missing files are silently skipped (not an error).
   *
   * @param labels - Array of skill labels to load
   * @returns Array of loaded skills with name and content
   */
  async loadSkillsForLabels(labels: string[]): Promise<Skill[]> {
    const skills: Skill[] = [];

    for (const label of labels) {
      const skillPath = path.join(this.skillsDirectory, `${label}.md`);

      try {
        const content = await fs.readFile(skillPath, "utf-8");
        skills.push({ name: label, content });
      } catch {
        // Silently skip missing skill files
        continue;
      }
    }

    return skills;
  }

  /**
   * List all available skills
   *
   * Scans the skills directory for .md files and returns
   * their names (without the .md extension).
   *
   * @returns Array of available skill names
   */
  async listAvailableSkills(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.skillsDirectory);
      return files
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(".md", ""));
    } catch {
      // Skills directory doesn't exist - return empty array
      return [];
    }
  }

  /**
   * Check if a skill exists
   *
   * @param label - Skill label to check
   * @returns true if the skill file exists
   */
  async skillExists(label: string): Promise<boolean> {
    const skillPath = path.join(this.skillsDirectory, `${label}.md`);

    try {
      await fs.access(skillPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the full path to a skill file
   *
   * @param label - Skill label
   * @returns Full path to the skill file
   */
  getSkillPath(label: string): string {
    return path.join(this.skillsDirectory, `${label}.md`);
  }
}
