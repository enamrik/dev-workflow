import * as path from "node:path";
import open from "open";
import { FileSystem } from "../infrastructure/file-system.js";
import { findAvailablePort } from "../infrastructure/port-manager.js";
import { createServer } from "../ui/server.js";

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
      // Find available port
      const port = await findAvailablePort();

      // Initialize database
      const dbPath = path.join(this.workingDirectory, ".track/data/workflow.db");
      const { DatabaseService } = await import(
        "@dev-workflow/mcp-server/infrastructure/database.js"
      );
      const { SqliteIssueRepository } = await import(
        "@dev-workflow/mcp-server/infrastructure/issue-repository.js"
      );
      const { SqlitePlanRepository } = await import(
        "@dev-workflow/mcp-server/infrastructure/plan-repository.js"
      );
      const { SqliteTaskRepository } = await import(
        "@dev-workflow/mcp-server/infrastructure/task-repository.js"
      );

      const dbService = await DatabaseService.create(dbPath);
      const db = dbService.getDb();
      const issueRepository = new SqliteIssueRepository(db);
      const planRepository = new SqlitePlanRepository(db);
      const taskRepository = new SqliteTaskRepository(db);

      // Create and start server
      const server = await createServer({
        issueRepository,
        planRepository,
        taskRepository,
      });
      await server.listen({ port, host: "127.0.0.1" });

      const url = `http://127.0.0.1:${port}`;
      console.log(`🚀 dev-workflow UI started at ${url}`);
      console.log("\nPress Ctrl+C to stop the server");

      // Open browser
      try {
        await open(url);
      } catch (error) {
        console.warn("⚠️  Could not open browser automatically.");
        console.warn(`   Please visit: ${url}`);
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
