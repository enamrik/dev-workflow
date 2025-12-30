import * as path from "node:path";
import { execSync } from "node:child_process";
import { FileSystem } from "../infrastructure/file-system.js";
import type { Issue } from "@dev-workflow/core";

export class InstallError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "InstallError";
  }
}

interface MCPServerConfig {
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env: Record<string, string>;
  }>;
}

export class InstallService {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly workingDirectory: string,
    private readonly packageRoot: string
  ) {}

  async createTrackDirectory(): Promise<void> {
    try {
      const trackDir = path.join(this.workingDirectory, ".track");
      const defaultTemplatesDir = path.join(trackDir, "config/issues/templates");
      const userTemplatesDir = path.join(trackDir, "issues/templates");

      // Create directory structure
      await this.fileSystem.mkdir(defaultTemplatesDir, { recursive: true });
      await this.fileSystem.mkdir(userTemplatesDir, { recursive: true });

      // Copy default templates to config directory
      const templatesSource = path.join(this.packageRoot, "templates/issues");
      const templates = ["feature.md", "bug.md", "enhancement.md", "task.md"];

      for (const template of templates) {
        await this.fileSystem.copyFile(
          path.join(templatesSource, template),
          path.join(defaultTemplatesDir, template)
        );
      }

      // Create README in user templates directory
      const userTemplatesReadme = `# User Templates

This directory is for your custom issue templates.

## How it works
- Templates here override default templates in \`.track/config/issues/templates/\`
- If a template with the same filename exists here, it takes precedence
- Templates must be markdown files with YAML frontmatter

## Example
Copy a default template and customize it:
\`\`\`bash
cp .track/config/issues/templates/feature.md .track/issues/templates/my-feature.md
\`\`\`

Then edit \`my-feature.md\` to match your needs.

## Frontmatter Format
\`\`\`yaml
---
type: FEATURE | BUG | ENHANCEMENT | TASK
priority: LOW | MEDIUM | HIGH | CRITICAL
labels: [label1, label2]
---
\`\`\`

## Template Metadata
When a template is selected, its frontmatter values will be used as defaults for creating issues:
- \`type\`: Issue type (FEATURE, BUG, ENHANCEMENT, or TASK)
- \`priority\`: Issue priority (LOW, MEDIUM, HIGH, or CRITICAL)
- \`labels\`: Array of labels to apply to the issue

These values can still be overridden when creating an issue explicitly.
`;

      await this.fileSystem.writeFile(
        path.join(userTemplatesDir, "README.md"),
        userTemplatesReadme
      );

      // Create default config
      const config = {
        version: "1.0.0",
        issueTemplates: {
          templatesPath: ".track/config/issues/templates/",
          userTemplatesPath: ".track/issues/templates/",
          defaultTemplate: "feature.md",
        },
      };

      await this.fileSystem.writeFile(
        path.join(trackDir, "config.json"),
        JSON.stringify(config, null, 2)
      );
    } catch (error) {
      throw new InstallError("Failed to create .track directory", error);
    }
  }

  async installSkills(): Promise<void> {
    try {
      const skillsDir = path.join(this.workingDirectory, ".claude/skills/dev-workflow");
      await this.fileSystem.mkdir(skillsDir, { recursive: true });

      const skillsSource = path.join(this.packageRoot, "skills");
      await this.fileSystem.copyDirectory(skillsSource, skillsDir);
    } catch (error) {
      throw new InstallError("Failed to install skills", error);
    }
  }

  async installSubagents(): Promise<void> {
    try {
      const agentsDir = path.join(this.workingDirectory, ".claude/agents/dev-workflow");
      await this.fileSystem.mkdir(agentsDir, { recursive: true });

      const agentsSource = path.join(this.packageRoot, "agents");
      await this.fileSystem.copyDirectory(agentsSource, agentsDir);
    } catch (error) {
      throw new InstallError("Failed to install subagents", error);
    }
  }

  async registerMCPServer(): Promise<void> {
    try {
      const mcpConfigDir = path.join(this.workingDirectory, ".claude/config");
      const mcpConfigPath = path.join(mcpConfigDir, "mcp-servers.json");

      await this.fileSystem.mkdir(mcpConfigDir, { recursive: true });

      // Read existing config or create new one
      let config: MCPServerConfig;
      const exists = await this.fileSystem.exists(mcpConfigPath);

      if (exists) {
        const content = await this.fileSystem.readFile(mcpConfigPath);
        config = JSON.parse(content);
      } else {
        config = { mcpServers: {} };
      }

      // Add dev-workflow MCP server for Claude Code IDE
      config.mcpServers["dev-workflow-tracker"] = {
        command: "npx",
        args: ["dev-workflow", "mcp"],
        env: {
          DATABASE_PATH: path.join(this.workingDirectory, ".track/data/workflow.db"),
          TEMPLATES_PATH: path.join(this.workingDirectory, ".track/config/issues/templates/"),
        },
      };

      await this.fileSystem.writeFile(mcpConfigPath, JSON.stringify(config, null, 2));

      // Also register with claude CLI
      await this.registerWithClaudeCLI();
    } catch (error) {
      throw new InstallError("Failed to register MCP server", error);
    }
  }

  private async registerWithClaudeCLI(): Promise<void> {
    try {
      const dbPath = path.join(this.workingDirectory, ".track/data/workflow.db");
      const templatesPath = path.join(this.workingDirectory, ".track/config/issues/templates/");
      const cliPath = path.join(this.packageRoot, "dist/index.js");

      // Remove existing registration if it exists
      try {
        execSync("claude mcp remove dev-workflow-tracker", { stdio: "ignore" });
      } catch {
        // Ignore error if server doesn't exist
      }

      // Register MCP server with claude CLI
      const command = [
        "claude",
        "mcp",
        "add",
        "--transport",
        "stdio",
        "dev-workflow-tracker",
        "--env",
        `DATABASE_PATH=${dbPath}`,
        "--env",
        `TEMPLATES_PATH=${templatesPath}`,
        "--",
        "node",
        cliPath,
        "mcp",
      ].join(" ");

      execSync(command, { stdio: "inherit" });
    } catch (error) {
      // Don't fail the entire init if claude CLI registration fails
      // (claude CLI might not be installed)
      console.warn("Warning: Could not register with claude CLI (this is optional)");
      console.warn("You can register manually with: claude mcp add --transport stdio dev-workflow-tracker ...");
    }
  }

  async initializeDatabase(): Promise<void> {
    try {
      const dbPath = path.join(this.workingDirectory, ".track/data/workflow.db");
      const dbDir = path.dirname(dbPath);
      await this.fileSystem.mkdir(dbDir, { recursive: true });

      // Import DatabaseService from core package
      const { DatabaseService } = await import("@dev-workflow/core");

      // Create database with automatic native/WASM detection and run migrations
      const dbService = await DatabaseService.create(dbPath);
      dbService.runMigrations();
      dbService.close();
    } catch (error) {
      throw new InstallError("Failed to initialize database", error);
    }
  }

  async createWelcomeIssue(): Promise<Issue> {
    const dbPath = path.join(this.workingDirectory, ".track/data/workflow.db");

    // Import database and repository from core package
    const { DatabaseService, SqliteIssueRepository } = await import("@dev-workflow/core");

    // Create welcome issue and persist to database with automatic native/WASM detection
    const dbService = await DatabaseService.create(dbPath);
    const issueRepository = new SqliteIssueRepository(dbService.getDb());

    const issue = issueRepository.create({
      title: "Setup dev-workflow tracking for this repository",
      description: `This is your first issue created by dev-workflow!

## What is dev-workflow?

dev-workflow is an AI-driven development workflow system that helps you:
- Track issues and tasks
- Generate implementation plans
- Automate development workflows
- Integrate with GitHub and deployment systems

## Next Steps

1. Try creating a new issue:
   - Say: "I want to add user authentication"
   - Or use: \`/issue Add authentication\`

2. Explore the templates in \`.track/config/issues/templates/\`

3. Customize the configuration in \`.track/config.json\`

## Learn More

- Skills are in \`.claude/skills/dev-workflow/\`
- Subagents are in \`.claude/agents/dev-workflow/\`
- MCP server registered in \`.claude/config/mcp-servers.json\`
`,
      acceptanceCriteria: [
        "dev-workflow initialized successfully",
        "Can create issues via Claude Code",
        "Templates are customizable",
      ],
      type: "TASK",
      priority: "MEDIUM",
      status: "OPEN",
      labels: ["setup", "onboarding"],
      templateUsed: "task.md",
      createdBy: "dev-workflow-init",
    });

    dbService.close();

    return issue;
  }
}
