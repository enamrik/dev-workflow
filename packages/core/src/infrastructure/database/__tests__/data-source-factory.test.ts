import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataSourceFactory } from "../data-source-factory.js";
import { SqliteDataSource } from "../sqlite-data-source.js";
import { DataSourceError } from "../../../domain/data-source.js";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("DataSourceFactory", () => {
  let testDbPath: string;
  let createdDataSources: Array<{ close: () => void }> = [];

  beforeEach(() => {
    // Create a unique temp path for each test
    const testDir = join(tmpdir(), "dev-workflow-test");
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    createdDataSources = [];
  });

  afterEach(() => {
    // Close all created data sources
    for (const ds of createdDataSources) {
      try {
        ds.close();
      } catch {
        // Ignore close errors
      }
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
    it("should create SqliteDataSource for file paths", async () => {
      const dataSource = await DataSourceFactory.create({
        connectionString: testDbPath,
      });
      createdDataSources.push(dataSource);

      expect(dataSource).toBeInstanceOf(SqliteDataSource);
      expect(dataSource.providerId).toBe("sqlite");
    });

    it("should create SqliteDataSource when provider explicitly set to sqlite", async () => {
      const dataSource = await DataSourceFactory.create({
        connectionString: testDbPath,
        provider: "sqlite",
      });
      createdDataSources.push(dataSource);

      expect(dataSource).toBeInstanceOf(SqliteDataSource);
    });

    it("should throw DataSourceError for neon provider (not implemented)", async () => {
      await expect(
        DataSourceFactory.create({
          connectionString: "postgresql://user:pass@host/db",
          provider: "neon",
        })
      ).rejects.toThrow(DataSourceError);
    });

    it("should auto-detect neon from postgresql:// URL and throw (not implemented)", async () => {
      await expect(
        DataSourceFactory.create({
          connectionString: "postgresql://user:pass@host/db",
        })
      ).rejects.toThrow("Neon PostgreSQL provider is not yet implemented");
    });

    it("should auto-detect neon from postgres:// URL and throw (not implemented)", async () => {
      await expect(
        DataSourceFactory.create({
          connectionString: "postgres://user:pass@host/db",
        })
      ).rejects.toThrow("Neon PostgreSQL provider is not yet implemented");
    });
  });

  describe("createSqlite", () => {
    it("should create SqliteDataSource directly", async () => {
      const dataSource = await DataSourceFactory.createSqlite(testDbPath);
      createdDataSources.push(dataSource);

      expect(dataSource).toBeInstanceOf(SqliteDataSource);
      expect(dataSource.providerId).toBe("sqlite");
    });
  });

  describe("isRemote", () => {
    it("should return false for file paths", () => {
      expect(DataSourceFactory.isRemote("/path/to/db.sqlite")).toBe(false);
      expect(DataSourceFactory.isRemote("./relative/path.db")).toBe(false);
      expect(DataSourceFactory.isRemote("workflow.db")).toBe(false);
    });

    it("should return true for postgresql URLs", () => {
      expect(DataSourceFactory.isRemote("postgresql://user:pass@host/db")).toBe(true);
      expect(DataSourceFactory.isRemote("postgres://user:pass@host/db")).toBe(true);
    });
  });

  describe("provider detection", () => {
    it("should default to sqlite for non-URL strings", async () => {
      const dataSource = await DataSourceFactory.create({
        connectionString: testDbPath,
      });
      createdDataSources.push(dataSource);

      expect(dataSource.providerId).toBe("sqlite");
    });
  });
});
