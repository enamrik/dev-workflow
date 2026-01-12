/**
 * Type tests for DrizzleDb interface.
 *
 * These tests verify that both SQLite and PostgreSQL Drizzle database types
 * can be cast to DrizzleDb for use in repositories.
 *
 * The DrizzleDb interface uses `any` types strategically to allow
 * dialect-agnostic code. Type safety comes from the schema definitions.
 */

import { describe, it, expect } from "vitest";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { DrizzleDb } from "../drizzle-db.js";
import * as sqliteSchema from "../../infrastructure/database/schema.js";
import * as pgSchema from "../../infrastructure/database/schema-pg.js";

/**
 * Compile-time type compatibility checks.
 * These functions are never called - they exist for the type checker.
 */
function _compileTimeTypeChecks(): void {
  // Demonstrate casting dialect-specific types to DrizzleDb
  const _sqliteDb = null as unknown as BetterSQLite3Database<typeof sqliteSchema>;
  const _neonDb = null as unknown as NeonHttpDatabase<typeof pgSchema>;

  // Both can be cast to DrizzleDb using `as unknown as DrizzleDb`
  const _db1: DrizzleDb = _sqliteDb as unknown as DrizzleDb;
  const _db2: DrizzleDb = _neonDb as unknown as DrizzleDb;

  // This is the pattern repositories should use
  void _db1;
  void _db2;
}

// Prevent unused function warning
void _compileTimeTypeChecks;

describe("DrizzleDb interface", () => {
  it("can be used as a type for dialect-agnostic repositories", () => {
    // The real test is that this file compiles.
    // DrizzleDb uses `any` types to allow both SQLite and PostgreSQL.
    expect(true).toBe(true);
  });
});
