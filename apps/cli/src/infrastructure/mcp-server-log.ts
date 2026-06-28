/**
 * McpServerLog — an on-disk record of the spawned MCP server's diagnostics.
 *
 * `dfl mcp` launches the MCP server as a child whose stdout carries the
 * JSON-RPC stream and whose stderr carries diagnostics (config loading,
 * "running on stdio", and fatal startup errors). Claude Code captures that
 * stderr but only ever surfaces it as a bare `-32000`, so the real cause of a
 * failed start is invisible. This object owns the persistent copy of that
 * stderr: the log file's path, size-capped rotation, and the append stream.
 * It does NOT touch stdout — the JSON-RPC stream must stay pure.
 *
 * Storage mirrors worker-session-log.ts: the path resolves via
 * resolveGlobalTrackDir() so it honors DFL_HOME, and the directory is created
 * at open time. The log lives at <DFL_HOME-or-~/.dfl/track>/mcp.log.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveGlobalTrackDir } from "@dev-workflow/git/track-directory-resolver.js";

/**
 * Rotate the log once it exceeds this size. A single previous generation is
 * kept as mcp.log.1, so on-disk usage is capped at ~2x this value.
 */
const MAX_LOG_BYTES = 1_000_000;

export class McpServerLog {
  private readonly filePath: string;
  private readonly stream: fs.WriteStream;

  constructor() {
    const dir = resolveGlobalTrackDir();
    fs.mkdirSync(dir, { recursive: true });

    this.filePath = path.join(dir, "mcp.log");
    // Rotate BEFORE opening so the fresh stream writes into a clean file.
    this.rotateIfTooLarge();

    this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
    // Logging is best-effort: a write/open failure must never crash the launcher.
    this.stream.on("error", () => {});
  }

  /** Absolute path to the log file. */
  get path(): string {
    return this.filePath;
  }

  /** Append a raw chunk — e.g. a tee'd chunk of the child's stderr. */
  write(chunk: Buffer | string): void {
    this.stream.write(chunk);
  }

  /** Append one timestamped diagnostic line — e.g. a spawn/config failure. */
  writeLine(message: string): void {
    this.stream.write(`${new Date().toISOString()} ${message}\n`);
  }

  /** Flush and close the stream. Resolves once the file is fully written. */
  close(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.stream.end(() => resolve());
    });
  }

  /**
   * Rename the current log to mcp.log.1 when it exceeds MAX_LOG_BYTES, so it
   * never grows unbounded. Tolerates a missing file (nothing to rotate) and
   * rename races — rotation must never crash the launcher.
   */
  private rotateIfTooLarge(): void {
    try {
      if (fs.statSync(this.filePath).size > MAX_LOG_BYTES) {
        fs.renameSync(this.filePath, `${this.filePath}.1`);
      }
    } catch {
      // No existing file, or a rename race — nothing to rotate.
    }
  }
}
