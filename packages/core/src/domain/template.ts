/**
 * Domain types for Template entity
 */

import type { IssueType, IssuePriority } from "./issue.js";

/**
 * Template metadata extracted from markdown frontmatter
 *
 * Represents the configuration defined in the YAML frontmatter
 * of a template file.
 */
export interface TemplateMetadata {
  readonly type: IssueType;
  readonly priority: IssuePriority;
}

/**
 * Template value object
 *
 * Represents an issue template with its content and metadata.
 * Following DDD principles, this is a value object - it's defined
 * by its attributes rather than an identity.
 */
export interface Template {
  readonly filename: string;
  readonly content: string;
  readonly metadata: TemplateMetadata;
  readonly isUserDefined: boolean; // true if from user templates, false if default
}

/**
 * Template discovery result
 *
 * Contains the results of discovering templates from both
 * user and default directories, along with the merged result
 * where user templates override defaults.
 */
export interface TemplateDiscovery {
  readonly userTemplates: Template[];
  readonly defaultTemplates: Template[];
  readonly merged: Template[]; // User templates override defaults by filename
}
