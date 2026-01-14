/**
 * Tests for MCP Handler Bootstrap
 *
 * Demonstrates the handler pattern:
 * 1. Handlers are pure functions: (args, deps) => ToolResponse
 * 2. Middleware runs before handler, can short-circuit
 * 3. Container override for testing
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { asValue, createContainer, InjectionMode } from "awilix";
import type { AwilixContainer } from "awilix";
import {
  createMcpHandler,
  createNoArgsHandler,
  createFullCradleHandler,
  validateToolArgs,
  initializeContainer,
  compose,
} from "../../di/bootstrap.js";
import { successResponse, errorResponse, type ToolResponse } from "../../tools/types.js";
import { z } from "zod";

// =============================================================================
// Test Fixtures
// =============================================================================

interface MockIssueService {
  create: (params: { title: string; description: string }) => { id: string; title: string };
  list: () => Array<{ id: string; title: string }>;
}

interface MockTaskService {
  get: (id: string) => { id: string; title: string } | null;
}

interface TestCradle {
  issueService: MockIssueService;
  taskService: MockTaskService;
  projectId: string;
}

function createTestContainer(): AwilixContainer<TestCradle> {
  const container = createContainer<TestCradle>({
    injectionMode: InjectionMode.CLASSIC,
  });

  container.register({
    projectId: asValue("test-project"),
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
// validateToolArgs Tests
// =============================================================================

describe("validateToolArgs", () => {
  const schema = z.object({
    title: z.string(),
    description: z.string(),
  });

  it("should return success with validated data", () => {
    const result = validateToolArgs(schema, { title: "Test", description: "Test desc" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ title: "Test", description: "Test desc" });
    }
  });

  it("should return error response for invalid args", () => {
    const result = validateToolArgs(schema, { title: "Test" }); // missing description

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.isError).toBe(true);
      expect(result.response.content[0].text).toContain("description");
    }
  });

  it("should handle null/undefined args", () => {
    const result = validateToolArgs(schema, null);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.isError).toBe(true);
    }
  });
});

// =============================================================================
// createMcpHandler Tests
// =============================================================================

describe("createMcpHandler", () => {
  const createIssueSchema = z.object({
    title: z.string(),
    description: z.string(),
  });

  // Initialize container before tests
  beforeEach(() => {
    initializeContainer(createTestContainer() as unknown as AwilixContainer<never>);
  });

  it("should create handler that injects deps from cradle", async () => {
    type Deps = { issueService: MockIssueService };

    async function createIssueHandler(
      args: unknown,
      { issueService }: Deps
    ): Promise<ToolResponse> {
      const validation = validateToolArgs(createIssueSchema, args);
      if (!validation.success) return validation.response;

      const issue = issueService.create(validation.data);
      return successResponse({ issue });
    }

    const handler = createMcpHandler(createIssueHandler, (cradle: TestCradle) => ({
      issueService: cradle.issueService,
    }));

    const result = await handler(
      { title: "Test", description: "Test desc" },
      createTestContainer()
    );

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      issue: { id: "test-issue-1", title: "Test" },
    });
  });

  it("should support container override for testing", async () => {
    type Deps = { issueService: MockIssueService };

    async function createIssueHandler(
      args: unknown,
      { issueService }: Deps
    ): Promise<ToolResponse> {
      const validation = validateToolArgs(createIssueSchema, args);
      if (!validation.success) return validation.response;

      const issue = issueService.create(validation.data);
      return successResponse({ issue });
    }

    const handler = createMcpHandler(createIssueHandler, (cradle: TestCradle) => ({
      issueService: cradle.issueService,
    }));

    // Create test container with mock
    const testContainer = createTestContainer();
    const mockCreate = vi.fn(() => ({ id: "mock-id", title: "Mock Title" }));
    testContainer.register({
      issueService: asValue({ create: mockCreate, list: vi.fn() }),
    });

    const result = await handler({ title: "Test", description: "Test desc" }, testContainer);

    expect(mockCreate).toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      issue: { id: "mock-id", title: "Mock Title" },
    });
  });

  it("should catch errors and return errorResponse", async () => {
    async function failingHandler(): Promise<ToolResponse> {
      throw new Error("Something went wrong");
    }

    const handler = createMcpHandler(failingHandler, (_cradle: TestCradle) => ({}));

    const result = await handler({}, createTestContainer());

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Something went wrong");
  });
});

// =============================================================================
// Middleware Tests
// =============================================================================

describe("middleware", () => {
  beforeEach(() => {
    initializeContainer(createTestContainer() as unknown as AwilixContainer<never>);
  });

  it("should run middleware before handler", async () => {
    const middlewareOrder: string[] = [];

    const trackingMiddleware = async () => {
      middlewareOrder.push("middleware");
    };

    async function trackingHandler(_args: unknown, _deps: object): Promise<ToolResponse> {
      middlewareOrder.push("handler");
      return successResponse({ order: middlewareOrder });
    }

    const handler = createMcpHandler<object, TestCradle>(
      trackingHandler,
      () => ({}),
      trackingMiddleware
    );

    await handler({}, createTestContainer());

    expect(middlewareOrder).toEqual(["middleware", "handler"]);
  });

  it("should short-circuit when middleware returns response", async () => {
    const shortCircuitMiddleware = async () => {
      return errorResponse("Blocked by middleware");
    };

    const handlerCalled = vi.fn();
    async function handler(): Promise<ToolResponse> {
      handlerCalled();
      return successResponse({});
    }

    const wrappedHandler = createMcpHandler<object, TestCradle>(
      handler,
      () => ({}),
      shortCircuitMiddleware
    );

    const result = await wrappedHandler({}, createTestContainer());

    expect(handlerCalled).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Blocked by middleware");
  });

  it("should compose multiple middleware", async () => {
    const order: string[] = [];

    const first = async () => {
      order.push("first");
    };
    const second = async () => {
      order.push("second");
    };

    const composedMiddleware = compose(first, second);

    async function handler(): Promise<ToolResponse> {
      order.push("handler");
      return successResponse({ order });
    }

    const wrappedHandler = createMcpHandler<object, TestCradle>(
      handler,
      () => ({}),
      composedMiddleware
    );

    await wrappedHandler({}, createTestContainer());

    expect(order).toEqual(["first", "second", "handler"]);
  });

  it("should stop chain when composed middleware returns", async () => {
    const order: string[] = [];

    const first = async () => {
      order.push("first");
      return errorResponse("Stopped at first");
    };
    const second = async () => {
      order.push("second");
    };

    const composedMiddleware = compose(first, second);

    async function handler(): Promise<ToolResponse> {
      order.push("handler");
      return successResponse({});
    }

    const wrappedHandler = createMcpHandler<object, TestCradle>(
      handler,
      () => ({}),
      composedMiddleware
    );

    const result = await wrappedHandler({}, createTestContainer());

    expect(order).toEqual(["first"]);
    expect(result.isError).toBe(true);
  });
});

// =============================================================================
// createNoArgsHandler Tests
// =============================================================================

describe("createNoArgsHandler", () => {
  beforeEach(() => {
    initializeContainer(createTestContainer() as unknown as AwilixContainer<never>);
  });

  it("should create handler for tools with no arguments", async () => {
    type Deps = { issueService: MockIssueService };

    const handler = createNoArgsHandler(
      ({ issueService }: Deps) => {
        const issues = issueService.list();
        return successResponse({ issues, count: issues.length });
      },
      (cradle: TestCradle) => ({ issueService: cradle.issueService })
    );

    const result = await handler({}, createTestContainer());

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
  });
});

// =============================================================================
// createFullCradleHandler Tests
// =============================================================================

describe("createFullCradleHandler", () => {
  beforeEach(() => {
    initializeContainer(createTestContainer() as unknown as AwilixContainer<never>);
  });

  it("should pass full cradle to handler", async () => {
    const handler = createFullCradleHandler(async (_args: unknown, cradle: TestCradle) => {
      return successResponse({
        projectId: cradle.projectId,
        hasIssueService: !!cradle.issueService,
        hasTaskService: !!cradle.taskService,
      });
    });

    const result = await handler({}, createTestContainer());

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      projectId: "test-project",
      hasIssueService: true,
      hasTaskService: true,
    });
  });
});

// =============================================================================
// Integration Pattern Example
// =============================================================================

describe("Integration Pattern", () => {
  beforeEach(() => {
    initializeContainer(createTestContainer() as unknown as AwilixContainer<never>);
  });

  it("demonstrates the recommended pattern for MCP handlers", async () => {
    // 1. Define validation schema
    const createIssueSchema = z.object({
      title: z.string().min(1),
      description: z.string(),
    });

    // 2. Define handler deps type
    type CreateIssueDeps = {
      issueService: MockIssueService;
      projectId: string;
    };

    // 3. Define pure handler function
    async function createIssueHandler(
      args: unknown,
      { issueService, projectId }: CreateIssueDeps
    ): Promise<ToolResponse> {
      // Explicit validation inside handler
      const validation = validateToolArgs(createIssueSchema, args);
      if (!validation.success) return validation.response;

      // Business logic
      const issue = issueService.create(validation.data);
      return successResponse({ issue, projectId });
    }

    // 4. Define middleware (optional)
    const requireProject = async (_args: unknown, cradle: TestCradle) => {
      if (!cradle.projectId) {
        return errorResponse("Project not configured");
      }
      return undefined; // Continue chain
    };

    // 5. Create the MCP handler
    const handleCreateIssue = createMcpHandler<CreateIssueDeps, TestCradle>(
      createIssueHandler,
      (cradle: TestCradle) => ({
        issueService: cradle.issueService,
        projectId: cradle.projectId,
      }),
      requireProject
    );

    // 6. Use in production (would use default container)
    const prodResult = await handleCreateIssue(
      { title: "Test Issue", description: "Test description" },
      createTestContainer()
    );

    expect(prodResult.isError).toBeUndefined();
    expect(JSON.parse(prodResult.content[0].text)).toMatchObject({
      issue: { id: "test-issue-1", title: "Test Issue" },
      projectId: "test-project",
    });

    // 7. Use in tests with mock container
    const mockIssueService = {
      create: vi.fn(() => ({ id: "mock-123", title: "Mock Issue" })),
      list: vi.fn(() => []),
    };

    const testContainer = createTestContainer();
    testContainer.register({
      issueService: asValue(mockIssueService),
    });

    const testResult = await handleCreateIssue(
      { title: "Test Issue", description: "Test description" },
      testContainer
    );

    expect(mockIssueService.create).toHaveBeenCalledWith({
      title: "Test Issue",
      description: "Test description",
    });
    expect(JSON.parse(testResult.content[0].text)).toMatchObject({
      issue: { id: "mock-123", title: "Mock Issue" },
    });
  });
});
