/**
 * UICommand - Manage the web UI service
 *
 * Handles starting, installing, and uninstalling the dev-workflow web UI.
 * Receives all dependencies via constructor injection.
 */

import { execSync } from "node:child_process";
import { UIService } from "../application/ui.service.js";

export interface UICommandDeps {
  cliPath: string;
}

export class UICommand {
  constructor(private readonly deps: UICommandDeps) {}

  /**
   * Start web UI for dev-workflow (shows all projects).
   */
  async start(): Promise<void> {
    const { isPortInUse, getSavedDaemonPort } = await import("../infrastructure/port-manager.js");

    try {
      // If PORT is explicitly set, always start on that port (for E2E tests, parallel instances)
      const explicitPort = process.env["PORT"];
      if (explicitPort) {
        await UIService.startMultiProject();
        return;
      }

      // Check if daemon is already running by checking saved port
      const savedPort = getSavedDaemonPort();
      if (savedPort) {
        const serverRunning = await isPortInUse(savedPort);
        if (serverRunning) {
          const url = `http://127.0.0.1:${savedPort}`;
          console.log(`✓ dev-workflow UI is already running at ${url}`);
          return;
        }
      }

      // Server not running, start it
      await UIService.startMultiProject();
    } catch (error) {
      console.error("Error starting UI:", error);
      process.exit(1);
    }
  }

  /**
   * Install UI as auto-start service using PM2.
   */
  async install(): Promise<void> {
    const { cliPath } = this.deps;

    console.log("🚀 Setting up dev-workflow UI auto-start with PM2...\n");

    try {
      // Check if pm2 is available
      try {
        execSync("npx pm2 --version", { stdio: "pipe" });
      } catch {
        console.error("❌ PM2 is required for auto-start.");
        console.error("   Install it with: npm install -g pm2");
        process.exit(1);
      }

      // Stop existing instance if running
      try {
        execSync("npx pm2 delete dev-workflow-ui", { stdio: "pipe" });
      } catch {
        // Ignore if not running
      }

      // Start with PM2
      const startCmd = `npx pm2 start "node ${cliPath} ui" --name dev-workflow-ui`;
      execSync(startCmd, { stdio: "inherit" });

      // Setup startup script
      console.log("\n📋 Setting up startup script...");
      try {
        execSync("npx pm2 startup", { stdio: "inherit" });
      } catch {
        console.warn("⚠️  Could not setup startup script automatically.");
        console.warn("   Run 'npx pm2 startup' manually and follow the instructions.");
      }

      // Save process list
      execSync("npx pm2 save", { stdio: "inherit" });

      console.log("\n✨ dev-workflow UI installed successfully!");
      console.log("\nThe UI is now running at: http://127.0.0.1:3456");
      console.log("It will start automatically on system boot.");
      console.log("\nUseful commands:");
      console.log("  npx pm2 status          - Check status");
      console.log("  npx pm2 logs dev-workflow-ui - View logs");
      console.log("  dev-workflow ui:uninstall   - Remove auto-start");
    } catch (error) {
      console.error("Error setting up auto-start:", error);
      process.exit(1);
    }
  }

  /**
   * Remove UI auto-start service.
   */
  async uninstall(): Promise<void> {
    console.log("🗑️  Removing dev-workflow UI auto-start...\n");

    try {
      // Stop and delete from PM2
      try {
        execSync("npx pm2 delete dev-workflow-ui", { stdio: "inherit" });
      } catch {
        console.log("   (Process was not running)");
      }

      // Save to persist the removal
      try {
        execSync("npx pm2 save", { stdio: "inherit" });
      } catch {
        // Ignore
      }

      console.log("\n✨ dev-workflow UI auto-start removed.");
      console.log("\nNote: The PM2 startup script is still installed.");
      console.log("To remove it completely, run: npx pm2 unstartup");
    } catch (error) {
      console.error("Error removing auto-start:", error);
      process.exit(1);
    }
  }
}
