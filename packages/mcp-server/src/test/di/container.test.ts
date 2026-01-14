/**
 * Tests for Awilix DI Container
 *
 * Demonstrates the container scoping pattern for testing tool handlers
 * without static mocks. Tests verify:
 * 1. Container provides all expected services
 * 2. Test scopes can override specific dependencies
 * 3. Bootstrap functions work with scoped containers
 */

import { describe, it, expect, vi } from "vitest";
import { asValue, createContainer, InjectionMode } from "awilix";
import type { AwilixContainer } from "awilix";
import { createTool, createToolHandler, createNoArgsToolHandler } from "../../di/bootstrap.js";
import { successResponse, errorResponse } from "../../tools/types.js";
import { z } from "zod";

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Minimal mock issue service type for testing.
 */
interface MockIssueService {
  create: (params: { title: string; description: string }) => { id: string; title: string };
  list: () => Array<{ id: string; title: string }>;
}

/**
 * Minimal mock task service type for testing.
 */
interface MockTaskService {
  get: (id: string) => { id: string; title: string } | null;
}

/**
 * Minimal cradle type for testing bootstrap functions.
 * Uses dedicated mock types to avoid conflicts with real service types.
 */
interface TestCradle {
  issueService: MockIssueService;
  taskService: MockTaskService;
}

/**
 * Create a test container with mock services.
 */
function createTestContainer(): AwilixContainer<TestCradle> {
  const container = createContainer<TestCradle>({
    injectionMode: InjectionMode.CLASSIC,
  });

  container.register({
    issueService: asValue({
      create: vi.fn((params: { title: string; description: string }) => ({
        id: "test-issue-1",
        title: params.title,
      })),
      list: vi.fn(() => [
        { id: "issue-1", title: "First Issue" },
        { id: "issue-2", title: "Second Issue" },
      ]),
    }),
    taskService: asValue({
      get: vi.fn((id: string) => (id === "task-1" ? { id: "task-1", title: "Test Task" } : null)),
    }),
  });

  return container;
}

// =============================================================================
// Container Scoping Tests
// =============================================================================

describe("DI Container Scoping", () => {
  it("should create a container with registered services", () => {
    const container = createTestContainer();

    expect(container.cradle.issueService).toBeDefined();
    expect(container.cradle.taskService).toBeDefined();
  });

  it("should allow creating scoped containers that inherit registrations", () => {
    const parent = createTestContainer();
    const scope = parent.createScope();

    // Scope should have access to parent's services
    expect(scope.cradle.issueService).toBe(parent.cradle.issueService);
    expect(scope.cradle.taskService).toBe(parent.cradle.taskService);
  });

  it("should allow overriding services in scoped container", () => {
    const parent = createTestContainer();
    const scope = parent.createScope();

    // Override issueService in scope
    const mockIssueService = {
      create: vi.fn(() => ({ id: "scoped-issue", title: "Scoped Title" })),
      list: vi.fn(() => []),
    };
    scope.register({
      issueService: asValue(mockIssueService),
    });

    // Scope should have the overridden service
    expect(scope.cradle.issueService).toBe(mockIssueService);
    // Parent should still have original
    expect(parent.cradle.issueService).not.toBe(mockIssueService);
  });

  it("should not affect parent when scope service is overridden", () => {
    const parent = createTestContainer();
    const originalIssueService = parent.cradle.issueService;

    const scope = parent.createScope();
    scope.register({
      issueService: asValue({
        create: vi.fn(),
        list: vi.fn(),
      }),
    });

    // Parent unchanged
    expect(parent.cradle.issueService).toBe(originalIssueService);
  });
});

// =============================================================================
// createTool Tests
// =============================================================================

describe("createTool", () => {
  const createIssueSchema = z.object({
    title: z.string(),
    description: z.string(),
  });

  it("should wrap handler with validation and error handling", async () => {
    type CreateIssueDeps = { issueService: TestCradle["issueService"] };

    const toolFactory = createTool(
      { schema: createIssueSchema },
      (args: z.infer<typeof createIssueSchema>, deps: CreateIssueDeps) => {
        const issue = deps.issueService.create(args);
        return successResponse({ issue });
      }
    );

    const container = createTestContainer();
    const deps = { issueService: container.cradle.issueService };
    const tool = toolFactory(deps);

    const result = await tool({ title: "Test", description: "Test desc" });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      issue: { id: "test-issue-1", title: "Test" },
    });
  });

  it("should return validation error for invalid args", async () => {
    type Deps = { issueService: TestCradle["issueService"] };

    const toolFactory = createTool(
      { schema: createIssueSchema },
      (_args: z.infer<typeof createIssueSchema>, _deps: Deps) => {
        return successResponse({ success: true });
      }
    );

    const container = createTestContainer();
    const tool = toolFactory({ issueService: container.cradle.issueService });

    const result = await tool({ title: "Test" }); // Missing description

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
    expect(result.content[0].text).toContain("description");
  });

  it("should catch handler errors and return errorResponse", async () => {
    type Deps = { issueService: TestCradle["issueService"] };

    const toolFactory = createTool(
      { schema: createIssueSchema },
      (_args: z.infer<typeof createIssueSchema>, _deps: Deps) => {
        throw new Error("Something went wrong");
      }
    );

    const container = createTestContainer();
    const tool = toolFactory({ issueService: container.cradle.issueService });

    const result = await tool({ title: "Test", description: "Test desc" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Something went wrong");
  });
});

