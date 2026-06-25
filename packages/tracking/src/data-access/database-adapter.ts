/**
 * Interface for SQLite database adapter using better-sqlite3
 */
export interface DatabaseAdapter {
  exec(sql: string): void;
  prepare<T = any>(sql: string): PreparedStatement<T>;
  close(): void;
  readonly type: "native";
}

export interface PreparedStatement<T = any> {
  run(...params: any[]): { changes: number; lastInsertRowid: number };
  get(...params: any[]): T | undefined;
  all(...params: any[]): T[];
  raw(): RawStatement;
}

export interface RawStatement {
  get(...params: any[]): any[] | undefined;
  all(...params: any[]): any[][];
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}
