/**
 * Template Service Infrastructure
 *
 * Handles template discovery, selection, and caching.
 * Follows Application Service pattern - orchestrates domain logic with infrastructure.
 *
 * Template Resolution Order (for issues):
 * 1. Local per-type: ./.track/templates/issues/<type>.md
 * 2. Local all.md: ./.track/templates/issues/all.md
 * 3. Global per-type: ~/.track/templates/issues/<type>.md
 * 4. Global all.md: ~/.track/templates/issues/all.md
 *
 * Template Resolution Order (for tasks):
 * 1. Local per-type: ./.track/templates/tasks/<type>.md
 * 2. Local all.md: ./.track/templates/tasks/all.md
 * 3. Global per-type: ~/.track/templates/tasks/<type>.md
 * 4. Global all.md: ~/.track/templates/tasks/all.md
 */

import * as path from "node:path";
import type { Template, TemplateDiscovery } from "../template.js";
import type { FileSystem } from "../file-system/file-system.js";
import { TemplateParser, TemplateParseError } from "./template-parser.js";
import type { TypeDomainService } from "../domain/types/type-service.js";
import { Effect, Service } from "@dev-workflow/effect";

/**
 * Template scope - determines where templates are stored.
 * - local: Project-specific templates in ./.track/templates/
 * - global: User-level templates in ~/.track/templates/
 */
export type TemplateScope = "local" | "global";

/**
 * Template category - determines issue vs task templates.
 */
