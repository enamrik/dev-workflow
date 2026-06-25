import * as fs from "node:fs";
import * as path from "node:path";
import type { AwilixContainer } from "awilix";
import { FileSystem } from "../infrastructure/file-system.js";
import { getDaemonPort, saveDaemonPort, clearDaemonPort } from "../infrastructure/port-manager.js";
import { TrackDirectoryResolver } from "@dev-workflow/git/track-directory-resolver.js";
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
 * UIService runs the dev-workflow web UI in-process.
 *
 * The API + WebSocket layer is served by an embedded HTTP server (no Next.js
 * child process). Static UI assets are served from the CLI package's `ui/`
 * directory (the exported SPA build).
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
   * Start single-project UI (for backward compatibility).
   * The UI can filter to the current project via query params.
   */
  async start(): Promise<void> {
    await this.startMultiProject();
  }

  /**
   * Start the multi-project UI by booting the embedded API server.
   * Resolves only when the process receives a shutdown signal.
   */
  async startMultiProject(): Promise<void> {
    const port = process.env["PORT"] ? parseInt(process.env["PORT"], 10) : await getDaemonPort();
    saveDaemonPort(port);

    let serverHandle: ApiServerHandle;
    try {
      registerWebApiServices(this.container);

      const assetsDir = path.join(this.packageRoot, "ui");
      if (!fs.existsSync(assetsDir)) {
        console.warn(
          `⚠️  UI assets not found at ${assetsDir}. Starting API only (the web UI will 503 until assets are built).`
        );
      }

      const url = `http://127.0.0.1:${port}`;
      console.log(`🚀 Starting dev-workflow UI at ${url}`);

      serverHandle = await startApiServer({
        container: this.container,
        port,
        assetsDir,
      });

      console.log(`✓ dev-workflow UI started at ${url}`);
      console.log("\nPress Ctrl+C to stop the server");
    } catch (error) {
      clearDaemonPort();
      throw new UIError("Failed to start UI server", error);
    }

    await new Promise<void>((resolve) => {
      const shutdown = (signal: string): void => {
        console.log(`\n\n📦 Received ${signal}, shutting down gracefully...`);
        clearDaemonPort();
        void serverHandle
          .close()
          .catch(() => undefined)
          .then(() => this.container.dispose())
          .catch(() => undefined)
          .finally(() => resolve());
      };

      process.once("SIGINT", () => shutdown("SIGINT"));
      process.once("SIGTERM", () => shutdown("SIGTERM"));
    });
  }
}
