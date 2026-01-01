/**
 * Template Service Infrastructure
 *
 * Handles template discovery, selection, and caching.
 * Follows Application Service pattern - orchestrates domain logic with infrastructure.
 */

import * as path from "node:path";
import type { Template, TemplateDiscovery } from "../../domain/template.js";
import type { FileSystem } from "../file-system/file-system.js";
import { TemplateParser, TemplateParseError } from "./template-parser.js";

/**
 * Template service error
 *
 * Thrown when template service operations fail.
 */
export class TemplateServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "TemplateServiceError";
  }
}

/**
 * Template Service
 *
 * Application service for template management.
 *
 * Responsibilities:
 * - Discover templates from filesystem (both user and default directories)
 * - Merge user and default templates (user overrides default by filename)
 * - Select appropriate template based on description keywords
 * - Cache templates for performance
 *
 * Follows:
 * - Single Responsibility Principle (only manages templates)
 * - Dependency Inversion Principle (depends on FileSystem interface)
 * - Open/Closed Principle (extensible via strategy pattern for selection)
 */
export class TemplateService {
  private readonly parser: TemplateParser;
  private cachedTemplates: TemplateDiscovery | null = null;

  /**
   * Create a new TemplateService
   *
   * @param fileSystem - FileSystem abstraction for reading files
   * @param userTemplatesPath - Path to user-defined templates directory
   * @param defaultTemplatesPath - Path to default templates directory
   */
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly userTemplatesPath: string,
    private readonly defaultTemplatesPath: string
  ) {
    this.parser = new TemplateParser();
  }

  /**
   * Discover all available templates
   *
   * Scans both user and default template directories and returns merged list
   * where user templates override defaults by filename.
   *
   * Results are cached for performance. Use clearCache() to invalidate.
   *
   * @returns Template discovery result with user, default, and merged lists
   * @throws TemplateServiceError if discovery fails
   */
  async discoverTemplates(): Promise<TemplateDiscovery> {
    // Return cached result if available
    if (this.cachedTemplates) {
      return this.cachedTemplates;
    }

    try {
      // Load templates from both directories in parallel
      const [userTemplates, defaultTemplates] = await Promise.all([
        this.loadTemplatesFromDirectory(this.userTemplatesPath, true),
        this.loadTemplatesFromDirectory(this.defaultTemplatesPath, false),
      ]);

      // Merge: user templates override defaults by filename
      const merged = this.mergeTemplates(userTemplates, defaultTemplates);

      const discovery: TemplateDiscovery = {
        userTemplates,
        defaultTemplates,
        merged,
      };

      // Cache the result
      this.cachedTemplates = discovery;

      return discovery;
    } catch (error) {
      throw new TemplateServiceError(
        "Failed to discover templates",
        error
      );
    }
  }

  /**
   * Get list of available template filenames
   *
   * @returns Array of template filenames (merged list)
   */
  async getAvailableTemplates(): Promise<string[]> {
    const discovery = await this.discoverTemplates();
    return discovery.merged.map((t) => t.filename);
  }

  /**
   * Select template based on description keywords
   *
   * Uses keyword matching to determine the most appropriate template.
   * Falls back to feature.md if no keywords match.
   * Falls back to first available template if feature.md doesn't exist.
   *
   * @param description - Issue description text
   * @returns Selected Template
   * @throws TemplateServiceError if no templates are available
   */
  async selectTemplate(description: string): Promise<Template> {
    const discovery = await this.discoverTemplates();

    if (discovery.merged.length === 0) {
      throw new TemplateServiceError("No templates available");
    }

    const lower = description.toLowerCase();

    // Keyword matching logic (preserving existing behavior)
    let selectedFilename: string;

    if (
      lower.includes("bug") ||
      lower.includes("error") ||
      lower.includes("broken") ||
      lower.includes("failing")
    ) {
      selectedFilename = "bug.md";
    } else if (
      lower.includes("enhance") ||
      lower.includes("improve") ||
      lower.includes("optimize") ||
      lower.includes("better")
    ) {
      selectedFilename = "enhancement.md";
    } else if (
      lower.includes("task") ||
      lower.includes("chore") ||
      lower.includes("setup")
    ) {
      selectedFilename = "task.md";
    } else {
      selectedFilename = "feature.md";
    }

    // Find template by filename
    const template = discovery.merged.find((t) => t.filename === selectedFilename);

    if (template) {
      return template;
    }

    // Fallback to first available template
    return discovery.merged[0];
  }

  /**
   * Get template by filename
   *
   * @param filename - Template filename (e.g., "feature.md")
   * @returns Template if found, null otherwise
   */
  async getTemplateByFilename(filename: string): Promise<Template | null> {
    const discovery = await this.discoverTemplates();
    return discovery.merged.find((t) => t.filename === filename) || null;
  }

  /**
   * Clear template cache
   *
   * Useful for testing or after template updates.
   * Next call to discoverTemplates() will re-scan the filesystem.
   */
  clearCache(): void {
    this.cachedTemplates = null;
  }

  /**
   * Get a single template with source information
   *
   * @param filename - Template filename (e.g., "feature.md")
   * @returns Template with source info, or null if not found
   */
  async getTemplate(filename: string): Promise<{ template: Template; source: "user" | "default" } | null> {
    const discovery = await this.discoverTemplates();

    // Check user templates first
    const userTemplate = discovery.userTemplates.find((t) => t.filename === filename);
    if (userTemplate) {
      return { template: userTemplate, source: "user" };
    }

    // Check default templates
    const defaultTemplate = discovery.defaultTemplates.find((t) => t.filename === filename);
    if (defaultTemplate) {
      return { template: defaultTemplate, source: "default" };
    }

    return null;
  }

  /**
   * Create a new user template
   *
   * @param filename - Template filename (must end with .md)
   * @param content - Template content (markdown with YAML frontmatter)
   * @returns The created Template
   * @throws TemplateServiceError if template already exists or creation fails
   */
  async createTemplate(filename: string, content: string): Promise<Template> {
    if (!filename.endsWith(".md")) {
      throw new TemplateServiceError("Template filename must end with .md");
    }

    // Check if user template already exists
    const existing = await this.getTemplate(filename);
    if (existing?.source === "user") {
      throw new TemplateServiceError(`User template '${filename}' already exists. Use updateTemplate to modify it.`);
    }

    try {
      // Ensure user templates directory exists
      const dirExists = await this.fileSystem.exists(this.userTemplatesPath);
      if (!dirExists) {
        await this.fileSystem.mkdir(this.userTemplatesPath, { recursive: true });
      }

      // Validate content by parsing it
      const template = this.parser.parse(filename, content, true);

      // Write the file
      const filePath = path.join(this.userTemplatesPath, filename);
      await this.fileSystem.writeFile(filePath, content);

      // Clear cache to reflect new template
      this.clearCache();

      return template;
    } catch (error) {
      if (error instanceof TemplateServiceError) {
        throw error;
      }
      if (error instanceof TemplateParseError) {
        throw new TemplateServiceError(`Invalid template format: ${error.message}`, error);
      }
      throw new TemplateServiceError(`Failed to create template '${filename}'`, error);
    }
  }

  /**
   * Update an existing user template
   *
   * @param filename - Template filename
   * @param content - New template content
   * @returns The updated Template
   * @throws TemplateServiceError if template doesn't exist or is a default template
   */
  async updateTemplate(filename: string, content: string): Promise<Template> {
    const existing = await this.getTemplate(filename);

    if (!existing) {
      throw new TemplateServiceError(`Template '${filename}' not found`);
    }

    if (existing.source === "default") {
      throw new TemplateServiceError(
        `Cannot modify default template '${filename}'. Create a user template with the same name to override it.`
      );
    }

    try {
      // Validate content by parsing it
      const template = this.parser.parse(filename, content, true);

      // Write the file
      const filePath = path.join(this.userTemplatesPath, filename);
      await this.fileSystem.writeFile(filePath, content);

      // Clear cache to reflect changes
      this.clearCache();

      return template;
    } catch (error) {
      if (error instanceof TemplateServiceError) {
        throw error;
      }
      if (error instanceof TemplateParseError) {
        throw new TemplateServiceError(`Invalid template format: ${error.message}`, error);
      }
      throw new TemplateServiceError(`Failed to update template '${filename}'`, error);
    }
  }

  /**
   * Delete a user template
   *
   * @param filename - Template filename
   * @throws TemplateServiceError if template doesn't exist or is a default template
   */
  async deleteTemplate(filename: string): Promise<void> {
    const existing = await this.getTemplate(filename);

    if (!existing) {
      throw new TemplateServiceError(`Template '${filename}' not found`);
    }

    if (existing.source === "default") {
      throw new TemplateServiceError(
        `Cannot delete default template '${filename}'. Default templates are part of the package.`
      );
    }

    try {
      const filePath = path.join(this.userTemplatesPath, filename);
      await this.fileSystem.unlink(filePath);

      // Clear cache to reflect deletion
      this.clearCache();
    } catch (error) {
      if (error instanceof TemplateServiceError) {
        throw error;
      }
      throw new TemplateServiceError(`Failed to delete template '${filename}'`, error);
    }
  }

  /**
   * Load templates from a directory
   *
   * @private
   * @param dirPath - Directory path to scan
   * @param isUserDefined - Whether these are user-defined templates
   * @returns Array of parsed Template objects
   */
  private async loadTemplatesFromDirectory(
    dirPath: string,
    isUserDefined: boolean
  ): Promise<Template[]> {
    // Check if directory exists
    const exists = await this.fileSystem.exists(dirPath);
    if (!exists) {
      // Gracefully handle missing directory
      return [];
    }

    try {
      const entries = await this.fileSystem.readdirWithFileTypes(dirPath);
      const templates: Template[] = [];

      for (const entry of entries) {
        // Only process markdown files
        if (!entry.isFile() || !entry.name.endsWith(".md")) {
          continue;
        }

        const filePath = path.join(dirPath, entry.name);

        try {
          const content = await this.fileSystem.readFile(filePath);
          const template = this.parser.parse(entry.name, content, isUserDefined);
          templates.push(template);
        } catch (error) {
          if (error instanceof TemplateParseError) {
            // Log warning but continue with other templates
            // Graceful degradation: one bad template shouldn't break the system
            console.warn(`Warning: Failed to parse template ${entry.name}: ${error.message}`);
            continue;
          }
          // Re-throw other errors
          throw error;
        }
      }

      return templates;
    } catch (error) {
      throw new TemplateServiceError(
        `Failed to load templates from ${dirPath}`,
        error
      );
    }
  }

  /**
   * Merge user and default templates
   *
   * User templates override defaults by filename.
   * Results are sorted by filename for consistency.
   *
   * @private
   * @param userTemplates - User-defined templates
   * @param defaultTemplates - Default templates
   * @returns Merged and sorted template list
   */
  private mergeTemplates(
    userTemplates: Template[],
    defaultTemplates: Template[]
  ): Template[] {
    // Create map of user templates by filename for O(1) lookup
    const userMap = new Map(
      userTemplates.map((t) => [t.filename, t])
    );

    // Start with all user templates
    const merged = [...userTemplates];

    // Add default templates only if not overridden by user
    for (const defaultTemplate of defaultTemplates) {
      if (!userMap.has(defaultTemplate.filename)) {
        merged.push(defaultTemplate);
      }
    }

    // Sort by filename for consistent ordering
    return merged.sort((a, b) => a.filename.localeCompare(b.filename));
  }
}
