import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Represents a loaded label with name and content
 */
export interface Label {
  readonly name: string;
  readonly content: string;
}

/**
 * LabelService loads and manages label files
 *
 * Labels are markdown files in ./track/labels/{label}.md that provide
 * contextual guidance for task execution. When a task has labels,
 * the corresponding label files are loaded and returned as context.
 *
 * Labels are stored locally per-project (no global fallback).
 * Labels define the vocabulary of available task labels - labels can only
 * be assigned if a corresponding label file exists.
 */
export class LabelService {
  private readonly labelsDirectory: string;

  constructor(trackDirectory: string) {
    this.labelsDirectory = path.join(trackDirectory, "labels");
  }

  /**
   * Load label files for given labels
   *
   * Labels map to ./track/labels/{label}.md files.
   * Missing files are silently skipped (not an error).
   *
   * @param labels - Array of label names to load
   * @returns Array of loaded labels with name and content
   */
  async loadLabelsForTask(labels: string[]): Promise<Label[]> {
    const loadedLabels: Label[] = [];

    for (const label of labels) {
      const labelPath = path.join(this.labelsDirectory, `${label}.md`);

      try {
        const content = await fs.readFile(labelPath, "utf-8");
        loadedLabels.push({ name: label, content });
      } catch {
        // Silently skip missing label files
        continue;
      }
    }

    return loadedLabels;
  }

  /**
   * List all available labels
   *
   * Scans the labels directory for .md files.
   *
   * @returns Array of available label names
   */
  async listAvailableLabels(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.labelsDirectory);
      return files
        .filter((f) => f.endsWith(".md") && f !== "README.md")
        .map((f) => f.replace(".md", ""))
        .sort();
    } catch {
      // Directory doesn't exist - return empty array
      return [];
    }
  }

  /**
   * Check if a label exists
   *
   * @param label - Label name to check
   * @returns true if the label file exists
   */
  async labelExists(label: string): Promise<boolean> {
    const labelPath = path.join(this.labelsDirectory, `${label}.md`);

    try {
      await fs.access(labelPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the full path to a label file
   *
   * @param label - Label name
   * @returns Full path to the label file
   */
  getLabelPath(label: string): string {
    return path.join(this.labelsDirectory, `${label}.md`);
  }

  /**
   * Get a label by name
   *
   * @param name - Label name (without .md extension)
   * @returns Label with name and content, or null if not found
   */
  async getLabel(name: string): Promise<Label | null> {
    const labelPath = path.join(this.labelsDirectory, `${name}.md`);

    try {
      const content = await fs.readFile(labelPath, "utf-8");
      return { name, content };
    } catch {
      return null;
    }
  }

  /**
   * Create a new label
   *
   * @param name - Label name (without .md extension)
   * @param content - Label content (markdown)
   * @returns The created label
   * @throws Error if label already exists
   */
  async createLabel(name: string, content: string): Promise<Label> {
    // Validate label name (alphanumeric, hyphens, underscores only)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(
        `Invalid label name: "${name}". Use only letters, numbers, hyphens, and underscores.`
      );
    }

    const labelPath = this.getLabelPath(name);

    // Check if label already exists
    try {
      await fs.access(labelPath);
      throw new Error(`Label "${name}" already exists. Use updateLabel to modify it.`);
    } catch (error) {
      if ((error as Error).message.includes("already exists")) {
        throw error;
      }
      // Label doesn't exist, continue with creation
    }

    // Ensure labels directory exists
    await fs.mkdir(this.labelsDirectory, { recursive: true });

    // Write the label file
    await fs.writeFile(labelPath, content, "utf-8");

    return { name, content };
  }

  /**
   * Update an existing label
   *
   * @param name - Label name (without .md extension)
   * @param content - New label content (markdown)
   * @returns The updated label
   * @throws Error if label does not exist
   */
  async updateLabel(name: string, content: string): Promise<Label> {
    const labelPath = this.getLabelPath(name);

    // Check if label exists
    try {
      await fs.access(labelPath);
    } catch {
      throw new Error(`Label "${name}" does not exist. Use createLabel to create it.`);
    }

    // Write the updated content
    await fs.writeFile(labelPath, content, "utf-8");

    return { name, content };
  }

  /**
   * Remove a label
   *
   * @param name - Label name (without .md extension)
   * @throws Error if label does not exist
   */
  async removeLabel(name: string): Promise<void> {
    const labelPath = this.getLabelPath(name);

    // Check if label exists
    try {
      await fs.access(labelPath);
    } catch {
      throw new Error(`Label "${name}" does not exist.`);
    }

    // Delete the label file
    await fs.unlink(labelPath);
  }

  /**
   * Validate labels against available labels
   *
   * @param labels - Array of label names to validate
   * @returns Object with valid and invalid label arrays
   */
  async validateLabels(labels: string[]): Promise<{ valid: string[]; invalid: string[] }> {
    const available = await this.listAvailableLabels();
    const availableSet = new Set(available);

    return {
      valid: labels.filter((l) => availableSet.has(l)),
      invalid: labels.filter((l) => !availableSet.has(l)),
    };
  }
}
