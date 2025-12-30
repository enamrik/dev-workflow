/**
 * E2E Test Assertions
 *
 * Helper functions for asserting on database and file system state.
 */

import { expect } from "vitest";
import type Database from "better-sqlite3";
import type { E2ETestHarness } from "./test-harness.js";

// Database row types
interface IssueRow {
  id: string;
  number: number;
  title: string;
  description: string;
  status: string;
  type: string;
  priority: string;
  labels: string;
  created_at: string;
  updated_at: string;
}

interface PlanRow {
  id: string;
  issue_id: string;
  summary: string;
  approach: string;
  estimated_complexity: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  plan_id: string;
  title: string;
  description: string;
  status: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/**
 * Assert that an issue exists with a title containing the search string
 * @returns The found issue
 */
export function assertIssueExists(
  db: Database.Database,
  titleSearch: string
): IssueRow {
  const issues = db
    .prepare("SELECT * FROM issues WHERE LOWER(title) LIKE ?")
    .all(`%${titleSearch.toLowerCase()}%`) as IssueRow[];

  expect(
    issues.length,
    `Expected to find issue with title containing "${titleSearch}"`
  ).toBeGreaterThan(0);

  const issue = issues[0];
  expect(issue).toBeDefined();
  return issue!;
}

/**
 * Assert that an issue exists by number
 * @returns The found issue
 */
export function assertIssueByNumber(
  db: Database.Database,
  issueNumber: number
): IssueRow {
  const issue = db
    .prepare("SELECT * FROM issues WHERE number = ?")
    .get(issueNumber) as IssueRow | undefined;

  expect(issue, `Expected issue #${issueNumber} to exist`).toBeDefined();
  return issue!;
}

/**
 * Assert that a plan exists for an issue
 * @returns The found plan
 */
export function assertPlanExists(
  db: Database.Database,
  issueId: string
): PlanRow {
  const plan = db
    .prepare("SELECT * FROM plans WHERE issue_id = ?")
    .get(issueId) as PlanRow | undefined;

  expect(plan, `Expected plan to exist for issue ${issueId}`).toBeDefined();
  return plan!;
}

/**
 * Assert that tasks exist for a plan
 * @returns The tasks
 */
export function assertTasksExist(
  db: Database.Database,
  planId: string,
  minCount = 1
): TaskRow[] {
  const tasks = db
    .prepare("SELECT * FROM tasks WHERE plan_id = ? ORDER BY order_index")
    .all(planId) as TaskRow[];

  expect(
    tasks.length,
    `Expected at least ${minCount} tasks for plan ${planId}`
  ).toBeGreaterThanOrEqual(minCount);

  return tasks;
}

/**
 * Assert that a task has a specific status
 */
export function assertTaskStatus(
  db: Database.Database,
  taskId: string,
  expectedStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED"
): TaskRow {
  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(taskId) as TaskRow | undefined;

  expect(task, `Expected task ${taskId} to exist`).toBeDefined();
  expect(task!.status).toBe(expectedStatus);
  return task!;
}

/**
 * Get a task by status
 * @returns The first task with the given status, or undefined
 */
export function getTaskByStatus(
  db: Database.Database,
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED"
): TaskRow | undefined {
  return db
    .prepare("SELECT * FROM tasks WHERE status = ? LIMIT 1")
    .get(status) as TaskRow | undefined;
}

/**
 * Assert that a file exists in the test directory
 */
export function assertFileExists(
  harness: E2ETestHarness,
  relativePath: string
): void {
  expect(
    harness.fileExists(relativePath),
    `Expected file to exist: ${relativePath}`
  ).toBe(true);
}

/**
 * Assert that a file does not exist in the test directory
 */
export function assertFileNotExists(
  harness: E2ETestHarness,
  relativePath: string
): void {
  expect(
    harness.fileExists(relativePath),
    `Expected file to NOT exist: ${relativePath}`
  ).toBe(false);
}

/**
 * Assert that a file contains specific content
 */
export function assertFileContains(
  harness: E2ETestHarness,
  relativePath: string,
  expectedContent: string
): void {
  assertFileExists(harness, relativePath);
  const content = harness.readFile(relativePath);
  expect(
    content,
    `Expected ${relativePath} to contain "${expectedContent}"`
  ).toContain(expectedContent);
}

/**
 * Count issues in the database
 */
export function countIssues(db: Database.Database): number {
  const result = db.prepare("SELECT COUNT(*) as count FROM issues").get() as {
    count: number;
  };
  return result.count;
}

/**
 * Count tasks with a specific status
 */
export function countTasksByStatus(
  db: Database.Database,
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED"
): number {
  const result = db
    .prepare("SELECT COUNT(*) as count FROM tasks WHERE status = ?")
    .get(status) as { count: number };
  return result.count;
}
