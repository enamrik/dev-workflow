import { DatabaseAdapter } from './database-adapter.js';
import { NativeAdapter } from './native-adapter.js';
import { WasmAdapter } from './wasm-adapter.js';

/**
 * Detects available SQLite backend and creates appropriate adapter
 * Prefers native for performance, falls back to WASM for compatibility
 */
export class DatabaseFactory {
  static async createAdapter(dbPath: string): Promise<DatabaseAdapter> {
    // Try native first
    if (await this.isNativeAvailable()) {
      console.error('ℹ️  Using native SQLite (better-sqlite3)');
      return this.createNativeAdapter(dbPath);
    }

    // Fallback to WASM
    console.error('ℹ️  Using WebAssembly SQLite (sql.js) - native build unavailable');
    return await this.createWasmAdapter(dbPath);
  }

  private static async isNativeAvailable(): Promise<boolean> {
    try {
      const Database = await import('better-sqlite3');
      // Try to instantiate to verify bindings work
      const testDb = new Database.default(':memory:');
      testDb.close();
      return true;
    } catch {
      return false;
    }
  }

  private static async createNativeAdapter(dbPath: string): Promise<NativeAdapter> {
    const Database = await import('better-sqlite3');
    const db = new Database.default(dbPath);
    db.pragma('foreign_keys = ON');
    return new NativeAdapter(db);
  }

  private static async createWasmAdapter(dbPath: string): Promise<WasmAdapter> {
    return await WasmAdapter.load(dbPath);
  }
}
