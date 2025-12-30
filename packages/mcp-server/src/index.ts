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
import { SqliteSnapshotRepository } from "./infrastructure/snapshot-repository.js";
import { SqlitePlanRepository } from "./infrastructure/plan-repository.js";
import { SqliteTaskRepository } from "./infrastructure/task-repository.js";
import { TemplateService } from "./infrastructure/template-service.js";
import { NodeFileSystem } from "./infrastructure/file-system.js";
import { VersioningService } from "./application/versioning-service.js";
import { PlanningService } from "./application/planning-service.js";
import { FileSystemHookConfigService } from "./application/hook-config-service.js";
import { ShellHookExecutor } from "./application/hook-executor.js";
import { TaskSessionService } from "./application/task-session-service.js";

// Get paths from environment
const DATABASE_PATH =
  process.env["DATABASE_PATH"] || "./data/workflow.db";
const TEMPLATES_PATH =
  process.env["TEMPLATES_PATH"] || "./.track/config/issues/templates/";

// Database and repository instances (initialized in main)
let dbService: DatabaseService;
let issueRepository: SqliteIssueRepository;
let snapshotRepository: SqliteSnapshotRepository;
let planRepository: SqlitePlanRepository;
let taskRepository: SqliteTaskRepository;
let templateService: TemplateService;
let versioningService: VersioningService;
let planningService: PlanningService;
let hookConfigService: FileSystemHookConfigService;
let hookExecutor: ShellHookExecutor;
let taskSessionService: TaskSessionService;

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
    {
      name: "generate_plan",
      description: "Generate or regenerate an implementation plan for an issue with tasks. Automatically preserves in-progress and completed tasks from previous plan when possible.",
      inputSchema: {
        type: "object",
        properties: {
          issueId: {
            type: "string",
            description: "Issue UUID",
          },
          issueNumber: {
            type: "number",
            description: "Issue number (e.g., 123 for #123) - alternative to issueId",
          },
          summary: {
            type: "string",
            description: "Brief summary of the plan",
          },
          approach: {
            type: "string",
            description: "Detailed implementation approach (markdown)",
          },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                acceptanceCriteria: {
                  type: "array",
                  items: { type: "string" },
                },
                estimatedMinutes: { type: "number" },
              },
              required: ["title", "description"],
            },
            description: "Array of task definitions",
          },
          estimatedComplexity: {
            type: "string",
            enum: ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"],
            description: "Estimated complexity of the plan",
          },
          preserveExistingTasks: {
            type: "boolean",
            description: "Try to preserve in-progress/completed tasks (default: true)",
          },
        },
        required: ["summary", "approach", "tasks", "estimatedComplexity"],
      },
    },
    {
      name: "get_plan",
      description: "Get the active plan for an issue with tasks",
      inputSchema: {
        type: "object",
        properties: {
          issueId: {
            type: "string",
            description: "Issue UUID",
          },
          issueNumber: {
            type: "number",
            description: "Issue number (e.g., 123 for #123) - alternative to issueId",
          },
        },
      },
    },
    {
      name: "update_issue",
      description: "Update an issue. Optionally regenerate plan after update (you'll need to call generate_plan separately if needed).",
      inputSchema: {
        type: "object",
        properties: {
          issueId: {
            type: "string",
            description: "Issue UUID",
          },
          issueNumber: {
            type: "number",
            description: "Issue number (e.g., 123 for #123) - alternative to issueId",
          },
          updates: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              acceptanceCriteria: {
                type: "array",
                items: { type: "string" },
              },
              type: {
                type: "string",
                enum: ["FEATURE", "BUG", "ENHANCEMENT", "TASK"],
              },
              priority: {
                type: "string",
                enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
              },
              status: {
                type: "string",
                enum: ["OPEN", "IN_PROGRESS", "CLOSED"],
              },
              labels: {
                type: "array",
                items: { type: "string" },
              },
            },
            description: "Fields to update on the issue",
          },
          regeneratePlan: {
            type: "boolean",
            description: "Automatically regenerate plan after update (default: false)",
          },
        },
        required: ["updates"],
      },
    },
    {
      name: "update_task_status",
      description: "Update task status. Records change in history without creating snapshot.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Task UUID",
          },
          status: {
            type: "string",
            enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "ABANDONED"],
            description: "New status for the task",
          },
          notes: {
            type: "string",
            description: "Optional notes about status change",
          },
        },
        required: ["taskId", "status"],
      },
    },
    {
      name: "get_snapshot_history",
      description: "Get version history for an issue showing all snapshots",
      inputSchema: {
        type: "object",
        properties: {
          issueId: {
            type: "string",
            description: "Issue UUID",
          },
          issueNumber: {
            type: "number",
            description: "Issue number (e.g., 123 for #123) - alternative to issueId",
          },
        },
      },
    },
    {
      name: "revert_to_snapshot",
      description: "Revert issue to a previous version snapshot. Creates new snapshot based on old data.",
      inputSchema: {
        type: "object",
        properties: {
          issueNumber: {
            type: "number",
            description: "Issue number (e.g., 123 for #123)",
          },
          version: {
            type: "number",
            description: "Version number to revert to",
          },
          notes: {
            type: "string",
            description: "Reason for reversion",
          },
        },
        required: ["issueNumber", "version"],
      },
    },
    {
      name: "start_task_session",
      description: "Start working on a task in the current Claude session. Automatically updates status to IN_PROGRESS and runs pre/post-start hooks.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Task UUID",
          },
          sessionId: {
            type: "string",
            description: "Claude session ID",
          },
          skipHooks: {
            type: "boolean",
            description: "Skip lifecycle hooks (default: false)",
          },
        },
        required: ["taskId", "sessionId"],
      },
    },
    {
      name: "complete_task_session",
      description: "Complete the current task. Runs pre-complete hooks (must pass) then marks task as COMPLETED.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Task UUID",
          },
          sessionId: {
            type: "string",
            description: "Claude session ID",
          },
          notes: {
            type: "string",
            description: "Completion notes",
          },
          skipHooks: {
            type: "boolean",
            description: "Skip lifecycle hooks (default: false)",
          },
        },
        required: ["taskId", "sessionId"],
      },
    },
    {
      name: "abandon_task_session",
      description: "Abandon the current task. Runs on-abandon hooks and marks task as ABANDONED.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Task UUID",
          },
          sessionId: {
            type: "string",
            description: "Claude session ID",
          },
          reason: {
            type: "string",
            description: "Reason for abandonment",
          },
        },
        required: ["taskId", "sessionId"],
      },
    },
    {
      name: "get_task_for_session",
      description: "Get full task details for execution in session. Includes title, description, acceptance criteria, hook config labels.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Task UUID",
          },
          includeContext: {
            type: "boolean",
            description: "Include related issue and plan context (default: true)",
          },
        },
        required: ["taskId"],
      },
    },
    {
      name: "list_available_tasks",
      description: "List tasks available to work on (PENDING status, not locked by another session).",
      inputSchema: {
        type: "object",
        properties: {
          planId: {
            type: "string",
            description: "Filter by plan UUID",
          },
          issueNumber: {
            type: "number",
            description: "Filter by issue number",
          },
        },
      },
    },
    {
      name: "update_task_hook_configs",
      description: "Update hook configuration labels for a task. Allows UI to dynamically change which hook configs are associated with a task.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Task UUID",
          },
          hookConfigLabels: {
            type: "array",
            items: { type: "string" },
            description: "Array of hook config labels (e.g., [\"db-migration\", \"e2e-tests\"])",
          },
        },
        required: ["taskId", "hookConfigLabels"],
      },
    },
    {
      name: "list_hook_configs",
      description: "List all available hook configurations.",
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

    if (name === "generate_plan") {
      const {
        issueId,
        issueNumber,
        summary,
        approach,
        tasks,
        estimatedComplexity,
        preserveExistingTasks = true,
      } = args as any;

      // Resolve issue ID from number if needed
      let resolvedIssueId = issueId;
      if (!resolvedIssueId && issueNumber) {
        const issue = issueRepository.findByNumber(issueNumber);
        if (!issue) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Issue not found: #${issueNumber}`,
                }),
              },
            ],
          };
        }
        resolvedIssueId = issue.id;
      }

      const result = planningService.generatePlan({
        issueId: resolvedIssueId,
        summary,
        approach,
        tasks,
        estimatedComplexity,
        generatedBy: "claude-agent",
        preserveExistingTasks,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === "get_plan") {
      const { issueId, issueNumber } = args as any;

      // Resolve issue ID from number if needed
      let resolvedIssueId = issueId;
      if (!resolvedIssueId && issueNumber) {
        const issue = issueRepository.findByNumber(issueNumber);
        if (!issue) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Issue not found: #${issueNumber}`,
                }),
              },
            ],
          };
        }
        resolvedIssueId = issue.id;
      }

      const plan = planRepository.findActiveByIssueId(resolvedIssueId);
      if (!plan) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "No active plan found for this issue",
              }),
            },
          ],
        };
      }

      const tasks = taskRepository.findByPlanId(plan.id);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ plan, tasks }, null, 2),
          },
        ],
      };
    }

    if (name === "update_issue") {
      const { issueId, issueNumber, updates, regeneratePlan = false } = args as any;

      // Resolve issue ID from number if needed
      let resolvedIssueId = issueId;
      if (!resolvedIssueId && issueNumber) {
        const issue = issueRepository.findByNumber(issueNumber);
        if (!issue) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Issue not found: #${issueNumber}`,
                }),
              },
            ],
          };
        }
        resolvedIssueId = issue.id;
      }

      const result = planningService.updateIssueWithRegeneration(
        resolvedIssueId,
        updates,
        regeneratePlan
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === "update_task_status") {
      const { taskId, status, notes } = args as any;

      const updatedTask = taskRepository.updateStatus(
        taskId,
        status,
        "claude-agent",
        notes
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(updatedTask, null, 2),
          },
        ],
      };
    }

    if (name === "get_snapshot_history") {
      const { issueId, issueNumber } = args as any;

      // Resolve issue number from ID if needed
      let resolvedIssueNumber = issueNumber;
      if (!resolvedIssueNumber && issueId) {
        const issue = issueRepository.findById(issueId);
        if (!issue) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Issue not found: ${issueId}`,
                }),
              },
            ],
          };
        }
        resolvedIssueNumber = issue.number;
      }

      const history = versioningService.getSnapshotHistory(resolvedIssueNumber);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(history, null, 2),
          },
        ],
      };
    }

    if (name === "revert_to_snapshot") {
      const { issueNumber, version, notes } = args as any;

      const result = versioningService.revertToSnapshot(
        issueNumber,
        version,
        "claude-agent",
        notes
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === "start_task_session") {
      const { taskId, sessionId, skipHooks = false } = args as any;

      const result = await taskSessionService.startTaskSession({
        taskId,
        sessionId,
        skipHooks,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              task: result.task,
              sessionId: result.sessionId,
              startedAt: result.startedAt,
              hookResults: result.hookResults,
            }, null, 2),
          },
        ],
      };
    }

    if (name === "complete_task_session") {
      const { taskId, sessionId, notes, skipHooks = false } = args as any;

      const task = await taskSessionService.completeTaskSession({
        taskId,
        sessionId,
        notes,
        skipHooks,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              task,
            }, null, 2),
          },
        ],
      };
    }

    if (name === "abandon_task_session") {
      const { taskId, sessionId, reason } = args as any;

      const task = await taskSessionService.abandonTaskSession(
        taskId,
        sessionId,
        reason
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              task,
            }, null, 2),
          },
        ],
      };
    }

    if (name === "get_task_for_session") {
      const { taskId, includeContext = true } = args as any;

      const task = taskRepository.findById(taskId);
      if (!task) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `Task not found: ${taskId}`,
              }),
            },
          ],
        };
      }

      const result: any = { task };

      if (includeContext) {
        const plan = planRepository.findById(task.planId);
        if (plan) {
          result.plan = plan;
          const issue = issueRepository.findById(plan.issueId);
          if (issue) {
            result.issue = issue;
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === "list_available_tasks") {
      const { planId, issueNumber } = args as any;

      let tasks: any[] = [];

      if (planId) {
        tasks = taskRepository.findByPlanId(planId);
      } else if (issueNumber) {
        const issue = issueRepository.findByNumber(issueNumber);
        if (issue) {
          const plan = planRepository.findActiveByIssueId(issue.id);
          if (plan) {
            tasks = taskRepository.findByPlanId(plan.id);
          }
        }
      } else {
        tasks = taskRepository.findMany();
      }

      // Filter to only available tasks
      const availableTasks = [];
      for (const task of tasks) {
        const isAvailable = await taskSessionService.isTaskAvailable(task.id);
        if (isAvailable) {
          availableTasks.push(task);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              tasks: availableTasks,
            }, null, 2),
          },
        ],
      };
    }

    if (name === "update_task_hook_configs") {
      const { taskId, hookConfigLabels } = args as any;

      const task = taskRepository.updateHookConfigLabels(taskId, hookConfigLabels);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              task,
            }, null, 2),
          },
        ],
      };
    }

    if (name === "list_hook_configs") {
      const configs = await hookConfigService.listConfigs();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              configs,
            }, null, 2),
          },
        ],
      };
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

  // Initialize repositories
  const db = dbService.getDb();
  issueRepository = new SqliteIssueRepository(db);
  snapshotRepository = new SqliteSnapshotRepository(db);
  planRepository = new SqlitePlanRepository(db);
  taskRepository = new SqliteTaskRepository(db);

  // Initialize file system and paths
  const fileSystem = new NodeFileSystem();
  const workingDir = path.dirname(path.dirname(DATABASE_PATH)); // .track/data -> .track
  const trackDirectory = workingDir; // .track directory
  const userTemplatesPath = path.join(workingDir, "issues/templates");
  const defaultTemplatesPath = path.resolve(TEMPLATES_PATH);

  // Initialize hook configuration service (needed by PlanningService)
  hookConfigService = new FileSystemHookConfigService(trackDirectory);

  // Initialize application services (depend on repository interfaces, not implementations)
  versioningService = new VersioningService(
    issueRepository,
    snapshotRepository,
    planRepository,
    taskRepository
  );

  planningService = new PlanningService(
    issueRepository,
    snapshotRepository,
    planRepository,
    taskRepository,
    hookConfigService
  );

  // Initialize template service
  templateService = new TemplateService(
    fileSystem,
    userTemplatesPath,
    defaultTemplatesPath
  );

  // Initialize hook executor
  hookExecutor = new ShellHookExecutor();

  // Initialize task session service
  taskSessionService = new TaskSessionService(
    taskRepository,
    hookConfigService,
    hookExecutor,
    trackDirectory
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
