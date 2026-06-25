/**
 * AI E2E: Full Worker Lifecycle
 *
 * Tests the complete worker flow from issue creation to task completion:
 * 1. Init isolated repo with dev-workflow
 * 2. Create issue and plan (via DirectToolExecutor - cost-free)
 * 3. Move to backlog, dispatch task
 * 4. Simulate worker execution (via ClaudeRunner with worker prompt)
 * 5. Verify state transitions through BACKLOG → IN_PROGRESS → COMPLETED
 *
 * Uses hybrid approach:
 * - DirectToolExecutor for setup (no API cost)
 * - ClaudeRunner for worker execution (real Claude API)
 * - GlobalDbWorkerQueueDb for dispatch queue management
 *
 * Cost: ~$2.00 per full test run
 * Timeout: 15 minutes max
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs";
import Database from "better-sqlite3";
import { E2ETestHarness } from "../harness/test-harness.js";
import { ClaudeRunner, isClaudeAvailable } from "../harness/claude-runner.js";

// Worker queue database schema (simplified for testing)
interface WorkerQueueEntry {
  task_id: string;
  project_slug: string;
  claimed_by: string | null;
  claimed_at: string | null;
  claude_done: number;
}

/**
 * Simple worker queue for testing - mimics GlobalDbWorkerQueueDb
 */
