/**
 * DatabaseService - Backward compatibility alias for SqliteDataSource
 *
 * @deprecated Use SqliteDataSource or DataSourceFactory instead.
 *
 * This module re-exports SqliteDataSource as DatabaseService for backward
 * compatibility with existing code. New code should use:
 *
 * - DataSourceProvider interface (domain/data-source.ts)
 * - SqliteDataSource for SQLite databases
 * - DataSourceFactory for auto-detecting provider from connection string
 *
 * Migration guide:
 *   // Before (deprecated)
 *   import { DatabaseService } from "@dev-workflow/core";
 *   const db = await DatabaseService.create(dbPath);
 *
 *   // After (recommended)
 *   import { DataSourceFactory, type DataSourceProvider } from "@dev-workflow/core";
 *   const db = await DataSourceFactory.create({ connectionString: dbPath });
 *
 *   // Or for explicit SQLite usage
 *   import { SqliteDataSource } from "@dev-workflow/core";
 *   const db = await SqliteDataSource.create(dbPath);
 */

import { SqliteDataSource } from "./sqlite-data-source.js";

/**
 * @deprecated Use SqliteDataSource instead
 */
export const DatabaseService = SqliteDataSource;

/**
 * @deprecated Use SqliteDataSource instead
 */
export type DatabaseService = SqliteDataSource;
