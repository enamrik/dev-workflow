import open from "open";
import { FileSystem } from "../infrastructure/file-system.js";
import { findAvailablePort } from "../infrastructure/port-manager.js";
import {
  createServer,
  createMultiProjectServer,
  MultiProjectService,
} from "@dev-workflow/web";
import { TrackDirectoryResolver } from "@dev-workflow/core";

export class UIError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "UIError";
  }
}

/**
 * UIService manages the dev-workflow web UI
 *
 * Supports two modes:
 * 1. Single-project mode: Shows issues for a specific project (when run from a repo)
 * 2. Multi-project mode: Shows issues across all projects (for daemon mode)
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
   */
  async start(): Promise<void> {
    try {
      // Use PORT env var if set, otherwise find available port
      const port = process.env["PORT"]
        ? parseInt(process.env["PORT"], 10)
        : await findAvailablePort();

      // Initialize database
      const dbPath = this.resolver.getDatabasePath();
      const {
        DatabaseService,
        SqliteIssueRepository,
        SqlitePlanRepository,
        SqliteTaskRepository,
        EventBus,
      } = await import("@dev-workflow/core");

      const dbService = await DatabaseService.create(dbPath);
      const db = dbService.getDb();
      const issueRepository = new SqliteIssueRepository(db);
      const planRepository = new SqlitePlanRepository(db);
      const taskRepository = new SqliteTaskRepository(db);

      // Create and start server with real-time updates
      const eventBus = EventBus.getInstance();
      const server = await createServer({
        issueRepository,
        planRepository,
        taskRepository,
        eventBus,
      });
      await server.listen({ port, host: "127.0.0.1" });

      const url = `http://127.0.0.1:${port}`;
      console.log(`🚀 dev-workflow UI started at ${url}`);
      console.log(`   Project: ${this.resolver.getProjectId()}`);
      console.log("\nPress Ctrl+C to stop the server");

      // Open browser (unless disabled via env var for automation/testing)
      if (!process.env["NO_OPEN_BROWSER"]) {
        try {
          await open(url);
        } catch (error) {
          console.warn("⚠️  Could not open browser automatically.");
          console.warn(`   Please visit: ${url}`);
        }
      }

      // Graceful shutdown
      const shutdown = async (signal: string) => {
        console.log(`\n\n📦 Received ${signal}, shutting down gracefully...`);
        await server.close();
        dbService.close();
        console.log("✅ Server closed successfully");
        process.exit(0);
      };

      process.on("SIGINT", () => shutdown("SIGINT"));
      process.on("SIGTERM", () => shutdown("SIGTERM"));

    } catch (error) {
      throw new UIError("Failed to start UI server", error);
    }
  }

  /**
   * Start multi-project UI (for daemon mode)
   * Shows issues and tasks across all projects
   */
  static async startMultiProject(): Promise<void> {
    try {
      // Use PORT env var if set, otherwise use default daemon port
      const port = process.env["PORT"]
        ? parseInt(process.env["PORT"], 10)
        : 3456;

      // Create multi-project service
      const multiProjectService = new MultiProjectService();

      // Create and start multi-project server
      const server = await createMultiProjectServer({
        multiProjectService,
      });
      await server.listen({ port, host: "127.0.0.1" });

      const url = `http://127.0.0.1:${port}`;
      console.log(`🚀 dev-workflow UI (multi-project) started at ${url}`);

      // List projects
      const projects = await multiProjectService.listProjects();
      if (projects.length > 0) {
        console.log(`   Serving ${projects.length} project(s):`);
        for (const project of projects) {
          console.log(`   - ${project.id}`);
        }
      } else {
        console.log("   No projects found. Initialize a project with: dev-workflow init");
      }

      console.log("\nPress Ctrl+C to stop the server");

      // Open browser (unless disabled via env var for automation/testing)
      if (!process.env["NO_OPEN_BROWSER"]) {
        const open = (await import("open")).default;
        try {
          await open(url);
        } catch {
          console.warn("⚠️  Could not open browser automatically.");
          console.warn(`   Please visit: ${url}`);
        }
      }

      // Graceful shutdown
      const shutdown = async (signal: string) => {
        console.log(`\n\n📦 Received ${signal}, shutting down gracefully...`);
        await server.close();
        await multiProjectService.close();
        console.log("✅ Server closed successfully");
        process.exit(0);
      };

      process.on("SIGINT", () => shutdown("SIGINT"));
      process.on("SIGTERM", () => shutdown("SIGTERM"));

    } catch (error) {
      throw new UIError("Failed to start multi-project UI server", error);
    }
  }
}
