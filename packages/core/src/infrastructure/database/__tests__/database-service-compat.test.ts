import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseService } from "../database.js";
import { SqliteDataSource } from "../sqlite-data-source.js";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Tests for DatabaseService backward compatibility
 *
 * DatabaseService is now an alias for SqliteDataSource.
 * These tests verify that existing code using DatabaseService
 * continues to work without modification.
 */
describe("DatabaseService (backward compatibility)", () => {
  let dbService: DatabaseService | null = null;
  let testDbPath: string;

  beforeEach(() => {
    // Create a unique temp path for each test
    const testDir = join(tmpdir(), "dev-workflow-test");
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  });

  afterEach(() => {
    // Close the database
    if (dbService) {
      dbService.close();
      dbService = null;
    }

    // Clean up the test database file
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(`${testDbPath}-wal`)) {
      unlinkSync(`${testDbPath}-wal`);
    }
    if (existsSync(`${testDbPath}-shm`)) {
      unlinkSync(`${testDbPath}-shm`);
    }
  });

  it("should be an alias for SqliteDataSource", () => {
    expect(DatabaseService).toBe(SqliteDataSource);
  });

  it("should create instance using DatabaseService.create()", async () => {
    dbService = await DatabaseService.create(testDbPath);

    expect(dbService).toBeInstanceOf(SqliteDataSource);
  });

  it("should have getDb method", async () => {
    dbService = await DatabaseService.create(testDbPath);

    const db = dbService.getDb();

    expect(db).toBeDefined();
    expect(db.query).toBeDefined();
  });

  it("should have runMigrations method", async () => {
    dbService = await DatabaseService.create(testDbPath);

    // Method should exist
    expect(typeof dbService.runMigrations).toBe("function");
  });

  it("should have checkpoint method", async () => {
    dbService = await DatabaseService.create(testDbPath);
    // Note: checkpoint works on fresh DBs (no-op if no WAL frames)

    expect(() => dbService!.checkpoint()).not.toThrow();
  });

  it("should have close method", async () => {
    dbService = await DatabaseService.create(testDbPath);

    expect(() => dbService!.close()).not.toThrow();
    dbService = null; // Prevent double-close in afterEach
  });

  it("should work with existing import patterns", async () => {
    // This simulates the existing usage pattern in consumer code:
    // import { DatabaseService } from "@dev-workflow/core";
    // const dbService = await DatabaseService.create(dbPath);
    // const db = dbService.getDb();

    dbService = await DatabaseService.create(testDbPath);
    const db = dbService.getDb();

    // Should have a db instance with query property (Drizzle API)
    expect(db).toBeDefined();
    expect(db.query).toBeDefined();
    expect(db.query.issues).toBeDefined();
  });
});
