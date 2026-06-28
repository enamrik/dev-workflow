/**
 * McpServerLog — DFL_HOME honoring, append behavior, and size-capped rotation.
 *
 * The log lives at <DFL_HOME>/mcp.log (resolveGlobalTrackDir() returns
 * $DFL_HOME directly when set). Tests point DFL_HOME at a temp dir so they
 * never touch real ~/.dfl.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { McpServerLog } from "../mcp-server-log.js";

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env["DFL_HOME"];
  home = mkdtempSync(path.join(tmpdir(), "dfl-mcp-log-"));
  process.env["DFL_HOME"] = home;
});

afterEach(() => {
  if (prevHome === undefined) {
    delete process.env["DFL_HOME"];
  } else {
    process.env["DFL_HOME"] = prevHome;
  }
  rmSync(home, { recursive: true, force: true });
});

/** Resolve the bytes written to a log after its stream has flushed + closed. */
async function readClosed(log: McpServerLog): Promise<string> {
  await log.close();
  return readFileSync(log.path, "utf8");
}

describe("McpServerLog", () => {
  it("honors DFL_HOME and targets <DFL_HOME>/mcp.log, creating it on first write", async () => {
    const log = new McpServerLog();
    expect(log.path).toBe(path.join(home, "mcp.log"));
    // The stream opens lazily; the file materializes once something is written.
    log.write("first line\n");
    await log.close();
    expect(existsSync(log.path)).toBe(true);
  });

  it("tees raw stderr chunks verbatim (no timestamp framing)", async () => {
    const log = new McpServerLog();
    log.write(Buffer.from("loading config\n"));
    log.write("running on stdio\n");
    expect(await readClosed(log)).toBe("loading config\nrunning on stdio\n");
  });

  it("records a spawn failure as a timestamped diagnostic line", async () => {
    const log = new McpServerLog();
    log.writeLine("Failed to start MCP server: spawn node ENOENT");
    const contents = await readClosed(log);
    expect(contents).toContain("Failed to start MCP server: spawn node ENOENT");
    // ISO-8601 timestamp prefix.
    expect(contents).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("appends to an existing log rather than truncating it", async () => {
    writeFileSync(path.join(home, "mcp.log"), "earlier run\n");
    const log = new McpServerLog();
    log.write("later run\n");
    expect(await readClosed(log)).toBe("earlier run\nlater run\n");
  });

  it("rotates to mcp.log.1 when the existing log exceeds the cap", async () => {
    const logPath = path.join(home, "mcp.log");
    // Seed a file larger than the 1 MB cap.
    writeFileSync(logPath, "x".repeat(1_000_001));

    const log = new McpServerLog();
    log.write("fresh start\n");
    await log.close();

    expect(existsSync(`${logPath}.1`)).toBe(true);
    expect(statSync(`${logPath}.1`).size).toBe(1_000_001);
    // The new log starts clean (only the fresh write).
    expect(readFileSync(logPath, "utf8")).toBe("fresh start\n");
  });

  it("does not rotate a log that is under the cap", async () => {
    const logPath = path.join(home, "mcp.log");
    writeFileSync(logPath, "small\n");

    const log = new McpServerLog();
    await log.close();

    expect(existsSync(`${logPath}.1`)).toBe(false);
  });
});
