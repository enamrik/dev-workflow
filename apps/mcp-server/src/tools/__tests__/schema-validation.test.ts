/**
 * Schema Validation Tests
 *
 * Tests Zod schemas for MCP tool input validation:
 * 1. Valid inputs are accepted and properly typed
 * 2. Invalid inputs are rejected with clear error messages
 * 3. Unknown properties in .strict() schemas are rejected
 * 4. Type inference works correctly
 */

import { describe, it, expect } from "vitest";
import {
  CreateIssueSchema,
  UpdateIssueSchema,
  GetIssueSchema,
  IssueTypeEnum,
  IssuePriorityEnum,
} from "../../tools/issue-tools.js";
import { GeneratePlanSchema } from "../../tools/plan-tools.js";
import { LoadTaskSessionSchema, UpdateTaskSchema } from "../../tools/task-tools.js";
import { CreateMilestoneSchema } from "../../tools/milestone-tools.js";
import { UpdateSettingsSchema } from "../../tools/settings-tools.js";
import { DispatchTaskSchema } from "../../tools/dispatch-tools.js";
import { safeValidateArgs, validateArgs, zodToInputSchema } from "../../tools/schema-utils.js";

// Local schema registry for testing — replaces the deleted toolSchemas from schemas.ts
import {
  DeleteIssueSchema,
  RestoreIssueSchema,
  ListTemplatesSchema,
  GetTemplateSchema,
  CreateTemplateSchema,
  UpdateTemplateSchema,
  DeleteTemplateSchema,
  CopyTemplateSchema,
  CloseIssueSchema,
  ChangeIssueTypeSchema,
  GetProjectStatsSchema,
  SearchIssuesSchema,
  GetWorkQueueSchema,
  ImportGitHubIssueSchema,
} from "../../tools/issue-tools.js";
import {
  GetPlanSchema,
  PauseIssueSchema,
  MoveIssueToReadySchema,
  MoveIssueToBacklogSchema,
  SyncIssueSchema,
} from "../../tools/plan-tools.js";
import {
  AbandonTaskSchema,
  GetTaskSchema,
  ListAvailableTasksSchema,
  DeleteTaskSchema,
  GetTaskExecutionPromptSchema,
  LogTaskProgressSchema,
  GetTaskExecutionLogSchema,
  CheckTaskConflictsSchema,
} from "../../tools/task-tools.js";
import {
  GetSnapshotHistorySchema,
  RevertToSnapshotSchema,
  ViewSnapshotSchema,
} from "../../tools/snapshot-tools.js";
import {
  GetMilestoneSchema,
  ListMilestonesSchema,
  UpdateMilestoneSchema,
  DeleteMilestoneSchema,
  AssignIssueToMilestoneSchema,
  RemoveIssueFromMilestoneSchema,
} from "../../tools/milestone-tools.js";
import { ListWorktreesSchema, PruneStaleWorktreesSchema } from "../../tools/worktree-tools.js";
import {
  GetTaskPRStatusSchema,
  CreatePRSchema,
  SubmitForReviewSchema,
  CompleteTaskSchema,
} from "../../tools/pr-tools.js";
import { MergeIssuesSchema } from "../../tools/merge-tools.js";
import {
  ListTypesSchema,
  CreateTypeSchema,
  UpdateTypeSchema,
  DeleteTypeSchema,
} from "../../tools/type-tools.js";
import { GetDispatchStatusSchema, EndWorkerSessionSchema } from "../../tools/dispatch-tools.js";