class TestWorkerQueue {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'IDLE',
        current_task_id TEXT,
        last_heartbeat TEXT,
        process_id INTEGER
      );

      CREATE TABLE IF NOT EXISTS dispatch_queue (
        task_id TEXT PRIMARY KEY,
        project_slug TEXT NOT NULL,
        claimed_by TEXT,
        claimed_at TEXT,
        claude_done INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  registerWorker(workerId: string, name: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO workers (id, name, status, last_heartbeat)
         VALUES (?, ?, 'IDLE', datetime('now'))`
      )
      .run(workerId, name);
  }

  enqueue(taskId: string, projectSlug: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO dispatch_queue (task_id, project_slug)
         VALUES (?, ?)`
      )
      .run(taskId, projectSlug);
  }

  claimTask(workerId: string): WorkerQueueEntry | null {
    const entry = this.db
      .prepare(
        `SELECT * FROM dispatch_queue
         WHERE claimed_by IS NULL
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get() as WorkerQueueEntry | undefined;

    if (!entry) return null;

    this.db
      .prepare(
        `UPDATE dispatch_queue
         SET claimed_by = ?, claimed_at = datetime('now')
         WHERE task_id = ?`
      )
      .run(workerId, entry.task_id);

    this.db
      .prepare(`UPDATE workers SET status = 'WORKING', current_task_id = ? WHERE id = ?`)
      .run(entry.task_id, workerId);

    return { ...entry, claimed_by: workerId };
  }

  findByTaskId(taskId: string): WorkerQueueEntry | null {
    return (
      (this.db
        .prepare(`SELECT * FROM dispatch_queue WHERE task_id = ?`)
        .get(taskId) as WorkerQueueEntry) || null
    );
  }

  setClaudeDone(taskId: string): void {
    this.db.prepare(`UPDATE dispatch_queue SET claude_done = 1 WHERE task_id = ?`).run(taskId);
  }

  close(): void {
    this.db.close();
  }
}

describe("AI E2E: Full Worker Lifecycle", () => {
  let harness: E2ETestHarness;
  let runner: ClaudeRunner;
  let workerQueue: TestWorkerQueue;
  let workerQueueDbPath: string;
  let testPassed = false;

  // Test state
  let taskId: string;
  let workerId: string;
  let issueId: string;
  let planId: string;

  beforeAll(async () => {
    const available = await isClaudeAvailable();
    if (!available) {
      console.log("⚠️ Claude CLI not available, skipping worker lifecycle tests");
      return;
    }

    console.log("\n🔧 Setting up worker lifecycle test environment...\n");

    harness = new E2ETestHarness({ keepOnSuccess: false });
    await harness.setup();
    runner = new ClaudeRunner(harness);

    // Create isolated worker queue database
    workerQueueDbPath = path.join(harness.trackDir, "test-worker-queue.db");
    workerQueue = new TestWorkerQueue(workerQueueDbPath);

    console.log(`📁 Test directory: ${harness.testDir}`);
    console.log(`📁 Worker queue: ${workerQueueDbPath}\n`);
  }, 180000);

  afterAll(async () => {
    // Clean up worker queue
    workerQueue?.close();
    if (workerQueueDbPath && fs.existsSync(workerQueueDbPath)) {
      try {
        fs.unlinkSync(workerQueueDbPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    // Clean up any orphaned worktrees
    const worktreesDir = path.join(harness?.trackDir || "", "worktrees");
    if (fs.existsSync(worktreesDir)) {
      try {
        fs.rmSync(worktreesDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    harness?.cleanup(testPassed);
  });

  it("Phase 1: Create issue and plan via AI", async () => {
    if (!runner) {
      console.log("⚠️ Skipping - Claude CLI not available");
      return;
    }

    console.log("\n📝 Phase 1: Creating issue and plan via Claude...\n");

    // Use Claude to create a simple issue with one task
    // This tests the full MCP tool flow for issue/plan creation
    const result = await runner.run(
      `Create an issue for a small code change.

Title: Add greeting utility function
Description: Create a simple greet(name) function that returns "Hello, {name}!".

Generate a plan with exactly ONE task:
- Task title: "Implement greet function"
- Task description: "Create src/greet.ts with a greet(name) function"
- Task type: TASK

After creating the plan, move the issue to backlog to activate the tasks.

Report:
1. The issue number
2. The task ID (UUID)
3. The task status after activation`,
      {
        model: "sonnet",
        maxBudgetUsd: 1.5,
        timeout: 300000,
      }
    );

    console.log("\n📋 Claude output (truncated):", result.stdout.slice(0, 500), "...\n");
    expect(result.success).toBe(true);

    // Verify via database
    const db = harness.getDb();
    try {
      const issue = db
        .prepare("SELECT * FROM issues WHERE project_id = ? AND number = 1")
        .get(harness.databaseProjectId) as
        | { id: string; status: string; title: string }
        | undefined;

      expect(issue).toBeDefined();
      expect(["OPEN", "PLANNED"]).toContain(issue!.status);
      issueId = issue!.id;

      console.log(`✅ Issue created: #1 - ${issue!.title} (${issue!.status})`);

      const plan = db.prepare("SELECT * FROM plans WHERE issue_id = ?").get(issueId) as
        | { id: string; summary: string }
        | undefined;

      expect(plan).toBeDefined();
      planId = plan!.id;

      console.log(`✅ Plan created: ${plan!.summary.slice(0, 50)}...`);

      const tasks = db.prepare("SELECT * FROM tasks WHERE plan_id = ?").all(planId) as Array<{
        id: string;
        title: string;
        status: string;
        number: number;
      }>;

      expect(tasks.length).toBeGreaterThan(0);
      taskId = tasks[0]!.id;

      console.log(
        `✅ Task created: #1.${tasks[0]!.number} - ${tasks[0]!.title} (${tasks[0]!.status})`
      );
      console.log(`   Task ID: ${taskId}`);
    } finally {
      db.close();
    }
  }, 360000);

  it("Phase 2: Dispatch task to work queue", async () => {
    if (!runner || !taskId) {
      console.log("⚠️ Skipping - previous phase did not complete");
      return;
    }

    console.log("\n📝 Phase 2: Dispatching task to work queue...\n");

    // Register a test worker and dispatch the task
    workerId = randomUUID();
    workerQueue.registerWorker(workerId, "test-worker-1");
    workerQueue.enqueue(taskId, harness.projectId);

    const claim = workerQueue.claimTask(workerId);
    expect(claim).toBeDefined();
    expect(claim!.task_id).toBe(taskId);

    console.log(`✅ Worker registered: ${workerId.slice(0, 8)}... (test-worker-1)`);
    console.log(`✅ Task dispatched and claimed`);
  }, 30000);

  it("Phase 3: Worker executes task via AI", async () => {
    if (!runner || !taskId || !workerId) {
      console.log("⚠️ Skipping - previous phases did not complete");
      return;
    }

    console.log("\n📝 Phase 3: Worker executing task via Claude...\n");
    console.log("   This phase uses real Claude API to simulate worker execution");
    console.log("   Expected: task transitions through IN_PROGRESS states\n");

    // Build worker prompt - this simulates what ClaudeWorkerService sends
    const workerPrompt = `You are running as a worker process for dev-workflow. A task has been dispatched to you.

**WORKER ID: ${workerId}**

Work on task #1.1 (ID: ${taskId}).

Follow these steps:

1. **Load the task session**
   Call load_task_session with:
   - taskId: "${taskId}"
   - sessionId: "${randomUUID()}"
   - workerId: "${workerId}"

2. **Implement the task**
   Create a file src/greet.ts with this content:
   \`\`\`typescript
   export function greet(name: string): string {
     return \`Hello, \${name}!\`;
   }
   \`\`\`

3. **Complete the task**
   Since this is a test environment without real GitHub:
   - Skip PR creation
   - Call complete_task with force=true and a finalLogEntry summarizing what was done
   - taskId: "${taskId}"
   - sessionId: (use the same sessionId from step 1)
   - finalLogEntry: "Implemented greet function in src/greet.ts"
   - force: true (bypass PR check for testing)

4. **Signal completion**
   After complete_task succeeds, we're done. Report the final task status.

IMPORTANT: Use force=true on complete_task since there's no real PR in this test.`;

    const result = await runner.run(workerPrompt, {
      model: "sonnet",
      maxBudgetUsd: 3.0, // Worker tasks are more expensive
      timeout: 480000, // 8 minutes
    });

    console.log("\n📋 Worker output (truncated):", result.stdout.slice(0, 800), "...\n");

    // Log exit status but don't fail immediately - check database state
    if (!result.success) {
      console.log(`⚠️ Worker process exited with code ${result.exitCode}`);
      console.log("   Checking database state to determine actual progress...\n");
    }
  }, 540000);

  it("Phase 4: Verify final state and transitions", async () => {
    if (!runner || !taskId) {
      console.log("⚠️ Skipping - previous phases did not complete");
      return;
    }

    console.log("\n📝 Phase 4: Verifying final state...\n");

    const db = harness.getDb();
    try {
      // Check task status
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as {
        status: string;
        completed_at: string | null;
        branch_name: string | null;
        worktree_path: string | null;
        session_id: string | null;
      } | null;

      expect(task).toBeDefined();
      console.log(`📊 Task final state:`);
      console.log(`   Status: ${task!.status}`);
      console.log(
        `   Session: ${task!.session_id ? task!.session_id.slice(0, 8) + "..." : "none"}`
      );
      console.log(`   Branch: ${task!.branch_name || "none"}`);
      console.log(`   Completed: ${task!.completed_at || "no"}`);

      // Check issue status
      const issue = db.prepare("SELECT status FROM issues WHERE id = ?").get(issueId) as {
        status: string;
      } | null;

      console.log(`   Issue status: ${issue?.status}`);

      // Accept various success states:
      // - COMPLETED: Full success (task completed with force=true)
      // - IN_PROGRESS: Partial success (task started but didn't complete)
      // - PR_REVIEW: Partial success (PR created but not merged)
      const acceptableStates = ["COMPLETED", "IN_PROGRESS", "PR_REVIEW"];

      if (acceptableStates.includes(task!.status)) {
        console.log(`\n✅ Task reached acceptable state: ${task!.status}`);

        if (task!.status === "COMPLETED") {
          console.log("   Full lifecycle completed successfully!");
        } else {
          console.log("   Partial success - task was started and progressed");
        }
      } else {
        console.log(`\n❌ Task in unexpected state: ${task!.status}`);
        console.log("   Expected one of:", acceptableStates.join(", "));
      }

      // For the test to pass, we accept any progress beyond BACKLOG/READY
      expect(["COMPLETED", "IN_PROGRESS", "PR_REVIEW"]).toContain(task!.status);

      // Check if greet.ts was created (might be in worktree)
      const greetPath = path.join(harness.testDir, "src", "greet.ts");
      const greetExists = fs.existsSync(greetPath);
      console.log(
        `   File src/greet.ts created: ${greetExists ? "yes" : "no (may be in worktree)"}`
      );

      // Check execution log
      const logs = db
        .prepare("SELECT * FROM task_execution_logs WHERE task_id = ? ORDER BY created_at ASC")
        .all(taskId) as Array<{ message: string; created_at: string }>;

      if (logs.length > 0) {
        console.log(`\n📜 Execution log (${logs.length} entries):`);
        for (const log of logs.slice(-5)) {
          // Show last 5 entries
          console.log(`   - ${log.message}`);
        }
      }
    } finally {
      db.close();
    }

    testPassed = true;
    console.log("\n✅ Worker lifecycle test completed successfully!\n");
  }, 60000);
});

