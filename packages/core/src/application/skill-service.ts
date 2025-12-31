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

  /**
   * Get a skill by name
   *
   * @param name - Skill name (without .md extension)
   * @returns Skill with name and content, or null if not found
   */
  async getSkill(name: string): Promise<Skill | null> {
    const skillPath = this.getSkillPath(name);

    try {
      const content = await fs.readFile(skillPath, "utf-8");
      return { name, content };
    } catch {
      return null;
    }
  }

  /**
   * Create a new skill
   *
   * @param name - Skill name (without .md extension)
   * @param content - Skill content (markdown)
   * @returns The created skill
   * @throws Error if skill already exists
   */
  async createSkill(name: string, content: string): Promise<Skill> {
    // Validate skill name (alphanumeric, hyphens, underscores only)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(
        `Invalid skill name: "${name}". Use only letters, numbers, hyphens, and underscores.`
      );
    }

    const skillPath = this.getSkillPath(name);

    // Check if skill already exists
    if (await this.skillExists(name)) {
      throw new Error(`Skill "${name}" already exists. Use updateSkill to modify it.`);
    }

    // Ensure skills directory exists
    await fs.mkdir(this.skillsDirectory, { recursive: true });

    // Write the skill file
    await fs.writeFile(skillPath, content, "utf-8");

    return { name, content };
  }

  /**
   * Update an existing skill
   *
   * @param name - Skill name (without .md extension)
   * @param content - New skill content (markdown)
   * @returns The updated skill
   * @throws Error if skill does not exist
   */
  async updateSkill(name: string, content: string): Promise<Skill> {
    const skillPath = this.getSkillPath(name);

    // Check if skill exists
    if (!(await this.skillExists(name))) {
      throw new Error(`Skill "${name}" does not exist. Use createSkill to create it.`);
    }

    // Write the updated content
    await fs.writeFile(skillPath, content, "utf-8");

    return { name, content };
  }

  /**
   * Remove a skill
   *
   * @param name - Skill name (without .md extension)
   * @throws Error if skill does not exist
   */
  async removeSkill(name: string): Promise<void> {
    const skillPath = this.getSkillPath(name);

    // Check if skill exists
    if (!(await this.skillExists(name))) {
      throw new Error(`Skill "${name}" does not exist.`);
    }

    // Delete the skill file
    await fs.unlink(skillPath);
  }
}
