import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';
import { DatabaseAdapter, PreparedStatement, RunResult } from './database-adapter.js';

/**
 * WebAssembly SQLite adapter using sql.js
 * Fallback option, no native build required, ~2-3x slower
 */
export class WasmAdapter implements DatabaseAdapter {
  readonly type = 'wasm' as const;

  constructor(
    private db: SqlJsDatabase,
    private dbPath: string
  ) {}

  exec(sql: string): void {
    this.db.run(sql);
    this.persist(); // WASM needs explicit save
  }

  prepare<T = any>(sql: string): PreparedStatement<T> {
    return {
      run: (...params: any[]): RunResult => {
        this.db.run(sql, params);
        this.persist();
        return {
          changes: this.db.getRowsModified(),
          lastInsertRowid: 0, // sql.js doesn't provide this easily
        };
      },
      get: (...params: any[]): T | undefined => {
        const result = this.db.exec(sql, params);
        if (result.length === 0 || result[0].values.length === 0) {
          return undefined;
        }
        return this.rowToObject<T>(result[0].columns, result[0].values[0]);
      },
      all: (...params: any[]): T[] => {
        const result = this.db.exec(sql, params);
        if (result.length === 0) return [];
        return result[0].values.map(row =>
          this.rowToObject<T>(result[0].columns, row)
        );
      },
      raw: () => ({
        get: (...params: any[]): any[] | undefined => {
          const result = this.db.exec(sql, params);
          if (result.length === 0 || result[0].values.length === 0) {
            return undefined;
          }
          return result[0].values[0];
        },
        all: (...params: any[]): any[][] => {
          const result = this.db.exec(sql, params);
          if (result.length === 0) return [];
          return result[0].values;
        },
      }),
    };
  }

  close(): void {
    this.persist();
    this.db.close();
  }

  /**
   * Persist in-memory database to disk
   * Required because sql.js runs entirely in memory
   */
  private persist(): void {
    const data = this.db.export();
    writeFileSync(this.dbPath, data);
  }

  /**
   * Convert sql.js row array to object
   */
  private rowToObject<T>(columns: string[], values: any[]): T {
    const obj: any = {};
    columns.forEach((col, i) => {
      obj[col] = values[i];
    });
    return obj as T;
  }

  /**
   * Load existing database from disk
   */
  static async load(dbPath: string): Promise<WasmAdapter> {
    const SQL = await initSqlJs();
    let db: SqlJsDatabase;

    try {
      const buffer = readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } catch {
      // Database doesn't exist, create new
      db = new SQL.Database();
    }

    return new WasmAdapter(db, dbPath);
  }
}