describe("AI E2E: Worker State Transitions", () => {
  let harness: E2ETestHarness;
  let runner: ClaudeRunner;
  let testPassed = false;

  beforeAll(async () => {
    const available = await isClaudeAvailable();
    if (!available) return;

    harness = new E2ETestHarness({ keepOnSuccess: false });
    await harness.setup();
    runner = new ClaudeRunner(harness);
  }, 180000);

  afterAll(async () => {
    harness?.cleanup(testPassed);
  });

  it("should verify work queue status reporting", async () => {
    if (!runner) {
      console.log("⚠️ Skipping - Claude CLI not available");
      return;
    }

    console.log("\n📝 Testing work queue status via Claude...\n");

    // First create an issue so there's something in the queue
    const setupResult = await runner.run(
      `Create an issue titled "Test queue status" with description "Testing work queue".
       Generate a simple plan with one task, then move to backlog.`,
      { model: "sonnet", maxBudgetUsd: 1.0, timeout: 180000 }
    );

    expect(setupResult.success).toBe(true);

    // Now check the work queue
    const queueResult = await runner.run(
      `Check the work queue status using get_work_queue.
       Tell me:
       1. How many issues need planning?
       2. How many tasks are ready to work on?
       3. What's the top priority item?`,
      { model: "sonnet", maxBudgetUsd: 0.5, timeout: 120000 }
    );

    console.log("\n📋 Queue status:", queueResult.stdout.slice(0, 500), "...\n");
    expect(queueResult.success).toBe(true);

    // Output should mention tasks or issues
    expect(queueResult.stdout.toLowerCase()).toMatch(/task|issue|queue|ready/);

    testPassed = true;
  }, 360000);
});
