/**
 * Milestone Tools Integration Tests
 *
 * Tests MCP tool handlers with real MilestoneService backed by database.
 * Uses createMcpTool with test containers to test the full pipeline.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createContainer, asValue, InjectionMode } from "awilix";
import type { AwilixContainer } from "awilix";
import {
  MilestoneService,
  IssueService,
  TaskService,
  type DbClient,
  type Project,
  CreateMilestoneOperationSchema as CreateMilestoneSchema,
  GetMilestoneOperationSchema as GetMilestoneSchema,
  ListMilestonesOperationSchema as ListMilestonesSchema,
  UpdateMilestoneOperationSchema as UpdateMilestoneSchema,
  DeleteMilestoneOperationSchema as DeleteMilestoneSchema,
  AssignIssueToMilestoneOperationSchema as AssignIssueToMilestoneSchema,
  RemoveIssueFromMilestoneOperationSchema as RemoveIssueFromMilestoneSchema,
} from "@dev-workflow/tracking";
import { Effect } from "@dev-workflow/effect";
import { createTestDatabase, type TestDatabase } from "../../test/setup.js";
import {
  createClientForProject,
  createTestIssue,
  createNoOpProjectManagementService,
} from "../../test/helpers.js";
import {
  handleCreateMilestone,
  handleGetMilestone,
  handleListMilestones,
  handleUpdateMilestone,
  handleDeleteMilestone,
  handleAssignIssueToMilestone,
  handleRemoveIssueFromMilestone,
} from "../../tools/milestone-tools.js";
import { createMcpTool, type McpTool } from "../../di/bootstrap.js";

/** Test project ID */
const TEST_PROJECT_ID = "test-project-milestone";

/**
 * Test cradle interface - subset of McpCradle for milestone tools
 */
interface MilestoneTestCradle {
  project: Project;
  milestoneService: MilestoneService;
  issueService: IssueService;
}

