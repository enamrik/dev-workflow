/**
 * Port management utilities for the dev-workflow daemon
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveGlobalTrackDir } from "./track-directory-resolver.js";

// Resolved per-call so it honors DWF_HOME (set at runtime by tests/sandbox), not just at import.
function portFile(): string {
  return path.join(resolveGlobalTrackDir(), "ui-port");
}

/**
 * Save the running daemon port to a file
 */
export function saveDaemonPort(port: number): void {
  const file = portFile();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(file, String(port), "utf-8");
}

/**
 * Get the saved daemon port, or null if not saved
 */
export function getSavedDaemonPort(): number | null {
  try {
    const content = fs.readFileSync(portFile(), "utf-8").trim();
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
    fs.unlinkSync(portFile());
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Get the path to the port file (for testing/debugging)
 */
export function getPortFilePath(): string {
  return portFile();
}
