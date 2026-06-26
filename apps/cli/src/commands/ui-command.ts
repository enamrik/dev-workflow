/**
 * UICommand - Manage the web UI daemon
 *
 * `ui` starts the UI as a detached background daemon (terminal returns); `--foreground`
 * runs it attached for debugging. `ui:stop`/`ui:status` manage the daemon. There is no
 * boot auto-start (no PM2): the daemon runs until stopped or the machine reboots.
 */

import { UIService } from "../application/ui.service.js";

export interface UIStartOptions {
  /** Run the server in the foreground (blocks) instead of daemonizing. */
  foreground?: boolean;
}

export class UICommand {
  constructor(private readonly uiService: UIService) {}

  /** Start the web UI (daemon by default; foreground with --foreground). */
  async start(options: UIStartOptions = {}): Promise<void> {
    try {
      if (options.foreground) {
        await this.uiService.runServer();
      } else {
        await this.uiService.start();
      }
    } catch (error) {
      console.error("Error starting UI:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  /** Stop the running UI daemon. */
  async stop(): Promise<void> {
    await this.uiService.stop();
  }

  /** Report whether the UI daemon is running. */
  async status(): Promise<void> {
    await this.uiService.status();
  }
}