export type TemplateCategory = "issue" | "task";

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
  /** Local issue templates path: ./.track/templates/issues/ */
  localIssueTemplatesPath: string;
  /** Local task templates path: ./.track/templates/tasks/ */
  localTaskTemplatesPath: string;
  /** Global issue templates path (fallback): ~/.track/templates/issues/ */
  globalIssueTemplatesPath: string;
  /** Global task templates path (fallback): ~/.track/templates/tasks/ */
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
export class TemplateService extends Service<TemplateService>()("templateService") {
  private readonly parser: TemplateParser;
  private cachedTemplates: TemplateDiscovery | null = null;
  private cachedTaskTemplates: TemplateDiscovery | null = null;

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
    private readonly typeService?: TypeDomainService
  ) {
    super();
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
  discoverTemplates(): Effect<TemplateDiscovery> {
    // Return cached result if available
    if (this.cachedTemplates) {
      return Effect.succeed(this.cachedTemplates);
    }

    const self = this;
    return Effect.gen(function* () {
      try {
        // Load templates from local and global directories in parallel
        const [localTemplates, globalTemplates] = yield* Effect.allPar([
          self.loadTemplatesFromDirectory(self.config.localIssueTemplatesPath, true),
          self.loadTemplatesFromDirectory(self.config.globalIssueTemplatesPath, false),
        ] as const);

        // Merge: local templates override global by filename
        const merged = self.mergeTemplates(localTemplates, globalTemplates);

        const discovery: TemplateDiscovery = {
          userTemplates: localTemplates, // "user" = local for backward compatibility
          defaultTemplates: globalTemplates, // "default" = global for backward compatibility
          merged,
        };

        // Cache the result
        self.cachedTemplates = discovery;

        return discovery;
      } catch (error) {
        throw new TemplateServiceError("Failed to discover templates", error);
      }
    });
  }

  /**
   * Get list of available template filenames
   *
   * @returns Array of template filenames (merged list)
   */
  getAvailableTemplates(): Effect<string[]> {
    return Effect.map(this.discoverTemplates(), (discovery) =>
      discovery.merged.map((t) => t.filename)
    );
  }

  /**
   * Discover all available task templates
   *
   * Scans local and global task template directories and returns merged list
   * where local templates override global templates by filename.
   *
   * Results are cached for performance. Use clearCache() to invalidate.
   *
   * @returns Template discovery result with user (local), default (global), and merged lists
   * @throws TemplateServiceError if discovery fails
   */
  discoverTaskTemplates(): Effect<TemplateDiscovery> {
    // Return cached result if available
    if (this.cachedTaskTemplates) {
      return Effect.succeed(this.cachedTaskTemplates);
    }

    const self = this;
    return Effect.gen(function* () {
      try {
        // Load templates from local and global task directories in parallel
        const [localTemplates, globalTemplates] = yield* Effect.allPar([
          self.loadTemplatesFromDirectory(self.config.localTaskTemplatesPath, true),
          self.loadTemplatesFromDirectory(self.config.globalTaskTemplatesPath, false),
        ] as const);

        // Merge: local templates override global by filename
        const merged = self.mergeTemplates(localTemplates, globalTemplates);

        const discovery: TemplateDiscovery = {
          userTemplates: localTemplates, // "user" = local for backward compatibility
          defaultTemplates: globalTemplates, // "default" = global for backward compatibility
          merged,
        };

        // Cache the result
        self.cachedTaskTemplates = discovery;

        return discovery;
      } catch (error) {
        throw new TemplateServiceError("Failed to discover task templates", error);
      }
    });
  }

  /**
   * Get list of available task template filenames
   *
   * @returns Array of task template filenames (merged list)
   */
  getAvailableTaskTemplates(): Effect<string[]> {
    return Effect.map(this.discoverTaskTemplates(), (discovery) =>
      discovery.merged.map((t) => t.filename)
    );
  }

  /**
   * Select template based on description keywords with cascading fallback
   *
   * If a TypeService is configured, uses intelligent type matching based on
   * user-defined type descriptions from ./.track/types.md.
   *
   * Resolution order:
   * 1. Local per-type (e.g., ./.track/templates/issues/feature.md)
   * 2. Local all.md (./.track/templates/issues/all.md)
   * 3. Global per-type (e.g., ~/.track/config/templates/issues/feature.md)
   * 4. Global all.md (~/.track/config/templates/issues/all.md)
   *
   * @param description - Issue description text
   * @returns Selected Template
   * @throws TemplateServiceError if no templates are available
   */
  selectTemplate(description: string): Effect<Template> {
    const self = this;
    return Effect.gen(function* () {
      // Determine target type - use TypeService if available, else fall back to hardcoded logic
      let targetType: string;

      if (self.typeService) {
        // Use intelligent type selection from TypeService
        const issueType = yield* self.typeService.selectType(description);
        targetType = issueType.toLowerCase();
      } else {
        // Fall back to hardcoded keyword matching
        targetType = self.selectTypeFromKeywords(description);
      }

      // Try cascading resolution
      const template = yield* self.resolveTemplateWithFallback(targetType);

      if (template) {
        return template;
      }

      // Last resort: return any available template
      const discovery = yield* self.discoverTemplates();
      if (discovery.merged.length > 0) {
        return discovery.merged[0]!;
      }

      throw new TemplateServiceError("No templates available");
    });
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
  private resolveTemplateWithFallback(type: string): Effect<Template | null> {
    const self = this;
    return Effect.gen(function* () {
      const filename = `${type}.md`;

      // 1. Try local per-type
      const localPerType = yield* self.loadSingleTemplate(
        self.config.localIssueTemplatesPath,
        filename,
        true
      );
      if (localPerType) return localPerType;

      // 2. Try local all.md
      const localAll = yield* self.loadSingleTemplate(
        self.config.localIssueTemplatesPath,
        "all.md",
        true
      );
      if (localAll) return localAll;

      // 3. Try global per-type
      const globalPerType = yield* self.loadSingleTemplate(
        self.config.globalIssueTemplatesPath,
        filename,
        false
      );
      if (globalPerType) return globalPerType;

      // 4. Try global all.md
      const globalAll = yield* self.loadSingleTemplate(
        self.config.globalIssueTemplatesPath,
        "all.md",
        false
      );
      if (globalAll) return globalAll;

      return null;
    });
  }

  /**
   * Load a single template file
   *
   * @param dirPath - Directory containing the template
   * @param filename - Template filename
   * @param isUserDefined - Whether this is a user/local template
   * @returns Template if found and valid, null otherwise
   */
  private loadSingleTemplate(
    dirPath: string,
    filename: string,
    isUserDefined: boolean
  ): Effect<Template | null> {
    const self = this;
    return Effect.promise(async () => {
      const filePath = path.join(dirPath, filename);

      try {
        const exists = await self.fileSystem.exists(filePath);
        if (!exists) return null;

        const content = await self.fileSystem.readFile(filePath);
        return self.parser.parse(filename, content, isUserDefined);
      } catch (error) {
        if (error instanceof TemplateParseError) {
          console.warn(`Warning: Failed to parse template ${filename}: ${error.message}`);
        }
        return null;
      }
    });
  }

  /**
   * Get a task template with cascading fallback
   *
   * Resolution order:
   * 1. Local per-type: ./.track/templates/tasks/<type>.md
   * 2. Local all.md: ./.track/templates/tasks/all.md
   * 3. Global per-type: ~/.track/config/templates/tasks/<type>.md
   * 4. Global all.md: ~/.track/config/templates/tasks/all.md
   *
   * @param type - Optional task type (e.g., "FEATURE", "BUG"). If provided, tries per-type templates first.
   * @returns Template if found, null otherwise
   */
  getTaskTemplate(type?: string): Effect<Template | null> {
    const self = this;
    return Effect.gen(function* () {
      const filename = type ? `${type.toLowerCase()}.md` : null;

      // 1. Try local per-type (if type provided)
      if (filename) {
        const localPerType = yield* self.loadSingleTemplate(
          self.config.localTaskTemplatesPath,
          filename,
          true
        );
        if (localPerType) return localPerType;
      }

      // 2. Try local all.md
      const localAll = yield* self.loadSingleTemplate(
        self.config.localTaskTemplatesPath,
        "all.md",
        true
      );
      if (localAll) return localAll;

      // 3. Try global per-type (if type provided)
      if (filename) {
        const globalPerType = yield* self.loadSingleTemplate(
          self.config.globalTaskTemplatesPath,
          filename,
          false
        );
        if (globalPerType) return globalPerType;
      }

      // 4. Try global all.md
      const globalAll = yield* self.loadSingleTemplate(
        self.config.globalTaskTemplatesPath,
        "all.md",
        false
      );
      if (globalAll) return globalAll;

      return null;
    });
  }

  /**
   * Get template by filename
   *
   * @param filename - Template filename (e.g., "feature.md")
   * @returns Template if found, null otherwise
   */
  getTemplateByFilename(filename: string): Effect<Template | null> {
    return Effect.map(
      this.discoverTemplates(),
      (discovery) => discovery.merged.find((t) => t.filename === filename) || null
    );
  }

  /**
   * Clear template cache
   *
   * Useful for testing or after template updates.
   * Next call to discoverTemplates() or discoverTaskTemplates() will re-scan the filesystem.
   */
  clearCache(): void {
    this.cachedTemplates = null;
    this.cachedTaskTemplates = null;
  }

  /**
   * Get a single template with source information
   *
   * @param filename - Template filename (e.g., "feature.md")
   * @param category - Template category: "issue" or "task" (default: "issue")
   * @param scope - Optional scope to filter by: "local" or "global". If not specified, searches both.
   * @returns Template with source info, or null if not found
   */
  getTemplate(
    filename: string,
    category: TemplateCategory = "issue",
    scope?: TemplateScope
  ): Effect<{ template: Template; source: "user" | "default" } | null> {
    const self = this;
    return Effect.gen(function* () {
      const discovery =
        category === "task" ? yield* self.discoverTaskTemplates() : yield* self.discoverTemplates();

      // If scope is specified, only search that scope
      if (scope === "local") {
        const userTemplate = discovery.userTemplates.find((t) => t.filename === filename);
        if (userTemplate) {
          return { template: userTemplate, source: "user" as const };
        }
        return null;
      }

      if (scope === "global") {
        const defaultTemplate = discovery.defaultTemplates.find((t) => t.filename === filename);
        if (defaultTemplate) {
          return { template: defaultTemplate, source: "default" as const };
        }
        return null;
      }

      // No scope specified - search local first, then global
      const userTemplate = discovery.userTemplates.find((t) => t.filename === filename);
      if (userTemplate) {
        return { template: userTemplate, source: "user" as const };
      }

      const defaultTemplate = discovery.defaultTemplates.find((t) => t.filename === filename);
      if (defaultTemplate) {
        return { template: defaultTemplate, source: "default" as const };
      }

      return null;
    });
  }

  /**
   * Get a single task template with source information
   *
   * @param filename - Template filename (e.g., "feature.md")
   * @param scope - Optional scope to filter by: "local" or "global". If not specified, searches both.
   * @returns Template with source info, or null if not found
   */
  getTaskTemplateInfo(
    filename: string,
    scope?: TemplateScope
  ): Effect<{ template: Template; source: "user" | "default" } | null> {
    return this.getTemplate(filename, "task", scope);
  }

  /**
   * Create a new template
   *
   * @param filename - Template filename (must end with .md)
   * @param content - Template content (markdown with YAML frontmatter)
   * @param category - Template category: "issue" or "task" (default: "issue")
   * @param scope - Template scope: "local" or "global" (default: "local")
   * @returns The created Template
   * @throws TemplateServiceError if template already exists or creation fails
   */
  createTemplate(
    filename: string,
    content: string,
    category: TemplateCategory = "issue",
    scope: TemplateScope = "local"
  ): Effect<Template> {
    if (!filename.endsWith(".md")) {
      throw new TemplateServiceError("Template filename must end with .md");
    }

    const self = this;
    return Effect.gen(function* () {
      // Check if template already exists at the target scope
      const existing = yield* self.getTemplate(filename, category, scope);
      if (existing) {
        const scopeLabel = scope === "local" ? "Local" : "Global";
        throw new TemplateServiceError(
          `${scopeLabel} ${category} template '${filename}' already exists. Use updateTemplate to modify it.`
        );
      }

      try {
        // Determine the target directory based on scope and category
        const targetDir = self.getTemplateDirectory(category, scope);

        // Ensure templates directory exists, validate, and write file
        const template = yield* Effect.promise(async () => {
          const dirExists = await self.fileSystem.exists(targetDir);
          if (!dirExists) {
            await self.fileSystem.mkdir(targetDir, { recursive: true });
          }

          // Validate content by parsing it
          const isUserDefined = scope === "local";
          const parsed = self.parser.parse(filename, content, isUserDefined);

          // Write the file
          const filePath = path.join(targetDir, filename);
          await self.fileSystem.writeFile(filePath, content);

          return parsed;
        });

        // Clear cache to reflect new template
        self.clearCache();

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
    });
  }

  /**
   * Get the template directory path for a given category and scope
   */
  private getTemplateDirectory(category: TemplateCategory, scope: TemplateScope): string {
    if (scope === "local") {
      return category === "task"
        ? this.config.localTaskTemplatesPath
        : this.config.localIssueTemplatesPath;
    }
    return category === "task"
      ? this.config.globalTaskTemplatesPath
      : this.config.globalIssueTemplatesPath;
  }

  /**
   * Update an existing template
   *
   * @param filename - Template filename
   * @param content - New template content
   * @param category - Template category: "issue" or "task" (default: "issue")
   * @param scope - Template scope: "local" or "global" (default: "local")
   * @returns The updated Template
   * @throws TemplateServiceError if template doesn't exist at the specified scope
   */
  updateTemplate(
    filename: string,
    content: string,
    category: TemplateCategory = "issue",
    scope: TemplateScope = "local"
  ): Effect<Template> {
    const self = this;
    return Effect.gen(function* () {
      const existing = yield* self.getTemplate(filename, category, scope);

      if (!existing) {
        const scopeLabel = scope === "local" ? "Local" : "Global";
        throw new TemplateServiceError(
          `${scopeLabel} ${category} template '${filename}' not found`
        );
      }

      try {
        // Validate content by parsing it
        const isUserDefined = scope === "local";
        const template = self.parser.parse(filename, content, isUserDefined);

        // Get target directory and write the file
        yield* Effect.promise(async () => {
          const targetDir = self.getTemplateDirectory(category, scope);
          const filePath = path.join(targetDir, filename);
          await self.fileSystem.writeFile(filePath, content);
        });

        // Clear cache to reflect changes
        self.clearCache();

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
    });
  }

  /**
   * Delete a template
   *
   * @param filename - Template filename
   * @param category - Template category: "issue" or "task" (default: "issue")
   * @param scope - Template scope: "local" or "global" (default: "local")
   * @throws TemplateServiceError if template doesn't exist at the specified scope
   */
  deleteTemplate(
    filename: string,
    category: TemplateCategory = "issue",
    scope: TemplateScope = "local"
  ): Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const existing = yield* self.getTemplate(filename, category, scope);

      if (!existing) {
        const scopeLabel = scope === "local" ? "Local" : "Global";
        throw new TemplateServiceError(
          `${scopeLabel} ${category} template '${filename}' not found`
        );
      }

      try {
        yield* Effect.promise(async () => {
          const targetDir = self.getTemplateDirectory(category, scope);
          const filePath = path.join(targetDir, filename);
          await self.fileSystem.unlink(filePath);
        });

        // Clear cache to reflect deletion
        self.clearCache();
      } catch (error) {
        if (error instanceof TemplateServiceError) {
          throw error;
        }
        throw new TemplateServiceError(`Failed to delete template '${filename}'`, error);
      }
    });
  }

  /**
   * Copy a template between scopes
   *
   * Copies a template from one scope to another (e.g., global to local for customization).
   *
   * @param filename - Template filename
   * @param category - Template category: "issue" or "task"
   * @param fromScope - Source scope: "local" or "global"
   * @param toScope - Destination scope: "local" or "global"
   * @returns The copied Template
   * @throws TemplateServiceError if source doesn't exist or destination already exists
   */
  copyTemplate(
    filename: string,
    category: TemplateCategory,
    fromScope: TemplateScope,
    toScope: TemplateScope
  ): Effect<Template> {
    if (fromScope === toScope) {
      throw new TemplateServiceError(
        `Cannot copy template to the same scope. Use updateTemplate to modify in place.`
      );
    }

    const self = this;
    return Effect.gen(function* () {
      // Get source template
      const source = yield* self.getTemplate(filename, category, fromScope);
      if (!source) {
        const scopeLabel = fromScope === "local" ? "Local" : "Global";
        throw new TemplateServiceError(
          `${scopeLabel} ${category} template '${filename}' not found`
        );
      }

      // Check destination doesn't already exist
      const destExists = yield* self.getTemplate(filename, category, toScope);
      if (destExists) {
        const scopeLabel = toScope === "local" ? "Local" : "Global";
        throw new TemplateServiceError(
          `${scopeLabel} ${category} template '${filename}' already exists`
        );
      }

      // Create template at destination using the raw content
      return yield* self.createTemplate(filename, source.template.rawContent, category, toScope);
    });
  }

  /**
   * Load templates from a directory
   *
   * @private
   * @param dirPath - Directory path to scan
   * @param isUserDefined - Whether these are user-defined templates
   * @returns Array of parsed Template objects
   */
  private loadTemplatesFromDirectory(dirPath: string, isUserDefined: boolean): Effect<Template[]> {
    const self = this;
    return Effect.promise(async () => {
      // Check if directory exists
      const exists = await self.fileSystem.exists(dirPath);
      if (!exists) {
        // Gracefully handle missing directory
        return [];
      }

      try {
        const entries = await self.fileSystem.readdirWithFileTypes(dirPath);
        const templates: Template[] = [];

        for (const entry of entries) {
          // Only process markdown files
          if (!entry.isFile() || !entry.name.endsWith(".md")) {
            continue;
          }

          const filePath = path.join(dirPath, entry.name);

          try {
            const content = await self.fileSystem.readFile(filePath);
            const template = self.parser.parse(entry.name, content, isUserDefined);
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
    });
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
