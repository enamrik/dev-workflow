import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDataSource } from "../sqlite-data-source.js";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("SqliteDataSource", () => {
  let dataSource: SqliteDataSource | null = null;
  let testDbPath: string;

  beforeEach(() => {
    // Create a unique temp path for each test
    const testDir = join(tmpdir(), "dev-workflow-test");
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  });

  afterEach(() => {
    // Close the data source
    if (dataSource) {
      dataSource.close();
      dataSource = null;
    }

    // Clean up the test database file
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    // Clean up WAL files if they exist
    if (existsSync(`${testDbPath}-wal`)) {
      unlinkSync(`${testDbPath}-wal`);
    }
    if (existsSync(`${testDbPath}-shm`)) {
      unlinkSync(`${testDbPath}-shm`);
    }
  });

  describe("create", () => {
    it("should create a new SqliteDataSource instance", async () => {
      dataSource = await SqliteDataSource.create(testDbPath);

      expect(dataSource).toBeInstanceOf(SqliteDataSource);
      expect(dataSource.providerId).toBe("sqlite");
      expect(dataSource.displayName).toBe("SQLite");
      expect(dataSource.isRemote).toBe(false);
    });

    it("should create the database file", async () => {
      dataSource = await SqliteDataSource.create(testDbPath);

      expect(existsSync(testDbPath)).toBe(true);
    });
  });

  describe("getDb", () => {
    it("should return a Drizzle database instance", async () => {
      dataSource = await SqliteDataSource.create(testDbPath);

      const db = dataSource.getDb();

      expect(db).toBeDefined();
      // Drizzle instances have a query property
      expect(db.query).toBeDefined();
    });
  });

  describe("runMigrations", () => {
    // Note: Migration tests require the drizzle folder to exist in dist/
    // This is tested implicitly by integration tests that use createTestDatabase
    // from the test setup, which runs migrations in-memory.

    it("should have runMigrations method", async () => {
      dataSource = await SqliteDataSource.create(testDbPath);

      expect(typeof dataSource.runMigrations).toBe("function");
    });
  });

  describe("checkpoint", () => {
    it("should execute WAL checkpoint without error", async () => {
      dataSource = await SqliteDataSource.create(testDbPath);
      // Note: We don't run migrations here, but checkpoint should still work
      // on a fresh database (no-op if no WAL frames to checkpoint)

      // Should not throw
      expect(() => dataSource!.checkpoint()).not.toThrow();
    });
  });

  describe("testConnection", () => {
    it("should return success for valid connection", async () => {
      dataSource = await SqliteDataSource.create(testDbPath);

      const result = await dataSource.testConnection();

      expect(result.success).toBe(true);
      expect(result.latencyMs).toBeDefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getConnectionInfo", () => {
    it("should return correct connection info", async () => {
      dataSource = await SqliteDataSource.create(testDbPath);

      const info = dataSource.getConnectionInfo();

      expect(info.dialect).toBe("sqlite");
      expect(info.description).toBe(testDbPath);
      expect(info.isRemote).toBe(false);
    });
  });

  describe("getAdapterType", () => {
    it("should return the adapter type", async () => {
      dataSource = await SqliteDataSource.create(testDbPath);

      const adapterType = dataSource.getAdapterType();

      // Should be either "native" or "wasm"
      expect(["native", "wasm"]).toContain(adapterType);
    });
  });

  describe("close", () => {
    it("should close the connection", async () => {
      dataSource = await SqliteDataSource.create(testDbPath);

      // Should not throw
      expect(() => dataSource!.close()).not.toThrow();
      dataSource = null; // Prevent double-close in afterEach
    });
  });

  describe("public API", () => {
    it("should have required database service methods", async () => {
      dataSource = await SqliteDataSource.create(testDbPath);

      // These methods should exist for database service functionality
      expect(typeof dataSource.getDb).toBe("function");
      expect(typeof dataSource.runMigrations).toBe("function");
      expect(typeof dataSource.checkpoint).toBe("function");
      expect(typeof dataSource.close).toBe("function");
    });
  });
});
