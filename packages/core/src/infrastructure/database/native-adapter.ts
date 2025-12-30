import Database from 'better-sqlite3';
import { DatabaseAdapter, PreparedStatement, RunResult } from './database-adapter.js';

/**
 * Native SQLite adapter using better-sqlite3
 * Fastest option, requires native build
 */
export class NativeAdapter implements DatabaseAdapter {
  readonly type = 'native' as const;

  constructor(private db: Database.Database) {}

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare<T = any>(sql: string): PreparedStatement<T> {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: any[]): RunResult => {
        const info = stmt.run(...params);
        return {
          changes: info.changes,
          lastInsertRowid: Number(info.lastInsertRowid),
        };
      },
      get: (...params: any[]): T | undefined => stmt.get(...params) as T | undefined,
      all: (...params: any[]): T[] => stmt.all(...params) as T[],
      raw: () => ({
        get: (...params: any[]): any[] | undefined => stmt.raw().get(...params) as any[] | undefined,
        all: (...params: any[]): any[][] => stmt.raw().all(...params) as any[][],
      }),
    };
  }

  close(): void {
    this.db.close();
  }
}
