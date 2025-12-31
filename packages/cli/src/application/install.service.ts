import * as path from "node:path";
import { execSync } from "node:child_process";
import { FileSystem } from "../infrastructure/file-system.js";
import { TrackDirectoryResolver } from "@dev-workflow/core";

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
    private readonly packageRoot: string,
    private readonly resolver: TrackDirectoryResolver
  ) {}

  async createTrackDirectory(): Promise<void> {
    try {
      const defaultTemplatesDir = this.resolver.getTemplatesPath();
      const userTemplatesDir = this.resolver.getUserTemplatesPath();

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
- Templates here override default templates in the config/issues/templates/ directory
- If a template with the same filename exists here, it takes precedence
- Templates must be markdown files with YAML frontmatter

## Frontmatter Format
\`\`\`yaml
---
type: FEATURE | BUG | ENHANCEMENT | TASK
priority: LOW | MEDIUM | HIGH | CRITICAL
---
\`\`\`

## Template Metadata
When a template is selected, its frontmatter values will be used as defaults for creating issues:
- \`type\`: Issue type (FEATURE, BUG, ENHANCEMENT, or TASK)
- \`priority\`: Issue priority (LOW, MEDIUM, HIGH, or CRITICAL)

These values can still be overridden when creating an issue explicitly.
`;

      await this.fileSystem.writeFile(
        path.join(userTemplatesDir, "README.md"),
        userTemplatesReadme
      );

      // Create default config
      const config = {
        version: "1.0.0",
        projectId: this.resolver.getProjectId(),
        gitRoot: this.resolver.getGitRoot(),
        issueTemplates: {
          defaultTemplate: "feature.md",
        },
      };

      await this.fileSystem.writeFile(
        this.resolver.getConfigPath(),
        JSON.stringify(config, null, 2)
      );
    } catch (error) {
      throw new InstallError("Failed to create track directory", error);
    }
  }

  async installSkills(): Promise<void> {
    try {
      const skillsTarget = path.join(this.workingDirectory, ".claude/skills");
      await this.fileSystem.mkdir(skillsTarget, { recursive: true });

      // Copy skill folders directly (flat, no subfolder)
      // Skills are prefixed with dwf- to avoid conflicts with other packages
      const skillsSource = path.join(this.packageRoot, "skills");
      await this.fileSystem.copyDirectory(skillsSource, skillsTarget);
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
          DATABASE_PATH: this.resolver.getDatabasePath(),
          TEMPLATES_PATH: this.resolver.getTemplatesPath(),
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
      const dbPath = this.resolver.getDatabasePath();
      const templatesPath = this.resolver.getTemplatesPath();
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
      const dbPath = this.resolver.getDatabasePath();
      const dbDir = this.resolver.getDataPath();
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

  /**
   * Create default task labels in ~/.track/<project-id>/labels/
   *
   * Labels are markdown files that provide contextual guidance for tasks.
   * When a task has labels, the corresponding label files are loaded
   * and provided to Claude as context when executing the task.
   */
  async createTaskSkills(): Promise<void> {
    try {
      const labelsDir = this.resolver.getLabelsPath();
      await this.fileSystem.mkdir(labelsDir, { recursive: true });

      // Create README
      const readme = `# Task Labels

Labels are markdown files that provide contextual guidance for tasks.
When a task has labels (e.g., \`["db", "api"]\`), the corresponding label
files (\`db.md\`, \`api.md\`) are loaded and provided as context.

## How it works

1. Create a label file: \`.track/labels/my-label.md\`
2. When generating a plan, tasks are automatically labeled based on matching label names
3. When starting a task, labels are loaded and provided as guidance

## Creating custom labels

Create any \`.md\` file in this directory. The filename (without extension)
becomes the label name.

Example: \`.track/labels/testing.md\` creates a "testing" label that can be
assigned to tasks via the \`labels\` field.
`;

      await this.fileSystem.writeFile(
        path.join(labelsDir, "README.md"),
        readme
      );

      // Create default db label
      const dbLabel = `# Database Changes

When working on database-related tasks:

## Before Making Changes
- Review existing schema in \`packages/core/src/infrastructure/database/schema.ts\`
- Check for existing migrations in the \`drizzle/\` directory

## Making Schema Changes
1. Update the schema file with your changes
2. Run \`pnpm drizzle-kit generate\` to create a migration
3. Run the application to apply migrations automatically

## Best Practices
- Ensure backward compatibility for schema changes when possible
- Add indexes for frequently queried columns
- Use foreign keys to maintain referential integrity
- Document complex relationships in code comments
`;

      await this.fileSystem.writeFile(
        path.join(labelsDir, "db.md"),
        dbLabel
      );

      // Create default api label
      const apiLabel = `# API Development

When working on API endpoints:

## REST Conventions
- Use appropriate HTTP methods (GET, POST, PUT, DELETE, PATCH)
- Return appropriate HTTP status codes
- Use consistent URL patterns

## Response Format
- Return JSON responses with consistent structure
- Include meaningful error messages
- Use pagination for list endpoints

## Documentation
- Document endpoints with examples
- Include request/response schemas
- Note any authentication requirements
`;

      await this.fileSystem.writeFile(
        path.join(labelsDir, "api.md"),
        apiLabel
      );

      // Create default security label
      const securityLabel = `# Security Requirements

When working on security-sensitive code:

## Data Protection
- Never log sensitive data (passwords, tokens, PII)
- Encrypt sensitive data at rest
- Use secure connections for data in transit

## Input Validation
- Validate all user input at system boundaries
- Use parameterized queries to prevent SQL injection
- Sanitize output to prevent XSS attacks

## Authentication & Authorization
- Use established auth libraries
- Implement proper session management
- Follow principle of least privilege
`;

      await this.fileSystem.writeFile(
        path.join(labelsDir, "security.md"),
        securityLabel
      );

    } catch (error) {
      throw new InstallError("Failed to create task labels", error);
    }
  }
}
