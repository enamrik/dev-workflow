/**
 * Tests for MCP Handler Bootstrap
 *
 * Demonstrates the Effect-based handler pattern:
 * 1. Handlers are (args) => Effect<ToolResponse, E, R>
 * 2. createMcpHandler catches E channel errors, returns E=never
 * 3. createMcpTool binds handler to container for production use
 * 4. Effect.runPromise runs handler with provided dependencies
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { asValue, createContainer, InjectionMode } from "awilix";
import type { AwilixContainer } from "awilix";
import { z } from "zod";
import { createMcpHandler, createMcpTool } from "../../di/bootstrap.js";
import { successResponse } from "../../tools/types.js";
import { Effect, Service } from "@dev-workflow/effect";

const CreateIssueArgsSchema = z.object({ title: z.string(), description: z.string() });

// =============================================================================
// Test Fixtures
// =============================================================================

interface MockIssueService {
  create: (params: { title: string; description: string }) => { id: string; title: string };
  list: () => Array<{ id: string; title: string }>;
}

// Effect service tags for dependency injection
class IssueServiceTag extends Service<MockIssueService>()("issueService") {}
class ProjectIdTag extends Service<string>()("projectId") {}

interface TestCradle {
  issueService: MockIssueService;
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
  });

  return container;
}

// =============================================================================
// createMcpHandler Tests
// =============================================================================

describe("createMcpHandler", () => {
  beforeEach(() => {});

  it("should create handler that yields services from environment", async () => {
    const handler = createMcpHandler({
      schema: CreateIssueArgsSchema,
      handler: (args) =>
        Effect.gen(function* () {
          const issueService = yield* IssueServiceTag;
          const issue = issueService.create(args);
          return successResponse({ issue });
        }),
    });

    const container = createTestContainer();
    const result = await Effect.runPromise(
      handler.run({ title: "Test", description: "Test desc" }),
      container.cradle as never
    );

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      issue: { id: "test-issue-1", title: "Test" },
    });
  });

  it("should support container override for testing", async () => {
    const handler = createMcpHandler({
      schema: CreateIssueArgsSchema,
      handler: (args) =>
        Effect.gen(function* () {
          const issueService = yield* IssueServiceTag;
          const issue = issueService.create(args);
          return successResponse({ issue });
        }),
    });

    // Create test container with mock
    const testContainer = createTestContainer();
    const mockCreate = vi.fn(() => ({ id: "mock-id", title: "Mock Title" }));
    testContainer.register({
      issueService: asValue({ create: mockCreate, list: vi.fn() }),
    });

    const result = await Effect.runPromise(
      handler.run({ title: "Test", description: "Test desc" }),
      testContainer.cradle as never
    );

    expect(mockCreate).toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      issue: { id: "mock-id", title: "Mock Title" },
    });
  });

  it("should catch E-channel errors and return errorResponse", async () => {
    const handler = createMcpHandler({
      schema: z.object({}),
      handler: () => Effect.fail(new Error("Something went wrong")),
    });

    const result = await Effect.runPromise(handler.run({}), {} as never);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Something went wrong");
  });

  it("should catch thrown errors via createMcpTool", async () => {
    const handler = createMcpHandler({
      schema: z.object({}),
      handler: () =>
        // eslint-disable-next-line require-yield
        Effect.gen(function* () {
          throw new Error("Unexpected failure");
          return successResponse({});
        }),
    });

    const container = createTestContainer();
    const tool = createMcpTool(handler, container);
    const result = await tool({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unexpected failure");
  });
});

// =============================================================================
// createMcpTool Tests
// =============================================================================

describe("createMcpTool", () => {
  it("should bind handler to container and return a callable tool", async () => {
    const handler = createMcpHandler({
      schema: CreateIssueArgsSchema,
      handler: (args) =>
        Effect.gen(function* () {
          const issueService = yield* IssueServiceTag;
          const issue = issueService.create(args);
          return successResponse({ issue });
        }),
    });

    const container = createTestContainer();
    const tool = createMcpTool(handler, container);

    const result = await tool({ title: "Bound Test", description: "desc" });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      issue: { id: "test-issue-1", title: "Bound Test" },
    });
  });
});

// =============================================================================
// Integration Pattern Example
// =============================================================================

describe("Integration Pattern", () => {
  beforeEach(() => {});

  it("demonstrates the recommended pattern for MCP handlers", async () => {
    // 1. Define handler using Effect.gen and service tags
    const handleCreateIssue = createMcpHandler({
      schema: CreateIssueArgsSchema,
      handler: (args) =>
        Effect.gen(function* () {
          const issueService = yield* IssueServiceTag;
          const projectId = yield* ProjectIdTag;
          const issue = issueService.create(args);
          return successResponse({ issue, projectId });
        }),
    });

    // 2. Use in production via createMcpTool (binds to container)
    const container = createTestContainer();
    const tool = createMcpTool(handleCreateIssue, container);

    const prodResult = await tool({ title: "Test Issue", description: "Test description" });

    expect(prodResult.isError).toBeUndefined();
    expect(JSON.parse(prodResult.content[0].text)).toMatchObject({
      issue: { id: "test-issue-1", title: "Test Issue" },
      projectId: "test-project",
    });

    // 3. Use in tests with mock container
    const mockIssueService = {
      create: vi.fn(() => ({ id: "mock-123", title: "Mock Issue" })),
      list: vi.fn(() => []),
    };

    const testContainer = createTestContainer();
    testContainer.register({
      issueService: asValue(mockIssueService),
    });

    const testResult = await Effect.runPromise(
      handleCreateIssue.run({ title: "Test Issue", description: "Test description" }),
      testContainer.cradle as never
    );

    expect(mockIssueService.create).toHaveBeenCalledWith({
      title: "Test Issue",
      description: "Test description",
    });
    expect(JSON.parse(testResult.content[0].text)).toMatchObject({
      issue: { id: "mock-123", title: "Mock Issue" },
    });
  });

  it("demonstrates handler for tools with no arguments", async () => {
    const handleListIssues = createMcpHandler({
      schema: z.object({}),
      handler: () =>
        Effect.gen(function* () {
          const issueService = yield* IssueServiceTag;
          const issues = issueService.list();
          return successResponse({ issues, count: issues.length });
        }),
    });

    const result = await Effect.runPromise(
      handleListIssues.run({}),
      createTestContainer().cradle as never
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
  });
});
