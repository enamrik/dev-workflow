/**
 * Hook configuration domain types
 *
 * Defines the structure for lifecycle hook configurations stored as YAML files.
 * Hook configs are composable - multiple configs can be merged together.
 */

/**
 * Lifecycle stages where hooks can be executed
 */
export type HookStage =
  | "preStart"
  | "postStart"
  | "preComplete"
  | "postComplete"
  | "onAbandon";

/**
 * Hook configuration
 *
 * Defines shell commands to run at various lifecycle stages.
 * Stored as YAML files in .track/issues/tasks/hooks/
 */
export interface HookConfig {
  /** Unique name for this hook configuration */
  name: string;

  /** Human-readable description */
  description: string;

  /** Hooks to execute at lifecycle stages */
  hooks: {
    /** Commands to run before task starts (before IN_PROGRESS) */
    preStart?: string[];

    /** Commands to run after task starts (after IN_PROGRESS) */
    postStart?: string[];

    /** Commands to run before task completes (must pass!) */
    preComplete?: string[];

    /** Commands to run after task completes (after COMPLETED) */
    postComplete?: string[];

    /** Commands to run when task is abandoned */
    onAbandon?: string[];
  };

  /** Environment variables for hook execution */
  environment?: Record<string, string>;

  /** Global timeout for all hooks in milliseconds */
  timeout?: number;
}

/**
 * Result of executing a single hook command
 */
export interface HookResult {
  /** Which lifecycle stage (pre-start, post-start, etc.) */
  hookStage: string;

  /** The command that was executed */
  command: string;

  /** Exit code from command execution */
  exitCode: number;

  /** Combined stdout/stderr output (truncated if too long) */
  output: string;

  /** When the hook was executed */
  executedAt: string;
}

/**
 * Context for hook execution
 */
export interface HookContext {
  /** Task ID for variable substitution */
  taskId: string;

  /** Task title for variable substitution */
  taskTitle: string;

  /** Working directory to execute commands in */
  workingDirectory: string;

  /** Environment variables to set */
  environment?: Record<string, string>;

  /** Max execution time in milliseconds */
  timeout?: number;
}
