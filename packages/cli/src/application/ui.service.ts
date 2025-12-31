import * as path from "node:path";
import open from "open";
import { FileSystem } from "../infrastructure/file-system.js";
import { findAvailablePort } from "../infrastructure/port-manager.js";
import { createServer } from "@dev-workflow/web";

export class UIError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "UIError";
  }
}

export class UIService {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly workingDirectory: string
  ) {}

  async isInitialized(): Promise<boolean> {
    const trackDir = path.join(this.workingDirectory, ".track");
    return await this.fileSystem.exists(trackDir);
  }

  async start(): Promise<void> {
    try {
      // Use PORT env var if set, otherwise find available port
      const port = process.env["PORT"]
        ? parseInt(process.env["PORT"], 10)
        : await findAvailablePort();

      // Initialize database
      const dbPath = path.join(this.workingDirectory, ".track/data/workflow.db");
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
}