// =============================================================================
// createToolHandler Tests
// =============================================================================

describe("createToolHandler", () => {
  const getTaskSchema = z.object({
    taskId: z.string(),
  });

  it("should create handler that pulls deps from container cradle", async () => {
    type GetTaskDeps = { taskService: TestCradle["taskService"] };

    const toolFactory = createTool(
      { schema: getTaskSchema },
      (args: z.infer<typeof getTaskSchema>, deps: GetTaskDeps) => {
        const task = deps.taskService.get(args.taskId);
        if (!task) {
          return errorResponse(`Task not found: ${args.taskId}`);
        }
        return successResponse({ task });
      }
    );

    const container = createTestContainer();
    const handler = createToolHandler(
      toolFactory,
      (cradle) => ({ taskService: cradle.taskService }),
      container
    );

    const result = await handler({ taskId: "task-1" });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      task: { id: "task-1", title: "Test Task" },
    });
  });

  it("should use scoped container with overridden service", async () => {
    type GetTaskDeps = { taskService: TestCradle["taskService"] };

    const toolFactory = createTool(
      { schema: getTaskSchema },
      (args: z.infer<typeof getTaskSchema>, deps: GetTaskDeps) => {
        const task = deps.taskService.get(args.taskId);
        if (!task) {
          return errorResponse(`Task not found: ${args.taskId}`);
        }
        return successResponse({ task });
      }
    );

    const parent = createTestContainer();
    const scope = parent.createScope();

    // Override taskService to return different data
    scope.register({
      taskService: asValue({
        get: vi.fn((_id: string) => ({ id: "scoped-task", title: "Scoped Task" })),
      }),
    });

    const handler = createToolHandler(
      toolFactory,
      (cradle) => ({ taskService: cradle.taskService }),
      scope // Use scoped container
    );

    const result = await handler({ taskId: "any-id" });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      task: { id: "scoped-task", title: "Scoped Task" },
    });
  });
});

// =============================================================================
// createNoArgsToolHandler Tests
// =============================================================================

describe("createNoArgsToolHandler", () => {
  it("should create handler for tools with no arguments", async () => {
    type ListDeps = { issueService: TestCradle["issueService"] };

    const handler = createNoArgsToolHandler(
      (deps: ListDeps) => {
        const issues = deps.issueService.list();
        return successResponse({ issues, count: issues.length });
      },
      (cradle) => ({ issueService: cradle.issueService }),
      createTestContainer()
    );

    const result = await handler({});

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
    expect(parsed.issues).toHaveLength(2);
  });

  it("should catch errors in no-args handlers", async () => {
    type ListDeps = { issueService: TestCradle["issueService"] };

    const handler = createNoArgsToolHandler(
      (_deps: ListDeps) => {
        throw new Error("Database connection failed");
      },
      (cradle) => ({ issueService: cradle.issueService }),
      createTestContainer()
    );

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Database connection failed");
  });
});

// =============================================================================
// Integration Pattern Tests
// =============================================================================

describe("Integration testing pattern", () => {
  it("demonstrates the recommended test pattern for tool handlers", async () => {
    // 1. Create test container (or use production container)
    const container = createTestContainer();

    // 2. Create scope for this test
    const testScope = container.createScope();

    // 3. Override specific services with test doubles
    const mockIssueService = {
      create: vi.fn(() => ({ id: "mock-123", title: "Mock Issue" })),
      list: vi.fn(() => []),
    };
    testScope.register({
      issueService: asValue(mockIssueService),
    });

    // 4. Create handler with scoped container
    const createIssueSchema = z.object({
      title: z.string(),
      description: z.string(),
    });

    type Deps = { issueService: TestCradle["issueService"] };

    const toolFactory = createTool(
      { schema: createIssueSchema },
      (args: z.infer<typeof createIssueSchema>, deps: Deps) => {
        const issue = deps.issueService.create(args);
        return successResponse({ issue });
      }
    );

    const handler = createToolHandler(
      toolFactory,
      (cradle) => ({ issueService: cradle.issueService }),
      testScope
    );

    // 5. Execute handler
    const result = await handler({
      title: "Test Issue",
      description: "Test Description",
    });

    // 6. Assert on results
    expect(mockIssueService.create).toHaveBeenCalledWith({
      title: "Test Issue",
      description: "Test Description",
    });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      issue: { id: "mock-123", title: "Mock Issue" },
    });

    // 7. Parent container unchanged
    expect(container.cradle.issueService).not.toBe(mockIssueService);
  });
});
