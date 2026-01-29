import { spawn } from "node:child_process";
import * as path from "node:path";
import { createRequire } from "node:module";
import { FileSystem } from "../infrastructure/file-system.js";
import {
  getDaemonPort,
  saveDaemonPort,
  clearDaemonPort,
  isPortInUse,
} from "../infrastructure/port-manager.js";
import { TrackDirectoryResolver } from "@dev-workflow/git/track-directory-resolver.js";

const require = createRequire(import.meta.url);

export class UIError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "UIError";
  }
}

/**
 * Get the path to the web package
 */
function getWebPath(): string {
  // Resolve from this package's node_modules
  const webPackage = require.resolve("@dev-workflow/web/package.json");
  return path.dirname(webPackage);
}

/**
 * UIService manages the dev-workflow web UI
 *
 * Uses Next.js for the web server, spawning it as a child process.
 */
export class UIService {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly resolver: TrackDirectoryResolver
  ) {}

  async isInitialized(): Promise<boolean> {
    const trackDir = this.resolver.getTrackDirectory();
    return await this.fileSystem.exists(trackDir);
  }

  /**
   * Start single-project UI (for backward compatibility)
   * Note: Now uses the same multi-project server, just filters to current project
   */
  async start(): Promise<void> {
    // For now, just start multi-project mode
    // The UI can filter to the current project via query params
    await UIService.startMultiProject();
  }

  /**
   * Start multi-project UI by spawning Next.js
   */
  static async startMultiProject(): Promise<void> {
    try {
      // Use PORT env var if set, otherwise find available port (preferring default)
      const port = process.env["PORT"] ? parseInt(process.env["PORT"], 10) : await getDaemonPort();

      // Save the port so clients can find us
      saveDaemonPort(port);

      const webPath = getWebPath();
      const url = `http://127.0.0.1:${port}`;

      console.log(`🚀 Starting dev-workflow UI at ${url}`);
      console.log(`   Using Next.js from: ${webPath}`);

      // Spawn the custom server (includes WebSocket support)
      const nextProcess = spawn("node", ["dist/server.js"], {
        cwd: webPath,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PORT: String(port),
          NODE_ENV: "production",
        },
      });

      // Wait for server to be ready
      await UIService.waitForServer(port, 30000);

      console.log(`✓ dev-workflow UI started at ${url}`);
      console.log("\nPress Ctrl+C to stop the server");

      // Forward output
      nextProcess.stdout?.on("data", (data) => {
        process.stdout.write(data);
      });
      nextProcess.stderr?.on("data", (data) => {
        process.stderr.write(data);
      });

      // Handle process exit
      nextProcess.on("exit", (code) => {
        clearDaemonPort();
        if (code !== 0 && code !== null) {
          console.error(`Next.js exited with code ${code}`);
        }
        process.exit(code ?? 0);
      });

      // Graceful shutdown
      const shutdown = (signal: string) => {
        console.log(`\n\n📦 Received ${signal}, shutting down gracefully...`);
        clearDaemonPort();
        nextProcess.kill("SIGTERM");
      };

      process.on("SIGINT", () => shutdown("SIGINT"));
      process.on("SIGTERM", () => shutdown("SIGTERM"));
    } catch (error) {
      clearDaemonPort();
      throw new UIError("Failed to start UI server", error);
    }
  }

  /**
   * Wait for the server to be ready
   */
  private static async waitForServer(port: number, timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (await isPortInUse(port)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new UIError(`Server did not start within ${timeoutMs}ms`);
  }

  /**
   * Check if the UI daemon is running via PM2
   */
  static async isDaemonRunning(): Promise<boolean> {
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync("npx pm2 jlist", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const processes = JSON.parse(output) as Array<{
        name: string;
        pm2_env?: { status?: string };
      }>;
      const uiProcess = processes.find((p) => p.name === "dev-workflow-ui");
      return uiProcess?.pm2_env?.status === "online";
    } catch {
      return false;
    }
  }

  /**
   * Restart the UI daemon via PM2
   */
  static async restartDaemon(): Promise<void> {
    const { execSync } = await import("node:child_process");
    execSync("npx pm2 restart dev-workflow-ui", { stdio: "inherit" });
  }
}
