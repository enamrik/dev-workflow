/**
 * Template Parser Infrastructure
 *
 * Parses markdown templates with YAML frontmatter.
 * Follows Infrastructure layer pattern - handles external format parsing.
 */

import * as yaml from "js-yaml";
import type { Template, TemplateMetadata } from "../../domain/template.js";
import type { IssueType, IssuePriority } from "../../domain/issue.js";

/**
 * Template parse error
 *
 * Thrown when a template file cannot be parsed correctly.
 */
export class TemplateParseError extends Error {
  constructor(
    message: string,
    public readonly filename: string
  ) {
    super(`${filename}: ${message}`);
    this.name = "TemplateParseError";
  }
}

/**
 * Template Parser
 *
 * Responsibilities:
 * - Extract YAML frontmatter from markdown
 * - Parse frontmatter using js-yaml
 * - Validate required metadata fields
 * - Return structured Template objects
 *
 * Follows Single Responsibility Principle - only handles template parsing.
 */
export class TemplateParser {
  /**
   * Parse a template file content into a Template object
   *
   * @param filename - Name of the template file (for error reporting)
   * @param content - Raw file content
   * @param isUserDefined - Whether this template is from user templates directory
   * @returns Parsed Template object
   * @throws TemplateParseError if parsing fails
   */
  parse(filename: string, content: string, isUserDefined: boolean): Template {
    // Extract frontmatter (between --- markers)
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      throw new TemplateParseError(
        "No frontmatter found. Templates must start with YAML frontmatter between --- markers.",
        filename
      );
    }

    const [, frontmatter, body] = match;
    const metadata = this.parseFrontmatter(frontmatter, filename);

    return {
      filename,
      content: body.trim(),
      rawContent: content,
      metadata,
      isUserDefined,
    };
  }

  /**
   * Parse YAML frontmatter into TemplateMetadata
   *
   * @private
   */
  private parseFrontmatter(frontmatter: string, filename: string): TemplateMetadata {
    let parsed: unknown;

    try {
      parsed = yaml.load(frontmatter);
    } catch (error) {
      throw new TemplateParseError(
        `Invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
        filename
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new TemplateParseError("Frontmatter must be a YAML object", filename);
    }

    const data = parsed as Record<string, unknown>;

    // Validate and extract required fields
    const type = this.parseType(data["type"], filename);
    const priority = this.parsePriority(data["priority"], filename);

    // Extract optional description field
    const description = this.parseDescription(data["description"]);

    return {
      type,
      priority,
      description,
    };
  }

  /**
   * Parse optional description field
   *
   * @private
   */
  private parseDescription(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== "string") {
      // Ignore invalid description, just treat as undefined
      return undefined;
    }
    return value.trim() || undefined;
  }

  /**
   * Parse and validate type field
   *
   * @private
   */
  private parseType(value: unknown, filename: string): IssueType {
    if (typeof value !== "string") {
      throw new TemplateParseError("Missing or invalid 'type' field. Must be a string.", filename);
    }

    const validTypes: IssueType[] = ["FEATURE", "BUG", "ENHANCEMENT", "TASK"];
    if (!validTypes.includes(value as IssueType)) {
      throw new TemplateParseError(
        `Invalid type: ${value}. Must be one of: ${validTypes.join(", ")}`,
        filename
      );
    }

    return value as IssueType;
  }

  /**
   * Parse and validate priority field
   *
   * @private
   */
  private parsePriority(value: unknown, filename: string): IssuePriority {
    if (typeof value !== "string") {
      throw new TemplateParseError(
        "Missing or invalid 'priority' field. Must be a string.",
        filename
      );
    }

    const validPriorities: IssuePriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    if (!validPriorities.includes(value as IssuePriority)) {
      throw new TemplateParseError(
        `Invalid priority: ${value}. Must be one of: ${validPriorities.join(", ")}`,
        filename
      );
    }

    return value as IssuePriority;
  }
}