const toolSchemas = {
  // Issue tools
  create_issue: CreateIssueSchema,
  get_issue: GetIssueSchema,
  delete_issue: DeleteIssueSchema,
  restore_issue: RestoreIssueSchema,
  list_templates: ListTemplatesSchema,
  get_template: GetTemplateSchema,
  create_template: CreateTemplateSchema,
  update_template: UpdateTemplateSchema,
  delete_template: DeleteTemplateSchema,
  copy_template: CopyTemplateSchema,
  update_issue: UpdateIssueSchema,
  close_issue: CloseIssueSchema,
  change_issue_type: ChangeIssueTypeSchema,
  get_project_stats: GetProjectStatsSchema,
  search_issues: SearchIssuesSchema,
  get_work_queue: GetWorkQueueSchema,
  import_github_issue: ImportGitHubIssueSchema,
  // Plan tools
  generate_plan: GeneratePlanSchema,
  get_plan: GetPlanSchema,
  pause_issue: PauseIssueSchema,
  move_issue_to_ready: MoveIssueToReadySchema,
  move_issue_to_backlog: MoveIssueToBacklogSchema,
  sync_issue: SyncIssueSchema,
  // Task tools
  load_task_session: LoadTaskSessionSchema,
  abandon_task: AbandonTaskSchema,
  get_task: GetTaskSchema,
  list_available_tasks: ListAvailableTasksSchema,
  delete_task: DeleteTaskSchema,
  update_task: UpdateTaskSchema,
  get_task_execution_prompt: GetTaskExecutionPromptSchema,
  log_task_progress: LogTaskProgressSchema,
  get_task_execution_log: GetTaskExecutionLogSchema,
  check_task_conflicts: CheckTaskConflictsSchema,
  // Snapshot tools
  get_snapshot_history: GetSnapshotHistorySchema,
  revert_to_snapshot: RevertToSnapshotSchema,
  view_snapshot: ViewSnapshotSchema,
  // Settings tools
  update_settings: UpdateSettingsSchema,
  // Milestone tools
  create_milestone: CreateMilestoneSchema,
  get_milestone: GetMilestoneSchema,
  list_milestones: ListMilestonesSchema,
  update_milestone: UpdateMilestoneSchema,
  delete_milestone: DeleteMilestoneSchema,
  assign_issue_to_milestone: AssignIssueToMilestoneSchema,
  remove_issue_from_milestone: RemoveIssueFromMilestoneSchema,
  // Worktree tools
  list_worktrees: ListWorktreesSchema,
  prune_stale_worktrees: PruneStaleWorktreesSchema,
  // PR tools
  get_task_pr_status: GetTaskPRStatusSchema,
  create_pr: CreatePRSchema,
  submit_for_review: SubmitForReviewSchema,
  complete_task: CompleteTaskSchema,
  // Merge tools
  merge_issues: MergeIssuesSchema,
  // Type tools
  list_types: ListTypesSchema,
  create_type: CreateTypeSchema,
  update_type: UpdateTypeSchema,
  delete_type: DeleteTypeSchema,
  // Dispatch tools
  dispatch_task: DispatchTaskSchema,
  get_dispatch_status: GetDispatchStatusSchema,
  end_worker_session: EndWorkerSessionSchema,
} as const;

