/**
 * Re-export PostgreSQL schema as a namespace
 *
 * This ensures the pgSchema doesn't pollute the main SQLite schema exports
 * when using `* as schema from "@dev-workflow/core"`.
 */
export * as pgSchema from "./schema-pg.js";
