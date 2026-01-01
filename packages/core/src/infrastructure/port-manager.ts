/**
 * Port management utilities for the dev-workflow daemon
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const PORT_FILE = path.join(os.homedir(), ".track", "ui-port");

/**
 * Save the running daemon port to a file
 */
export function saveDaemonPort(port: number): void {
  const dir = path.dirname(PORT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(PORT_FILE, String(port), "utf-8");
}

/**
 * Get the saved daemon port, or null if not saved
 */
export function getSavedDaemonPort(): number | null {
  try {
    const content = fs.readFileSync(PORT_FILE, "utf-8").trim();
    const port = parseInt(content, 10);
    return isNaN(port) ? null : port;
  } catch {
    return null;
  }
}

/**
 * Clear the saved daemon port
 */
export function clearDaemonPort(): void {
  try {
    fs.unlinkSync(PORT_FILE);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Get the path to the port file (for testing/debugging)
 */
export function getPortFilePath(): string {
  return PORT_FILE;
}