describe("Schema Validation", () => {
  describe("CreateIssueSchema", () => {
    it("should accept valid minimal input", () => {
      const input = {
        title: "Test Issue",
        description: "Test description",
      };

      const result = CreateIssueSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe("Test Issue");
        expect(result.data.description).toBe("Test description");
        expect(result.data.type).toBeUndefined();
        expect(result.data.priority).toBe("MEDIUM");
      }
    });

    it("should accept valid full input", () => {
      const input = {
        title: "Full Issue",
        description: "Full description",
        type: "BUG",
        priority: "HIGH",
        acceptanceCriteria: ["AC 1", "AC 2"],
        labels: { bug: "", product: "Case Workflow" },
        useTemplate: true,
      };

      const result = CreateIssueSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("BUG");
        expect(result.data.priority).toBe("HIGH");
        expect(result.data.acceptanceCriteria).toEqual(["AC 1", "AC 2"]);
        expect(result.data.labels).toEqual({ bug: "", product: "Case Workflow" });
      }
    });

    it("should reject missing required fields", () => {
      const input = {
        title: "Missing Description",
      };

      const result = CreateIssueSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("description");
        expect(result.error.issues[0].message).toContain("Required");
      }
    });

    it("should reject invalid type enum value", () => {
      const input = {
        title: "Invalid Type",
        description: "Description",
        type: "INVALID_TYPE",
      };

      const result = CreateIssueSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("type");
      }
    });

    it("should reject invalid priority enum value", () => {
      const input = {
        title: "Invalid Priority",
        description: "Description",
        priority: "SUPER_HIGH",
      };

      const result = CreateIssueSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("priority");
      }
    });

    it("should reject non-string acceptance criteria", () => {
      const input = {
        title: "Bad AC",
        description: "Description",
        acceptanceCriteria: [1, 2, 3],
      };

      const result = CreateIssueSchema.safeParse(input);

      expect(result.success).toBe(false);
    });
  });

  describe("UpdateIssueSchema with .strict()", () => {
    it("should accept valid updates", () => {
      const input = {
        issueNumber: 1,
        updates: {
          title: "Updated Title",
          description: "Updated description",
        },
      };

      const result = UpdateIssueSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.updates.title).toBe("Updated Title");
      }
    });

    it("should reject unknown properties in updates object", () => {
      const input = {
        issueNumber: 1,
        updates: {
          title: "Updated Title",
          unknownField: "should fail",
        },
      };

      const result = UpdateIssueSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        // Zod's strict() mode rejects unrecognized keys
        const errorMessage = result.error.issues.map((i) => i.message).join(" ");
        expect(errorMessage).toContain("Unrecognized key");
      }
    });

    it("should reject multiple unknown properties", () => {
      const input = {
        issueNumber: 1,
        updates: {
          title: "Valid",
          badField1: "invalid",
          badField2: 123,
          badField3: true,
        },
      };

      const result = UpdateIssueSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        // Should catch the unrecognized keys
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });

    it("should accept all valid update fields", () => {
      const input = {
        issueNumber: 1,
        updates: {
          title: "New Title",
          description: "New description",
          acceptanceCriteria: ["New AC"],
          type: "ENHANCEMENT",
          priority: "LOW",
          labels: { new: "label" },
        },
      };

      const result = UpdateIssueSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.updates.type).toBe("ENHANCEMENT");
        expect(result.data.updates.priority).toBe("LOW");
      }
    });
  });

  describe("UpdateTaskSchema", () => {
    it("should accept valid task updates", () => {
      const input = {
        taskId: "task-uuid",
        title: "Updated Task",
        description: "Updated description",
        estimatedMinutes: 60,
      };

      const result = UpdateTaskSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("should accept all valid update fields", () => {
      const input = {
        taskId: "task-uuid",
        title: "Updated Task",
        description: "Updated description",
        acceptanceCriteria: ["AC 1", "AC 2"],
        estimatedMinutes: 120,
        implementationPlan: "Use existing pattern from src/auth",
        labels: { urgent: "", product: "Case Workflow" },
      };

      const result = UpdateTaskSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe("Updated Task");
        expect(result.data.estimatedMinutes).toBe(120);
        expect(result.data.labels).toEqual({ urgent: "", product: "Case Workflow" });
      }
    });

    it("should reject missing required taskId", () => {
      const input = {
        title: "Updated Task",
      };

      const result = UpdateTaskSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("taskId");
      }
    });
  });

  describe("GetIssueSchema", () => {
    it("should accept issueNumber", () => {
      const result = GetIssueSchema.safeParse({ issueNumber: 42 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.issueNumber).toBe(42);
        expect(result.data.includePlan).toBe(false);
      }
    });

    it("should require issueNumber", () => {
      const result = GetIssueSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it("should accept includePlan flag", () => {
      const result = GetIssueSchema.safeParse({ issueNumber: 1, includePlan: true });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includePlan).toBe(true);
      }
    });

    it("should default includePlan to false", () => {
      const result = GetIssueSchema.safeParse({ issueNumber: 1 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includePlan).toBe(false);
      }
    });
  });

  describe("GeneratePlanSchema", () => {
    it("should accept valid plan with tasks", () => {
      const input = {
        issueNumber: 1,
        summary: "Implementation plan",
        approach: "Step by step",
        estimatedComplexity: "MEDIUM",
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            description: "First task",
            type: "TASK",
          },
          {
            id: "task-2",
            title: "Task 2",
            description: "Second task",
            type: "FEATURE",
            dependsOn: ["task-1"],
            estimatedMinutes: 30,
          },
        ],
      };

      const result = GeneratePlanSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tasks).toHaveLength(2);
        expect(result.data.tasks[1].dependsOn).toEqual(["task-1"]);
      }
    });

    it("should reject missing required fields", () => {
      const input = {
        issueNumber: 1,
        summary: "Plan",
        // missing approach, estimatedComplexity, tasks
      };

      const result = GeneratePlanSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("should reject invalid complexity enum", () => {
      const input = {
        issueNumber: 1,
        summary: "Plan",
        approach: "Approach",
        estimatedComplexity: "SUPER_HIGH", // Invalid
        tasks: [],
      };

      const result = GeneratePlanSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("should reject tasks without required type field", () => {
      const input = {
        issueNumber: 1,
        summary: "Plan",
        approach: "Approach",
        estimatedComplexity: "MEDIUM",
        tasks: [
          {
            id: "task-1",
            title: "Task without type",
            description: "Missing type",
            // type is required per the schema
          },
        ],
      };

      const result = GeneratePlanSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        const typeError = result.error.issues.find((i) => i.path.includes("type"));
        expect(typeError).toBeDefined();
      }
    });
  });

  describe("LoadTaskSessionSchema", () => {
    it("should accept valid task session", () => {
      const input = {
        taskId: "task-uuid",
        sessionId: "session-uuid",
      };

      const result = LoadTaskSessionSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("should accept with optional mode", () => {
      const input = {
        taskId: "task-uuid",
        sessionId: "session-uuid",
        mode: "isolated",
      };

      const result = LoadTaskSessionSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe("isolated");
      }
    });

    it("should reject invalid mode", () => {
      const input = {
        taskId: "task-uuid",
        sessionId: "session-uuid",
        mode: "invalid-mode",
      };

      const result = LoadTaskSessionSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("should accept workerId for worker execution", () => {
      const input = {
        taskId: "task-uuid",
        sessionId: "session-uuid",
        workerId: "worker-uuid",
      };

      const result = LoadTaskSessionSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.workerId).toBe("worker-uuid");
      }
    });
  });

  describe("CreateMilestoneSchema", () => {
    it("should accept valid milestone", () => {
      const input = {
        title: "Q1 Release",
        startDate: "2024-01-01",
        endDate: "2024-03-31",
        description: "First quarter release",
      };

      const result = CreateMilestoneSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("should reject missing required dates", () => {
      const input = {
        title: "Missing Dates",
      };

      const result = CreateMilestoneSchema.safeParse(input);

      expect(result.success).toBe(false);
    });
  });

  describe("UpdateSettingsSchema", () => {
    it("should accept valid settings action", () => {
      const input = {
        action: "get_settings",
      };

      const result = UpdateSettingsSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("should accept github configuration", () => {
      const input = {
        action: "configure_github",
        github: {
          projectId: "PVT_test123",
          assignee: "username",
          labels: {
            customLabels: ["custom-label"],
            typeLabels: { FEATURE: "feature", BUG: "bug" },
          },
        },
      };

      const result = UpdateSettingsSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("should reject invalid action", () => {
      const input = {
        action: "invalid_action",
      };

      const result = UpdateSettingsSchema.safeParse(input);

      expect(result.success).toBe(false);
    });
  });

  describe("Enum Schemas", () => {
    it("should validate IssueTypeEnum", () => {
      expect(IssueTypeEnum.safeParse("FEATURE").success).toBe(true);
      expect(IssueTypeEnum.safeParse("BUG").success).toBe(true);
      expect(IssueTypeEnum.safeParse("ENHANCEMENT").success).toBe(true);
      expect(IssueTypeEnum.safeParse("TASK").success).toBe(true);
      expect(IssueTypeEnum.safeParse("INVALID").success).toBe(false);
    });

    it("should validate IssuePriorityEnum", () => {
      expect(IssuePriorityEnum.safeParse("LOW").success).toBe(true);
      expect(IssuePriorityEnum.safeParse("MEDIUM").success).toBe(true);
      expect(IssuePriorityEnum.safeParse("HIGH").success).toBe(true);
      expect(IssuePriorityEnum.safeParse("CRITICAL").success).toBe(true);
      expect(IssuePriorityEnum.safeParse("INVALID").success).toBe(false);
    });
  });
});

describe("safeValidateArgs", () => {
  it("should return success with typed data for valid input", () => {
    const input = {
      title: "Test",
      description: "Description",
    };

    const result = safeValidateArgs(CreateIssueSchema, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Test");
    }
  });

  it("should return error message for invalid input", () => {
    const input = {
      title: "Missing description",
    };

    const result = safeValidateArgs(CreateIssueSchema, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("description");
    }
  });

  it("should format nested path errors correctly", () => {
    const input = {
      issueNumber: 1,
      updates: {
        type: "INVALID_TYPE",
      },
    };

    const result = safeValidateArgs(UpdateIssueSchema, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      // Error should include the path to the invalid field
      expect(result.error).toContain("updates");
      expect(result.error).toContain("type");
    }
  });
});

describe("validateArgs (throwing)", () => {
  it("should return typed data for valid input", () => {
    const input = {
      title: "Test",
      description: "Description",
    };

    const result = validateArgs(CreateIssueSchema, input);

    expect(result.title).toBe("Test");
    expect(result.description).toBe("Description");
  });

  it("should throw ZodError for invalid input", () => {
    const input = {
      title: "Missing description",
    };

    expect(() => validateArgs(CreateIssueSchema, input)).toThrow();
  });
});

describe("zodToInputSchema", () => {
  it("should convert Zod schema to JSON Schema format", () => {
    const jsonSchema = zodToInputSchema(CreateIssueSchema);

    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties).toBeDefined();
    expect(jsonSchema.properties?.title).toBeDefined();
    expect(jsonSchema.properties?.description).toBeDefined();
    expect(jsonSchema.required).toContain("title");
    expect(jsonSchema.required).toContain("description");
  });

  it("should not include $schema property", () => {
    const jsonSchema = zodToInputSchema(CreateIssueSchema);

    // $schema is removed by zodToInputSchema
    expect((jsonSchema as Record<string, unknown>).$schema).toBeUndefined();
  });

  it("should include optional properties without requiring them", () => {
    const jsonSchema = zodToInputSchema(CreateIssueSchema);

    expect(jsonSchema.properties?.type).toBeDefined();
    expect(jsonSchema.properties?.priority).toBeDefined();
    expect(jsonSchema.required).not.toContain("type");
    expect(jsonSchema.required).not.toContain("priority");
  });
});

describe("toolSchemas registry", () => {
  it("should have schema for all documented tools", () => {
    const expectedTools = [
      "create_issue",
      "get_issue",
      "update_issue",
      "delete_issue",
      "close_issue",
      "generate_plan",
      "get_plan",
      "load_task_session",
      "abandon_task",
      "create_milestone",
      "update_settings",
      "dispatch_task",
    ];

    for (const tool of expectedTools) {
      expect(toolSchemas[tool as keyof typeof toolSchemas]).toBeDefined();
    }
  });

  it("should have consistent schema names", () => {
    // All tool schemas should be Zod objects
    for (const schema of Object.values(toolSchemas)) {
      expect(schema).toBeDefined();
      // Verify it's a Zod schema by checking it has safeParse
      expect(typeof schema.safeParse).toBe("function");
    }
  });
});

describe("Type inference", () => {
  it("should infer correct types from schema", () => {
    // This is a compile-time test - if it compiles, the types are correct
    const input: unknown = {
      title: "Test",
      description: "Description",
      type: "BUG",
    };

    const result = CreateIssueSchema.parse(input);

    // TypeScript knows these are the correct types
    const title: string = result.title;
    const description: string = result.description;
    const type: "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK" | undefined = result.type;

    expect(title).toBe("Test");
    expect(description).toBe("Description");
    expect(type).toBe("BUG");
  });
});
