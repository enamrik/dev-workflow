/**
 * UI Test Harness
 *
 * Starts the dev-workflow web UI and provides Playwright browser for assertions.
 * Used within scenario tests to verify UI state after workflow operations.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type Page } from "@playwright/test";
import type { E2ETestHarness } from "./test-harness.js";

const DEFAULT_PORT = 3456;

export class UIHarness {
  private serverProcess: ChildProcess | null = null;
  private browser: Browser | null = null;
  private _page: Page | null = null;
  public readonly port: number;
  public readonly baseURL: string;

  constructor(
    private readonly harness: E2ETestHarness,
    port = DEFAULT_PORT
  ) {
    this.port = port;
    this.baseURL = `http://127.0.0.1:${port}`;
  }

  /**
   * Start the web UI server and launch browser
   */
  async start(): Promise<void> {
    // Start the web server
    const devWorkflowCmd = this.harness.getDevWorkflowCommand();
    const [cmd, ...args] = devWorkflowCmd.split(" ");

    console.log(`🌐 Starting web UI at ${this.baseURL}...`);

    this.serverProcess = spawn(cmd!, [...args, "ui"], {
      cwd: this.harness.testDir,
      env: {
        ...process.env,
        PORT: String(this.port),
        NO_OPEN_BROWSER: "true", // Prevent auto-opening browser in E2E tests
      },
      stdio: "pipe",
    });

    // Wait for server to be ready
    await this.waitForServer();
    console.log("✓ Web UI server ready");

    // Launch browser
    this.browser = await chromium.launch({ headless: true });
    this._page = await this.browser.newPage();
    console.log("✓ Browser launched");
  }

  /**
   * Wait for the server to respond
   */
  private async waitForServer(timeout = 15000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const response = await fetch(this.baseURL);
        if (response.ok) return;
      } catch {
        // Server not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Server did not start within ${timeout}ms`);
  }

  /**
   * Get the Playwright page for assertions
   */
  get page(): Page {
    if (!this._page) {
      throw new Error("UIHarness not started. Call start() first.");
    }
    return this._page;
  }

  /**
   * Navigate to a path
   */
  async goto(path: string): Promise<void> {
    await this.page.goto(`${this.baseURL}${path}`);
  }

  /**
   * Stop the server and close browser
   */
  async stop(): Promise<void> {
    if (this._page) {
      await this._page.close();
      this._page = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    if (this.serverProcess) {
      this.serverProcess.kill("SIGTERM");
      this.serverProcess = null;
    }

    console.log("✓ Web UI stopped");
  }
}
