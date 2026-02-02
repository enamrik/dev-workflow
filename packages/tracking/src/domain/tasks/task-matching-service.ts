import { distance as levenshtein } from "fastest-levenshtein";
import type { Task, TaskStatus } from "./task.js";
import type { IssueType } from "../issues/issue.js";

/**
 * Task definition for new tasks being created
 *
 * Caller must provide id for dependency tracking between tasks.
 *
 * The description and acceptanceCriteria should use story format (human-readable
 * content for GitHub issues), while implementationPlan contains technical details
 * for Claude's execution context.
 */
export interface TaskDefinition {
  id: string; // Required task UUID (for dependency tracking)
  title: string;
  description: string; // Human-readable story format (syncs to GitHub)
  acceptanceCriteria: string[]; // Human-readable criteria (syncs to GitHub)
  estimatedMinutes?: number;
  dependsOn?: string[]; // Array of task IDs this task depends on
  type?: IssueType; // Task type (defaults to "TASK" if not specified)
  implementationPlan?: string; // Technical implementation details for Claude execution (NOT synced to GitHub)
}

/**
 * Result of matching a new task definition to existing tasks
 */
export interface TaskMatchResult {
  newTask: TaskDefinition;
  matchedTask?: Task; // If matched to existing task
  matchConfidence: number; // 0.0-1.0
  action: "CREATE" | "PRESERVE";
  preservedStatus?: TaskStatus; // Status to preserve if action is PRESERVE
}

/**
 * TaskMatchingService implements smart task matching logic
 *
 * Matches new task definitions to existing tasks to preserve work when possible.
 * Uses fuzzy matching with Levenshtein distance for title and description similarity.
 *
 * Matching thresholds:
 * - >= 0.8: High confidence match, preserve task
 * - >= 0.5 and task is COMPLETED: Medium confidence but preserve completed work
 * - < 0.5: No good match, create new task
 *
 * Matching rules:
 * - COMPLETED tasks: Always try to match (preserve work done)
 * - IN_PROGRESS tasks: Try to match (preserve current work)
 * - BACKLOG/READY tasks: Match if high confidence (>0.8), otherwise create new
 * - ABANDONED tasks: Never match (already obsolete)
 */
export class TaskMatchingService {
  /**
   * Match new task definitions to existing tasks
   *
   * @param newTasks - New task definitions to match
   * @param existingTasks - Existing tasks from previous version
   * @returns Array of match results indicating which tasks to create/preserve
   */
  matchTasks(newTasks: TaskDefinition[], existingTasks: Task[]): TaskMatchResult[] {
    const results: TaskMatchResult[] = [];
    const matchedExistingTaskIds = new Set<string>();

    // For each new task, find the best matching existing task
    for (const newTask of newTasks) {
      let bestMatch: Task | undefined;
      let bestScore = 0;

      // Find best match among existing tasks
      for (const existingTask of existingTasks) {
        // Skip abandoned tasks - they're already obsolete
        if (existingTask.status === "ABANDONED") {
          continue;
        }

        // Skip tasks that have already been matched
        if (matchedExistingTaskIds.has(existingTask.id)) {
          continue;
        }

        const score = this.calculateMatchScore(newTask, existingTask);

        if (score > bestScore) {
          bestScore = score;
          bestMatch = existingTask;
        }
      }

      // Decide action based on match score and existing task status
      if (bestScore >= 0.8) {
        // High confidence match - preserve the task
        matchedExistingTaskIds.add(bestMatch!.id);
        results.push({
          newTask,
          matchedTask: bestMatch,
          matchConfidence: bestScore,
          action: "PRESERVE",
          preservedStatus: bestMatch!.status,
        });
      } else if (bestScore >= 0.5 && bestMatch && bestMatch.status === "COMPLETED") {
        // Medium confidence but preserve completed work anyway
        matchedExistingTaskIds.add(bestMatch.id);
        results.push({
          newTask,
          matchedTask: bestMatch,
          matchConfidence: bestScore,
          action: "PRESERVE",
          preservedStatus: "COMPLETED",
        });
      } else {
        // No good match - create new task
        results.push({
          newTask,
          matchConfidence: 0,
          action: "CREATE",
        });
      }
    }

    return results;
  }

  /**
   * Calculate match score between new task and existing task
   *
   * Combines title similarity (70% weight) and description similarity (30% weight).
   *
   * @param newTask - New task definition
   * @param existingTask - Existing task
   * @returns Match score between 0.0 (no match) and 1.0 (perfect match)
   */
  private calculateMatchScore(newTask: TaskDefinition, existingTask: Task): number {
    const titleScore = this.calculateTitleSimilarity(newTask.title, existingTask.title);
    const descScore = this.calculateDescriptionSimilarity(
      newTask.description,
      existingTask.description
    );

    // Weighted combination: title is more important
    return titleScore * 0.7 + descScore * 0.3;
  }

  /**
   * Calculate similarity between two titles
   *
   * Uses Levenshtein distance for fuzzy matching.
   *
   * @param a - First title
   * @param b - Second title
   * @returns Similarity score between 0.0 and 1.0
   */
  private calculateTitleSimilarity(a: string, b: string): number {
    const normA = this.normalize(a);
    const normB = this.normalize(b);

    // Exact match
    if (normA === normB) {
      return 1.0;
    }

    // Empty strings
    if (!normA || !normB) {
      return 0.0;
    }

    // Levenshtein distance
    const dist = levenshtein(normA, normB);
    const maxLen = Math.max(normA.length, normB.length);

    // Convert distance to similarity (1.0 - normalized distance)
    return 1 - dist / maxLen;
  }

  /**
   * Calculate similarity between two descriptions
   *
   * Uses simple word overlap for efficiency.
   * Could be enhanced with TF-IDF or other NLP techniques.
   *
   * @param a - First description
   * @param b - Second description
   * @returns Similarity score between 0.0 and 1.0
   */
  private calculateDescriptionSimilarity(a: string, b: string): number {
    const wordsA = this.extractWords(a);
    const wordsB = this.extractWords(b);

    if (wordsA.length === 0 || wordsB.length === 0) {
      return 0.0;
    }

    // Calculate Jaccard similarity (intersection / union)
    const setA = new Set(wordsA);
    const setB = new Set(wordsB);

    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    return intersection.size / union.size;
  }

  /**
   * Normalize text for comparison
   *
   * Converts to lowercase, trims whitespace, removes punctuation.
   *
   * @param str - Text to normalize
   * @returns Normalized text
   */
  private normalize(str: string): string {
    return str
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, "");
  }

  /**
   * Extract words from text
   *
   * Normalizes text and splits into words, filtering out short words.
   *
   * @param str - Text to extract words from
   * @returns Array of words
   */
  private extractWords(str: string): string[] {
    return this.normalize(str)
      .split(/\s+/)
      .filter((word) => word.length > 2); // Filter out very short words
  }
}
