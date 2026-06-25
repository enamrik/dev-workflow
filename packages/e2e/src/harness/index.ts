/**
 * E2E Test Harness
 *
 * Exports test infrastructure for E2E tests.
 */

export { E2ETestHarness, type HarnessOptions } from "./test-harness.js";
export {
  runClaude,
  isClaudeAvailable,
  runClaudeSimple,
  ClaudeRunner,
  type ClaudeResult,
  type ClaudeOptions,
  type ClaudeRunnerOptions,
} from "./claude-runner.js";
export {
  assertIssueExists,
  assertIssueByNumber,
  assertPlanExists,
  assertTasksExist,
  assertTaskStatus,
  getTaskByStatus,
  assertFileExists,
  assertFileNotExists,
  assertFileContains,
  countIssues,
  countTasksByStatus,
} from "./assertions.js";
export { UIHarness, getDaemonPort } from "./ui-harness.js";
