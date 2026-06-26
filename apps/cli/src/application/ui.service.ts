import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, execSync } from "node:child_process";
import type { AwilixContainer } from "awilix";
import { FileSystem } from "../infrastructure/file-system.js";
import {
  getDaemonPort,
  saveDaemonPort,
  getSavedDaemonPort,
  clearDaemonPort,
  saveDaemonPid,
  getSavedDaemonPid,
  clearDaemonPid,
  isProcessAlive,
  isPortInUse,
} from "../infrastructure/port-manager.js";
import { resolveCliEntry } from "../infrastructure/cli-entry.js";
import {
  TrackDirectoryResolver,
  resolveGlobalTrackDir,
} from "@dev-workflow/git/track-directory-resolver.js";
import { registerWebApiServices } from "../server/register-web-api-services.js";
import { startApiServer, type ApiServerHandle } from "../server/http-server.js";

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
 * UIService runs the dev-workflow web UI: an in-process HTTP + WebSocket server (no Next.js
 * child process). `start()` launches it as a detached background daemon so the terminal
 * returns; `runServer()` is the long-running body (used by the daemon and by `--foreground`).
 * There is no boot auto-start — the daemon lives until `stop()` or a reboot.
 */
export class UIService {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly resolver: TrackDirectoryResolver,
    private readonly container: AwilixContainer,
    private readonly packageRoot: string
  ) {}

  async isInitialized(): Promise<boolean> {
    const trackDir = this.resolver.getTrackDirectory();
    return await this.fileSystem.exists(trackDir);
  }

  /**
   * Start the UI as a detached background daemon and return (terminal is freed).
   * If a daemon is already running, just report it.
   */
  async start(): Promise<void> {
    const existing = this.runningDaemon();
    if (existing) {
      console.log(`✓ dev-workflow UI already running at http://127.0.0.1:${existing.port}`);
      return;
    }

    const port = process.env["PORT"] ? parseInt(process.env["PORT"], 10) : await getDaemonPort();
    // Only reclaim if we have a stale pid file — evidence a prior dfl daemon died without cleanup.
    // Avoids killing unrelated processes that happen to be on port 3456.
    const stalePid = getSavedDaemonPid();
    if (stalePid !== null && !isProcessAlive(stalePid)) {
      this.reclaimPort(port);
    }
    const logPath = path.join(resolveGlobalTrackDir(), "ui.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logFd = fs.openSync(logPath, "a");

    const child = spawn(
      process.execPath,
      [resolveCliEntry(this.packageRoot), "ui", "--foreground"],
      {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: { ...process.env, PORT: String(port) },
      }
    );
    child.unref();
    fs.closeSync(logFd);

    if (child.pid === undefined) {
      throw new UIError("Failed to spawn UI daemon");
    }
    saveDaemonPid(child.pid);
    saveDaemonPort(port);

    // Wait for the server to accept connections; if it never does, clean up and fail.
    const url = `http://127.0.0.1:${port}`;
    const ready = await this.waitForPort(port, 20000);
    if (!ready) {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        // already gone
      }
      clearDaemonPid();
      clearDaemonPort();
      throw new UIError(`UI daemon did not become ready on ${url} (see ${logPath})`);
    }

    console.log(`✓ dev-workflow UI started at ${url}`);
    console.log(`  logs:  ${logPath}`);
    console.log(`  stop:  dfl ui:stop`);
  }

  /**
   * Run the server in the foreground (blocks until SIGINT/SIGTERM). This is the daemon's
   * body (spawned with --foreground) and is also usable directly for debugging.
   */
  async runServer(): Promise<void> {
    const port = process.env["PORT"] ? parseInt(process.env["PORT"], 10) : await getDaemonPort();
    saveDaemonPort(port);

    let serverHandle: ApiServerHandle;
    try {
      registerWebApiServices(this.container);
      const assetsDir = path.join(this.packageRoot, "ui");
      if (!fs.existsSync(assetsDir)) {
        console.warn(`⚠️  UI assets not found at ${assetsDir}. Serving API only.`);
      }
      console.log(`🚀 dev-workflow UI on http://127.0.0.1:${port}`);
      serverHandle = await startApiServer({ container: this.container, port, assetsDir });
    } catch (error) {
      clearDaemonPort();
      throw new UIError("Failed to start UI server", error);
    }

    await new Promise<void>((resolve) => {
      const shutdown = (): void => {
        clearDaemonPort();
        clearDaemonPid();
        void serverHandle
          .close()
          .catch(() => undefined)
          .then(() => this.container.dispose())
          .catch(() => undefined)
          .finally(() => resolve());
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  }

  /** Stop the running daemon, if any. Always reclaims the port even when pid tracking has drifted. */
  async stop(): Promise<void> {
    const pid = getSavedDaemonPid();
    const port = getSavedDaemonPort();
    if (pid === null || !isProcessAlive(pid)) {
      clearDaemonPid();
      clearDaemonPort();
      if (port !== null) {
        this.reclaimPort(port);
      }
      console.log("dev-workflow UI is not running.");
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already exited
    }
    // Give the daemon time to shut down gracefully before force-reclaiming the port.
    const gracefulDeadline = Date.now() + 3000;
    while (Date.now() < gracefulDeadline && isProcessAlive(pid)) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (port !== null) {
      this.reclaimPort(port);
    }
    clearDaemonPid();
    clearDaemonPort();
    console.log("✓ dev-workflow UI stopped.");
  }

  /** Report daemon status. */
  async status(): Promise<void> {
    const running = this.runningDaemon();
    if (running) {
      console.log(
        `dev-workflow UI: running (pid ${running.pid}) at http://127.0.0.1:${running.port}`
      );
    } else {
      console.log("dev-workflow UI: not running");
    }
  }

  private runningDaemon(): { pid: number; port: number } | null {
    const pid = getSavedDaemonPid();
    const port = getSavedDaemonPort();
    if (pid !== null && port !== null && isProcessAlive(pid)) {
      return { pid, port };
    }
    return null;
  }

  private async waitForPort(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await isPortInUse(port)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  /** Kill any process holding the given TCP port via lsof + SIGKILL. */
  private reclaimPort(port: number): void {
    try {
      const pids = execSync(`lsof -ti tcp:${port}`, { encoding: "utf-8" })
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(parseInt(pid, 10), "SIGKILL");
        } catch {
          // already gone
        }
      }
    } catch {
      // lsof exits non-zero when nothing is on the port — that's fine
    }
  }

  /** Restart the daemon if one is running — stop, wait for port to free, then start. */
  async restart(): Promise<void> {
    if (!this.runningDaemon()) {
      return;
    }
    await this.stop();
    const port = process.env["PORT"] ? parseInt(process.env["PORT"], 10) : await getDaemonPort();
    // Wait until the port is actually free before re-spawning
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && (await isPortInUse(port))) {
      await new Promise((r) => setTimeout(r, 200));
    }
    await this.start();
  }
}
