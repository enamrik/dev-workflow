import getPort from "get-port";
import { createConnection } from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveGlobalTrackDir } from "@dev-workflow/git/track-directory-resolver.js";

// Re-export shared port file utilities from git
export {
  saveDaemonPort,
  getSavedDaemonPort,
  clearDaemonPort,
  getPortFilePath,
} from "@dev-workflow/git/port-manager.js";

const DEFAULT_PORT = 3456;

// The UI daemon's PID, tracked so `ui:stop`/`ui:status` can find and signal it. Resolved
// per-call so it honors DFL_HOME (the data root), not a hardcoded location.
function pidFile(): string {
  return path.join(resolveGlobalTrackDir(), "ui.pid");
}

export function saveDaemonPid(pid: number): void {
  const file = pidFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(pid), "utf-8");
}

export function getSavedDaemonPid(): number | null {
  try {
    const pid = parseInt(fs.readFileSync(pidFile(), "utf-8").trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function clearDaemonPid(): void {
  try {
    fs.unlinkSync(pidFile());
  } catch {
    // ignore if absent
  }
}

/** True if a process with the given PID is currently alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function findAvailablePort(): Promise<number> {
  // Find a random available port between 3000-9000
  const port = 3000 + Math.floor(Math.random() * 6000);
  return await getPort({ port });
}

/**
 * Get preferred port for daemon, trying default first, then finding available
 */
export async function getDaemonPort(): Promise<number> {
  // Try the default port first, fall back to random if busy
  return await getPort({ port: [DEFAULT_PORT, 3457, 3458, 3459] });
}

/**
 * Check if a port is currently in use by attempting to connect to it
 */
export async function isPortInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });

    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });

    // Timeout after 1 second
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}
