import getPort from "get-port";
import { createConnection } from "node:net";

// Re-export shared port file utilities from core
export {
  saveDaemonPort,
  getSavedDaemonPort,
  clearDaemonPort,
  getPortFilePath,
} from "@dev-workflow/core";

const DEFAULT_PORT = 3456;

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
