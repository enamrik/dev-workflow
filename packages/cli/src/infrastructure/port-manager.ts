import getPort from "get-port";
import { createConnection } from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const DEFAULT_PORT = 3456;
const PORT_FILE = path.join(os.homedir(), ".track", "ui-port");

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
