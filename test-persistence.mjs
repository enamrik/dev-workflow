#!/usr/bin/env node

import { DatabaseService } from "./packages/mcp-server/dist/infrastructure/database.js";
import { SqliteIssueRepository } from "./packages/mcp-server/dist/infrastructure/issue-repository.js";
import { mkdir } from "fs/promises";
import { existsSync as _existsSync } from "fs";

const DATABASE_PATH = "./.track/data/workflow.db";

console.log("🧪 Testing SQLite Persistence\n");

// Test 1: Create database and add first issue
console.log("Test 1: Creating database and adding first issue...");
await mkdir("./.track/data", { recursive: true });

let dbService = new DatabaseService(DATABASE_PATH);
dbService.runMigrations();

let issueRepository = new SqliteIssueRepository(dbService.getDb());

const issue1 = issueRepository.create({
  title: "First test issue",
  description: "Testing SQLite persistence",
  acceptanceCriteria: ["Issue persists", "Can be retrieved"],
  type: "TASK",
  priority: "MEDIUM",
  status: "OPEN",
  labels: ["test"],
  createdBy: "test-script",
});

console.log(`✓ Created issue #${issue1.number}: ${issue1.title}`);
console.log(`  ID: ${issue1.id}`);

// Test 2: Add second issue
const issue2 = issueRepository.create({
  title: "Second test issue",
  description: "Testing issue numbering",
  acceptanceCriteria: [],
  type: "FEATURE",
  priority: "HIGH",
  status: "OPEN",
  labels: ["test", "numbering"],
  createdBy: "test-script",
});

console.log(`✓ Created issue #${issue2.number}: ${issue2.title}`);

// Close database (simulating server shutdown)
dbService.close();
console.log("✓ Database closed (simulating server shutdown)\n");

// Test 3: Reopen database and verify issues persist
console.log("Test 2: Reopening database and verifying persistence...");
dbService = new DatabaseService(DATABASE_PATH);
dbService.runMigrations();
issueRepository = new SqliteIssueRepository(dbService.getDb());

const retrievedIssue1 = issueRepository.findByNumber(issue1.number);
const retrievedIssue2 = issueRepository.findById(issue2.id);

if (!retrievedIssue1) {
  console.error("❌ FAILED: Could not retrieve issue #1");
  process.exit(1);
}

if (!retrievedIssue2) {
  console.error("❌ FAILED: Could not retrieve issue #2 by ID");
  process.exit(1);
}

console.log(`✓ Retrieved issue #${retrievedIssue1.number}: ${retrievedIssue1.title}`);
console.log(`✓ Retrieved issue #${retrievedIssue2.number} by ID: ${retrievedIssue2.title}`);

// Test 4: Verify issue numbering continues correctly
const issue3 = issueRepository.create({
  title: "Third test issue",
  description: "Testing that numbering continues after restart",
  acceptanceCriteria: [],
  type: "BUG",
  priority: "LOW",
  status: "OPEN",
  labels: [],
  createdBy: "test-script",
});

if (issue3.number !== 3) {
  console.error(`❌ FAILED: Expected issue #3, got #${issue3.number}`);
  process.exit(1);
}

console.log(`✓ Issue numbering continues correctly: #${issue3.number}\n`);

// Test 5: Test filtering
console.log("Test 3: Testing filters...");
const allIssues = issueRepository.findMany();
console.log(`✓ Found ${allIssues.length} total issues`);

const openIssues = issueRepository.findMany({ status: "OPEN" });
console.log(`✓ Found ${openIssues.length} open issues`);

const tasks = issueRepository.findMany({ type: "TASK" });
console.log(`✓ Found ${tasks.length} task(s)`);

const testLabeled = issueRepository.findMany({ labels: ["test"] });
console.log(`✓ Found ${testLabeled.length} issue(s) with 'test' label`);

// Close database
dbService.close();

console.log("\n✅ All persistence tests passed!");
console.log(`\nDatabase file: ${DATABASE_PATH}`);
console.log('You can inspect it with: sqlite3 .track/data/workflow.db "SELECT * FROM issues;"');