describe("Milestone Tools Integration", () => {
  let testDb: TestDatabase;
  let testContainer: AwilixContainer<MilestoneTestCradle>;
  let client: DbClient;

  // Bound tools for testing
  let createMilestone: McpTool;
  let getMilestone: McpTool;
  let listMilestones: McpTool;
  let updateMilestone: McpTool;
  let deleteMilestone: McpTool;
  let assignIssueToMilestone: McpTool;
  let removeIssueFromMilestone: McpTool;

  beforeEach(async () => {
    testDb = createTestDatabase();

    // Create project first
    const project = await testDb.source.projects.create({
      gitRootHash: TEST_PROJECT_ID,
      name: "Test Project",
    });

    // Create client scoped to project
    client = createClientForProject(testDb, project.id);

    // Create services with DbClient
    const projectManagement = createNoOpProjectManagementService();
    const taskService = new TaskService(client, projectManagement, null);
    const issueService = new IssueService(client, taskService, projectManagement);
    const milestoneService = new MilestoneService(client);

    // Create test container with dependencies + tool class
    testContainer = createContainer<MilestoneTestCradle>({
      injectionMode: InjectionMode.CLASSIC,
    });

    testContainer.register({
      project: asValue(project),
      milestoneService: asValue(milestoneService),
      issueService: asValue(issueService),
    });

    // Bind handlers to test container - tests the full pipeline
    createMilestone = createMcpTool(handleCreateMilestone, testContainer);
    getMilestone = createMcpTool(handleGetMilestone, testContainer);
    listMilestones = createMcpTool(handleListMilestones, testContainer);
    updateMilestone = createMcpTool(handleUpdateMilestone, testContainer);
    deleteMilestone = createMcpTool(handleDeleteMilestone, testContainer);
    assignIssueToMilestone = createMcpTool(handleAssignIssueToMilestone, testContainer);
    removeIssueFromMilestone = createMcpTool(handleRemoveIssueFromMilestone, testContainer);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("handleCreateMilestone", () => {
    it("should create a milestone with valid dates", async () => {
      const result = await createMilestone({
        title: "Q1 Release",
        description: "First quarter release",
        startDate: "2026-01-01",
        endDate: "2026-03-31",
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.message).toContain("Created milestone");
      expect(content.milestone.title).toBe("Q1 Release");
      expect(content.milestone.number).toBe(1);
    });

    it("should reject invalid date format", async () => {
      const result = await createMilestone({
        title: "Test",
        startDate: "01-01-2026",
        endDate: "2026-03-31",
      });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("YYYY-MM-DD");
    });

    it("should reject when endDate is before startDate", async () => {
      const result = await createMilestone({
        title: "Test",
        startDate: "2026-03-31",
        endDate: "2026-01-01",
      });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("startDate must be before");
    });
  });

  describe("handleGetMilestone", () => {
    it("should get milestone by number", async () => {
      // Create a milestone
      const milestone = await Effect.runPromise(
        client.milestones.create({
          title: "MVP",
          description: "First release",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          status: "PLANNED",
        })
      );

      const result = await getMilestone({
        milestoneNumber: milestone.number,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.milestone.title).toBe("MVP");
    });

    it("should return error if milestone not found", async () => {
      const result = await getMilestone({
        milestoneNumber: 999,
      });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("not found");
    });

    it("should require either id or milestoneNumber", async () => {
      const result = await getMilestone({});

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("Either id or milestoneNumber is required");
    });
  });

  describe("handleListMilestones", () => {
    it("should list all milestones", async () => {
      // Create milestones
      await Effect.runPromise(
        client.milestones.create({
          title: "M1",
          description: "First milestone",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          status: "PLANNED",
        })
      );
      await Effect.runPromise(
        client.milestones.create({
          title: "M2",
          description: "Second milestone",
          startDate: "2026-02-01",
          endDate: "2026-02-28",
          status: "PLANNED",
        })
      );

      const result = await listMilestones({});

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.count).toBe(2);
    });
  });

  describe("handleUpdateMilestone", () => {
    it("should update milestone title", async () => {
      const milestone = await Effect.runPromise(
        client.milestones.create({
          title: "Old Title",
          description: "Test milestone",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          status: "PLANNED",
        })
      );

      const result = await updateMilestone({
        milestoneNumber: milestone.number,
        updates: { title: "New Title" },
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.milestone.title).toBe("New Title");
    });

    it("should return error for non-existent milestone", async () => {
      const result = await updateMilestone({
        milestoneNumber: 999,
        updates: { title: "New Title" },
      });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("not found");
    });
  });

  describe("handleDeleteMilestone", () => {
    it("should delete milestone", async () => {
      const milestone = await Effect.runPromise(
        client.milestones.create({
          title: "To Delete",
          description: "Milestone to delete",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          status: "PLANNED",
        })
      );

      const result = await deleteMilestone({
        milestoneNumber: milestone.number,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.message).toContain("Deleted milestone");

      // Verify it's gone
      const found = await Effect.runPromise(client.milestones.findById(milestone.id));
      expect(found).toBeNull();
    });

    it("should unassign issues when deleting milestone", async () => {
      const milestone = await Effect.runPromise(
        client.milestones.create({
          title: "To Delete",
          description: "Milestone to delete with issues",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          status: "PLANNED",
        })
      );

      const issue = await createTestIssue(client.issues);
      await Effect.runPromise(client.issues.update(issue.id, { milestoneId: milestone.id }));

      const result = await deleteMilestone({
        milestoneNumber: milestone.number,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.unassignedIssues).toBe(1);

      // Verify issue is unassigned (domain model uses undefined for unset fields)
      const updatedIssue = await Effect.runPromise(client.issues.findById(issue.id));
      expect(updatedIssue?.milestoneId).toBeUndefined();
    });
  });

  describe("handleAssignIssueToMilestone", () => {
    it("should assign an issue to a milestone", async () => {
      const issue = await createTestIssue(client.issues, {
        title: "Test Issue",
      });

      const milestone = await Effect.runPromise(
        client.milestones.create({
          title: "MVP",
          description: "First release",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          status: "PLANNED",
        })
      );

      const result = await assignIssueToMilestone({
        issueNumber: issue.number,
        milestoneNumber: milestone.number,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.message).toContain("Assigned issue");

      // Verify the issue now has the milestoneId
      const updatedIssue = await Effect.runPromise(client.issues.findByNumber(issue.number));
      expect(updatedIssue?.milestoneId).toBe(milestone.id);
    });

    it("should return error if issue not found", async () => {
      const milestone = await Effect.runPromise(
        client.milestones.create({
          title: "MVP",
          description: "First release",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          status: "PLANNED",
        })
      );

      const result = await assignIssueToMilestone({
        issueNumber: 999,
        milestoneNumber: milestone.number,
      });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("Issue #999 not found");
    });

    it("should return error if milestone not found", async () => {
      const issue = await createTestIssue(client.issues);

      const result = await assignIssueToMilestone({
        issueNumber: issue.number,
        milestoneNumber: 999,
      });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("Milestone M999 not found");
    });
  });

  describe("handleRemoveIssueFromMilestone", () => {
    it("should remove an issue from its milestone", async () => {
      const milestone = await Effect.runPromise(
        client.milestones.create({
          title: "MVP",
          description: "First release",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          status: "PLANNED",
        })
      );

      const issue = await createTestIssue(client.issues, {
        title: "Test Issue",
      });
      await Effect.runPromise(client.issues.update(issue.id, { milestoneId: milestone.id }));

      // Verify it's assigned
      const assignedIssue = await Effect.runPromise(client.issues.findByNumber(issue.number));
      expect(assignedIssue?.milestoneId).toBe(milestone.id);

      const result = await removeIssueFromMilestone({
        issueNumber: issue.number,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.message).toContain("Removed issue");

      // Verify the issue no longer has a milestoneId (domain model uses undefined for unset fields)
      const updatedIssue = await Effect.runPromise(client.issues.findByNumber(issue.number));
      expect(updatedIssue?.milestoneId).toBeUndefined();
    });

    it("should return error if issue not found", async () => {
      const result = await removeIssueFromMilestone({
        issueNumber: 999,
      });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("Issue #999 not found");
    });

    it("should return error if issue is not assigned to any milestone", async () => {
      const issue = await createTestIssue(client.issues, {
        title: "Test Issue",
      });

      const result = await removeIssueFromMilestone({
        issueNumber: issue.number,
      });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("not assigned to any milestone");
    });
  });
});

/**
 * Schema Validation Tests for Milestone Tools
 */
describe("Milestone Tool Schema Validation", () => {
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

    it("should accept without optional description", () => {
      const input = {
        title: "Q1 Release",
        startDate: "2024-01-01",
        endDate: "2024-03-31",
      };
      const result = CreateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject missing title", () => {
      const input = {
        startDate: "2024-01-01",
        endDate: "2024-03-31",
      };
      const result = CreateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing dates", () => {
      const input = { title: "Q1 Release" };
      const result = CreateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("GetMilestoneSchema", () => {
    it("should accept milestoneNumber", () => {
      const result = GetMilestoneSchema.safeParse({ milestoneNumber: 1 });
      expect(result.success).toBe(true);
    });

    it("should accept id", () => {
      const result = GetMilestoneSchema.safeParse({ id: "uuid-here" });
      expect(result.success).toBe(true);
    });

    it("should accept empty object", () => {
      const result = GetMilestoneSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("ListMilestonesSchema", () => {
    it("should accept status filter", () => {
      const result = ListMilestonesSchema.safeParse({ status: "IN_PROGRESS" });
      expect(result.success).toBe(true);
    });

    it("should accept empty object", () => {
      const result = ListMilestonesSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should reject invalid status", () => {
      const result = ListMilestonesSchema.safeParse({ status: "INVALID" });
      expect(result.success).toBe(false);
    });
  });

  describe("UpdateMilestoneSchema", () => {
    it("should accept valid updates", () => {
      const input = {
        milestoneNumber: 1,
        updates: { title: "Updated Title" },
      };
      const result = UpdateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept all valid update fields", () => {
      const input = {
        milestoneNumber: 1,
        updates: {
          title: "Updated Title",
          description: "Updated description",
          startDate: "2024-02-01",
          endDate: "2024-04-30",
          status: "COMPLETED",
        },
      };
      const result = UpdateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject missing milestoneNumber", () => {
      const input = { updates: { title: "Updated" } };
      const result = UpdateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing updates", () => {
      const input = { milestoneNumber: 1 };
      const result = UpdateMilestoneSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("DeleteMilestoneSchema", () => {
    it("should accept milestoneNumber", () => {
      const result = DeleteMilestoneSchema.safeParse({ milestoneNumber: 1 });
      expect(result.success).toBe(true);
    });

    it("should reject missing milestoneNumber", () => {
      const result = DeleteMilestoneSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("AssignIssueToMilestoneSchema", () => {
    it("should accept valid input", () => {
      const input = { issueNumber: 1, milestoneNumber: 2 };
      const result = AssignIssueToMilestoneSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject missing issueNumber", () => {
      const input = { milestoneNumber: 2 };
      const result = AssignIssueToMilestoneSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing milestoneNumber", () => {
      const input = { issueNumber: 1 };
      const result = AssignIssueToMilestoneSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("RemoveIssueFromMilestoneSchema", () => {
    it("should accept issueNumber", () => {
      const result = RemoveIssueFromMilestoneSchema.safeParse({ issueNumber: 1 });
      expect(result.success).toBe(true);
    });

    it("should reject missing issueNumber", () => {
      const result = RemoveIssueFromMilestoneSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
