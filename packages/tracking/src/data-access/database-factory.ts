import { DatabaseAdapter } from "./database-adapter.js";
import { NativeAdapter } from "./native-adapter.js";

/**
 * Creates SQLite database adapter using better-sqlite3
 */
export class DatabaseFactory {
  static async createAdapter(dbPath: string): Promise<DatabaseAdapter> {
    const Database = await import("better-sqlite3");
    const db = new Database.default(dbPath);
    db.pragma("foreign_keys = ON");
    return new NativeAdapter(db);
  }
}
