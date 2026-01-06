/**
 * Template Service Infrastructure
 *
 * Handles template discovery, selection, and caching.
 * Follows Application Service pattern - orchestrates domain logic with infrastructure.
 *
 * Template Resolution Order (for issues):
 * 1. Local per-type: ./track/templates/issues/<type>.md
 * 2. Local all.md: ./track/templates/issues/all.md
 * 3. Global per-type: ~/.track/config/templates/issues/<type>.md
 * 4. Global all.md: ~/.track/config/templates/issues/all.md
 *
 * Template Resolution Order (for tasks):
 * 1. Local all.md: ./track/templates/tasks/all.md
 * 2. Global all.md: ~/.track/config/templates/tasks/all.md
 */

import * as path from "node:path";
import type { Template, TemplateDiscovery } from "../../domain/template.js";
import type { FileSystem } from "../file-system/file-system.js";
import { TemplateParser, TemplateParseError } from "./template-parser.js";
import type { TypeService } from "../types/type-service.js";

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
 * Configuration for template resolution paths
 */
export interface TemplateServiceConfig {
  /** Local issue templates path: ./track/templates/issues/ */
  localIssueTemplatesPath: string;
  /** Local task templates path: ./track/templates/tasks/ */
  localTaskTemplatesPath: string;
  /** Global issue templates path (fallback): ~/.track/config/templates/issues/ */
  globalIssueTemplatesPath: string;
  /** Global task templates path (fallback): ~/.track/config/templates/tasks/ */
  globalTaskTemplatesPath: string;
}

