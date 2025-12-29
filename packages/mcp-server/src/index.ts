#!/usr/bin/env node

import * as path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DatabaseService } from "./infrastructure/database.js";
import { SqliteIssueRepository } from "./infrastructure/issue-repository.js";
import { TemplateService } from "./infrastructure/template-service.js";
import { NodeFileSystem } from "./infrastructure/file-system.js";

// Get paths from environment
const DATABASE_PATH =
  process.env["DATABASE_PATH"] || "./data/workflow.db";
const TEMPLATES_PATH =
  process.env["TEMPLATES_PATH"] || "./.track/config/issues/templates/";

// Database and repository instances (initialized in main)
let dbService: DatabaseService;
let issueRepository: SqliteIssueRepository;
let templateService: TemplateService;

// Create MCP server
const server = new Server(
  {
    name: "dev-workflow-tracker",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_issue",
      description: "Create a new issue in the task tracker",
      inputSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Issue title",
          },
          description: {
            type: "string",
            description: "Detailed description of the issue",
          },
          acceptanceCriteria: {
            type: "array",
            items: { type: "string" },
            description: "List of acceptance criteria",
          },
          type: {
            type: "string",
            enum: ["FEATURE", "BUG", "ENHANCEMENT", "TASK"],
            description: "Issue type",
          },
          priority: {
            type: "string",
            enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
            description: "Issue priority",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Issue labels/tags",
          },
          useTemplate: {
            type: "boolean",
            description: "Auto-select template based on description",
          },
        },
        required: ["title", "description"],
      },
    },
    {
      name: "get_issue",
      description: "Get issue by ID or number",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Issue UUID",
          },
          number: {
            type: "number",
            description: "Issue number (e.g., 123 for #123)",
          },
        },
      },
    },
    {
      name: "list_issues",
      description: "List issues with optional filters",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["OPEN", "IN_PROGRESS", "CLOSED"],
            description: "Filter by status",
          },
          type: {
            type: "string",
            enum: ["FEATURE", "BUG", "ENHANCEMENT", "TASK"],
            description: "Filter by type",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Filter by labels",
          },
        },
      },
    },
    {
      name: "list_templates",
      description: "List available issue templates",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "create_issue") {
      const {
        title,
        description,
        acceptanceCriteria = [],
        type,
        priority = "MEDIUM",
        labels = [],
        useTemplate = true,
      } = args as any;

      // Select template if requested and use metadata
      let templateUsed: string | undefined;
      let finalType = type;
      let finalPriority = priority;
      let finalLabels = labels;

      if (useTemplate) {
        try {
          const template = await templateService.selectTemplate(description);
          templateUsed = template.filename;

          // Use template metadata as defaults (if not explicitly provided)
          if (!finalType) {
            finalType = template.metadata.type;
          }
          if (priority === "MEDIUM") {
            // Only override if using default priority
            finalPriority = template.metadata.priority;
          }
          if (labels.length === 0) {
            // Only override if no labels provided
            finalLabels = [...template.metadata.labels];
          }
        } catch (error) {
          // Log error but continue without template
          console.error("Failed to select template:", error);
        }
      }

      // Create issue using repository
      const issue = issueRepository.create({
        title,
        description,
        acceptanceCriteria,
        type: finalType || "FEATURE",
        priority: finalPriority,
        status: "OPEN",
        labels: finalLabels,
        templateUsed,
        createdBy: "claude-code",
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                issue: {
                  id: issue.id,
                  number: issue.number,
                  title: issue.title,
                  type: issue.type,
                  priority: issue.priority,
                  templateUsed: issue.templateUsed,
                  url: `http://localhost:3000/issues/${issue.number}`,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === "get_issue") {
      const { id, number } = args as any;

      const issue = id
        ? issueRepository.findById(id)
        : issueRepository.findByNumber(number);

      if (!issue) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "Issue not found",
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(issue, null, 2),
          },
        ],
      };
    }

    if (name === "list_issues") {
      const { status, type, labels: filterLabels } = args as any;

      const filtered = issueRepository.findMany({
        status,
        type,
        labels: filterLabels,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(filtered, null, 2),
          },
        ],
      };
    }

    if (name === "list_templates") {
      try {
        const templates = await templateService.getAvailableTemplates();
        const discovery = await templateService.discoverTemplates();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  available: templates,
                  details: discovery.merged.map((t) => ({
                    filename: t.filename,
                    type: t.metadata.type,
                    priority: t.metadata.priority,
                    labels: t.metadata.labels,
                    source: t.isUserDefined ? "user" : "default",
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Unknown tool: ${name}`,
          }),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
    };
  }
});

// Start server with stdio transport
async function main() {
  // Initialize database with automatic native/WASM detection
  dbService = await DatabaseService.create(DATABASE_PATH);
  dbService.runMigrations();

  // Initialize repository
  issueRepository = new SqliteIssueRepository(dbService.getDb());

  // Initialize template service
  const fileSystem = new NodeFileSystem();
  const workingDir = path.dirname(path.dirname(DATABASE_PATH)); // .track/data -> .track
  const userTemplatesPath = path.join(workingDir, "issues/templates");
  const defaultTemplatesPath = path.resolve(TEMPLATES_PATH);

  templateService = new TemplateService(
    fileSystem,
    userTemplatesPath,
    defaultTemplatesPath
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dev-workflow MCP server running on stdio");
  console.error(`Database: ${DATABASE_PATH}`);
  console.error(`Templates: ${defaultTemplatesPath} (defaults), ${userTemplatesPath} (user)`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

// Cleanup on exit
process.on("SIGINT", () => {
  dbService.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  dbService.close();
  process.exit(0);
});
