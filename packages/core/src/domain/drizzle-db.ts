/**
 * DrizzleDb - Dialect-agnostic interfaces for Drizzle ORM
 *
 * These interfaces abstract over BetterSQLite3Database and NeonHttpDatabase,
 * allowing single repository implementations that work with both SQLite and PostgreSQL.
 *
 * IMPORTANT: Drizzle's TypeScript types are deeply dialect-specific. These interfaces
 * use `any` strategically to allow the same repository code to work with both backends.
 * Type safety comes from the table definitions (sqliteTable/pgTable) and Drizzle's
 * query builder, not from this abstraction layer.
 *
 * Usage:
 * ```typescript
 * // At instantiation, cast the dialect-specific db to DrizzleDb
 * const db: DrizzleDb = drizzle(adapter, { schema }) as unknown as DrizzleDb;
 *
 * // Repositories use DrizzleDb
 * class IssueRepository {
 *   constructor(private readonly db: DrizzleDb) {}
 * }
 * ```
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SQL } from "drizzle-orm";

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of a mutation operation (INSERT, UPDATE, DELETE).
 */
export interface MutationResult {
  /** Number of rows affected */
  changes: number;
  /** Last inserted row ID (SQLite) or undefined (PostgreSQL) */
  lastInsertRowid?: number | bigint;
}

// =============================================================================
// Query Builder Interfaces
// =============================================================================

/**
 * SELECT query builder.
 *
 * This interface is thenable (PromiseLike) because Drizzle query builders
 * execute when awaited. Uses `any` for method chaining since the actual
 * types differ by dialect.
 *
 * Usage:
 * ```typescript
 * // Await to execute and get results as array
 * const rows = await db.select().from(table).where(...);
 *
 * // Or use explicit methods
 * const rows = db.select().from(table).all();
 * const row = db.select().from(table).get();
 * ```
 */
export interface DrizzleSelectBuilder<TResult = any> extends PromiseLike<TResult[]> {
  from(table: any): DrizzleSelectBuilder<TResult>;
  leftJoin(table: any, condition: SQL): DrizzleSelectBuilder<TResult>;
  innerJoin(table: any, condition: SQL): DrizzleSelectBuilder<TResult>;
  where(condition: SQL | undefined): DrizzleSelectBuilder<TResult>;
  groupBy(...columns: any[]): DrizzleSelectBuilder<TResult>;
  limit(n: number): DrizzleSelectBuilder<TResult>;
  offset(n: number): DrizzleSelectBuilder<TResult>;
  orderBy(...columns: any[]): DrizzleSelectBuilder<TResult>;
  all(): TResult[];
  get(): TResult | undefined;
}

/**
 * INSERT query builder.
 */
export interface DrizzleInsertBuilder {
  values(data: any): DrizzleInsertBuilder;
  returning(): DrizzleSelectBuilder;
  run(): MutationResult;
}

/**
 * UPDATE query builder.
 */
export interface DrizzleUpdateBuilder {
  set(data: any): DrizzleUpdateBuilder;
  where(condition: SQL | undefined): DrizzleUpdateBuilder;
  run(): MutationResult;
}

/**
 * DELETE query builder.
 */
export interface DrizzleDeleteBuilder {
  where(condition: SQL | undefined): DrizzleDeleteBuilder;
  run(): MutationResult;
}

// =============================================================================
// Database Interface
// =============================================================================

/**
 * Dialect-agnostic Drizzle database interface.
 *
 * Both BetterSQLite3Database and NeonHttpDatabase can be cast to this interface,
 * allowing repositories to work with either backend.
 *
 * The `any` types allow flexibility while the actual Drizzle runtime
 * ensures correctness through the schema definitions.
 */
export interface DrizzleDb {
  /**
   * Start a SELECT query.
   */
  select(fields?: any): DrizzleSelectBuilder;

  /**
   * Start an INSERT query for the given table.
   */
  insert(table: any): DrizzleInsertBuilder;

  /**
   * Start an UPDATE query for the given table.
   */
  update(table: any): DrizzleUpdateBuilder;

  /**
   * Start a DELETE query for the given table.
   */
  delete(table: any): DrizzleDeleteBuilder;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
