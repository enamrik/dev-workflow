import { EventEmitter } from "node:events";
import Database from "better-sqlite3";

/**
 * DatabaseChangeMonitor detects cross-process database changes
 *
 * Uses SQLite's PRAGMA data_version to detect when another process
 * has committed changes to the database. This enables real-time UI
 * updates without requiring the MCP server and web server to share
 * a process.
 *
 * How it works:
 * - data_version changes when another connection commits changes
 * - We poll this value at a configurable interval
 * - When it changes, we emit a 'change' event
 * - The WebSocket handler can then broadcast to connected clients
 */
export class DatabaseChangeMonitor extends EventEmitter {
  private db: Database.Database | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private lastDataVersion: number | null = null;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly dbPath: string,
    options: { pollIntervalMs?: number } = {}
  ) {
    super();
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
  }

  /**
   * Start monitoring for database changes
   */
  start(): void {
    if (this.intervalId) {
      return; // Already started
    }

    // Open a dedicated read-only connection for monitoring
    this.db = new Database(this.dbPath, { readonly: true });

    // Get initial data_version
    this.lastDataVersion = this.getDataVersion();

    // Start polling
    this.intervalId = setInterval(() => {
      this.checkForChanges();
    }, this.pollIntervalMs);

    this.emit("started");
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.lastDataVersion = null;
    this.emit("stopped");
  }

  /**
   * Check if database has changed since last check
   */
  private checkForChanges(): void {
    if (!this.db) return;

    const currentVersion = this.getDataVersion();

    if (this.lastDataVersion !== null && currentVersion !== this.lastDataVersion) {
      this.emit("change", {
        previousVersion: this.lastDataVersion,
        currentVersion,
        timestamp: new Date().toISOString(),
      });
    }

    this.lastDataVersion = currentVersion;
  }

  /**
   * Get the current data_version from SQLite
   */
  private getDataVersion(): number {
    if (!this.db) {
      throw new Error("Database not connected");
    }

    const result = this.db.pragma("data_version", { simple: true });
    return result as number;
  }

  /**
   * Check if the monitor is currently running
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }
}