/**
 * Template Service
 *
 * Application service for template management.
 *
 * Responsibilities:
 * - Discover templates from filesystem (local first, then global fallback)
 * - Select appropriate template based on description keywords
 * - Support all.md fallback when per-type template not found
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
   * @param config - Template paths configuration
   * @param typeService - Optional TypeService for intelligent type selection
   */
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly config: TemplateServiceConfig,
    private readonly typeService?: TypeService
  ) {
    this.parser = new TemplateParser();
  }

  /**
   * Discover all available templates
   *
   * Scans local and global template directories and returns merged list
   * where local templates override global templates by filename.
   *
   * Results are cached for performance. Use clearCache() to invalidate.
   *
   * @returns Template discovery result with user (local), default (global), and merged lists
   * @throws TemplateServiceError if discovery fails
   */
  async discoverTemplates(): Promise<TemplateDiscovery> {
    // Return cached result if available
    if (this.cachedTemplates) {
      return this.cachedTemplates;
    }

    try {
      // Load templates from local and global directories in parallel
      const [localTemplates, globalTemplates] = await Promise.all([
        this.loadTemplatesFromDirectory(this.config.localIssueTemplatesPath, true),
        this.loadTemplatesFromDirectory(this.config.globalIssueTemplatesPath, false),
      ]);

      // Merge: local templates override global by filename
      const merged = this.mergeTemplates(localTemplates, globalTemplates);

      const discovery: TemplateDiscovery = {
        userTemplates: localTemplates, // "user" = local for backward compatibility
        defaultTemplates: globalTemplates, // "default" = global for backward compatibility
        merged,
      };

      // Cache the result
      this.cachedTemplates = discovery;

      return discovery;
    } catch (error) {
      throw new TemplateServiceError("Failed to discover templates", error);
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
   * Select template based on description keywords with cascading fallback
   *
   * If a TypeService is configured, uses intelligent type matching based on
   * user-defined type descriptions from ./track/types.md.
   *
   * Resolution order:
   * 1. Local per-type (e.g., ./track/templates/issues/feature.md)
   * 2. Local all.md (./track/templates/issues/all.md)
   * 3. Global per-type (e.g., ~/.track/config/templates/issues/feature.md)
   * 4. Global all.md (~/.track/config/templates/issues/all.md)
   *
   * @param description - Issue description text
   * @returns Selected Template
   * @throws TemplateServiceError if no templates are available
   */
  async selectTemplate(description: string): Promise<Template> {
    // Determine target type - use TypeService if available, else fall back to hardcoded logic
    let targetType: string;

    if (this.typeService) {
      // Use intelligent type selection from TypeService
      const issueType = await this.typeService.selectType(description);
      targetType = issueType.toLowerCase();
    } else {
      // Fall back to hardcoded keyword matching
      targetType = this.selectTypeFromKeywords(description);
    }

    // Try cascading resolution
    const template = await this.resolveTemplateWithFallback(targetType);

    if (template) {
      return template;
    }

    // Last resort: return any available template
    const discovery = await this.discoverTemplates();
    if (discovery.merged.length > 0) {
      return discovery.merged[0];
    }

    throw new TemplateServiceError("No templates available");
  }

  /**
   * Select type from keywords (fallback when TypeService not available)
   *
   * @param description - Issue description
   * @returns Lowercase type name
   */
  private selectTypeFromKeywords(description: string): string {
    const lower = description.toLowerCase();

    if (
      lower.includes("bug") ||
      lower.includes("error") ||
      lower.includes("broken") ||
      lower.includes("failing")
    ) {
      return "bug";
    } else if (
      lower.includes("enhance") ||
      lower.includes("improve") ||
      lower.includes("optimize") ||
      lower.includes("better")
    ) {
      return "enhancement";
    } else if (lower.includes("task") || lower.includes("chore") || lower.includes("setup")) {
      return "task";
    } else {
      return "feature";
    }
  }

  /**
   * Resolve a template with cascading fallback logic
   *
   * Resolution order:
   * 1. Local per-type
   * 2. Local all.md
   * 3. Global per-type
   * 4. Global all.md
   *
   * @param type - Template type (e.g., "feature", "bug")
   * @returns Template if found, null otherwise
   */
  private async resolveTemplateWithFallback(type: string): Promise<Template | null> {
    const filename = `${type}.md`;

    // 1. Try local per-type
    const localPerType = await this.loadSingleTemplate(
      this.config.localIssueTemplatesPath,
      filename,
      true
    );
    if (localPerType) return localPerType;

    // 2. Try local all.md
    const localAll = await this.loadSingleTemplate(
      this.config.localIssueTemplatesPath,
      "all.md",
      true
    );
    if (localAll) return localAll;

    // 3. Try global per-type
    const globalPerType = await this.loadSingleTemplate(
      this.config.globalIssueTemplatesPath,
      filename,
      false
    );
    if (globalPerType) return globalPerType;

    // 4. Try global all.md
    const globalAll = await this.loadSingleTemplate(
      this.config.globalIssueTemplatesPath,
      "all.md",
      false
    );
    if (globalAll) return globalAll;

    return null;
  }

  /**
   * Load a single template file
   *
   * @param dirPath - Directory containing the template
   * @param filename - Template filename
   * @param isUserDefined - Whether this is a user/local template
   * @returns Template if found and valid, null otherwise
   */
  private async loadSingleTemplate(
    dirPath: string,
    filename: string,
    isUserDefined: boolean
  ): Promise<Template | null> {
    const filePath = path.join(dirPath, filename);

    try {
      const exists = await this.fileSystem.exists(filePath);
      if (!exists) return null;

      const content = await this.fileSystem.readFile(filePath);
      return this.parser.parse(filename, content, isUserDefined);
    } catch (error) {
      if (error instanceof TemplateParseError) {
        console.warn(`Warning: Failed to parse template ${filename}: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Get a task template with fallback
   *
   * Resolution order:
   * 1. Local all.md: ./track/templates/tasks/all.md
   * 2. Global all.md: ~/.track/config/templates/tasks/all.md
   *
   * @returns Template if found, null otherwise
   */
  async getTaskTemplate(): Promise<Template | null> {
    // 1. Try local all.md
    const localAll = await this.loadSingleTemplate(
      this.config.localTaskTemplatesPath,
      "all.md",
      true
    );
    if (localAll) return localAll;

    // 2. Try global all.md
    const globalAll = await this.loadSingleTemplate(
      this.config.globalTaskTemplatesPath,
      "all.md",
      false
    );
    if (globalAll) return globalAll;

    return null;
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
  async getTemplate(
    filename: string
  ): Promise<{ template: Template; source: "user" | "default" } | null> {
    const discovery = await this.discoverTemplates();

    // Check local (user) templates first
    const userTemplate = discovery.userTemplates.find((t) => t.filename === filename);
    if (userTemplate) {
      return { template: userTemplate, source: "user" };
    }

    // Check global (default) templates
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
      throw new TemplateServiceError(
        `User template '${filename}' already exists. Use updateTemplate to modify it.`
      );
    }

    try {
      // Ensure user templates directory exists
      const dirExists = await this.fileSystem.exists(this.config.localIssueTemplatesPath);
      if (!dirExists) {
        await this.fileSystem.mkdir(this.config.localIssueTemplatesPath, { recursive: true });
      }

      // Validate content by parsing it
      const template = this.parser.parse(filename, content, true);

      // Write the file
      const filePath = path.join(this.config.localIssueTemplatesPath, filename);
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
      const filePath = path.join(this.config.localIssueTemplatesPath, filename);
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
      const filePath = path.join(this.config.localIssueTemplatesPath, filename);
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
      throw new TemplateServiceError(`Failed to load templates from ${dirPath}`, error);
    }
  }

  /**
   * Merge user and default templates
   *
   * User templates override defaults by filename.
   * Results are sorted by filename for consistency.
   *
   * @private
   * @param userTemplates - User-defined templates (local)
   * @param defaultTemplates - Default templates (global)
   * @returns Merged and sorted template list
   */
  private mergeTemplates(userTemplates: Template[], defaultTemplates: Template[]): Template[] {
    // Create map of user templates by filename for O(1) lookup
    const userMap = new Map(userTemplates.map((t) => [t.filename, t]));

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
