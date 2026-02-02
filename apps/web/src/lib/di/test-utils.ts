/**
 * Test Utilities for API Endpoints
 *
 * Provides utilities for testing Effect-based API endpoints:
 * - createTestContainer: Build a container with mocked dependencies
 * - runTestEndpoint: Execute an Effect handler with a test container
 */

import { createContainer, InjectionMode, asValue, type AwilixContainer } from "awilix";
import { createRuntime } from "@dev-workflow/effect";
import { NextResponse } from "next/server";
import { mapError } from "@dev-workflow/tracking";
import type { WebProgram } from "./bootstrap";

// =============================================================================
// Test Request Creation
// =============================================================================

/**
 * Create a Request object for testing.
 */
export function createTestRequest(
  method: string,
  path: string,
  options?: { body?: Record<string, unknown> }
): Request {
  const init: RequestInit = { method };

  if (options?.body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(options.body);
  }

  return new Request(`http://localhost${path}`, init);
}

// =============================================================================
// Mock Source Provider
// =============================================================================

/**
 * Create a mock DbSourceProvider that returns a mock DbClient.
 *
 * Builds the sourceProvider → source → client chain so operations
 * that call `getDbClient(project, sourceProvider)` get the provided mock client.
 *
 * @example
 * ```typescript
 * const container = createTestContainer({
 *   projectsResolver: { getAllProjects: async () => [mockProject] },
 *   sourceProvider: createMockSourceProvider({
 *     issues: { findMany: async () => mockIssues },
 *     plans: { findByIssueId: async () => null },
 *   }),
 * });
 * ```
 */
export function createMockSourceProvider(
  mockClient: Record<string, unknown>
): Record<string, unknown> {
  return {
    getOrCreate: () => ({
      provision: async () => {},
      createClient: () => mockClient,
    }),
  };
}

// =============================================================================
// Test Container Building
// =============================================================================

/**
 * Build a test container with mocked dependencies.
 *
 * For mutation endpoints, provide a mock DomainExecutorFactory:
 * @example
 * ```typescript
 * const container = createTestContainer({
 *   domain: {
 *     forProject: () => Effect.succeed({
 *       tasks: { getOrThrow: () => Effect.succeed(mockTask) },
 *     }),
 *   },
 * });
 * ```
 *
 * For query endpoints, provide stub infrastructure deps:
 * @example
 * ```typescript
 * const container = createTestContainer({
 *   projectsResolver: { getAllProjects: vi.fn() },
 *   sourceProvider: { getOrCreate: vi.fn() },
 * });
 * ```
 */
export function createTestContainer(
  mocks: Record<string, unknown>
): AwilixContainer<Record<string, unknown>> {
  const container = createContainer<Record<string, unknown>>({
    injectionMode: InjectionMode.PROXY,
  });

  for (const [key, value] of Object.entries(mocks)) {
    container.register({
      [key]: asValue(value),
    });
  }

  return container;
}

// =============================================================================
// Test Endpoint Execution
// =============================================================================

/**
 * Execute an Effect endpoint handler with a test container.
 *
 * Accepts a WebProgram struct (from createApiEndpoint). Mirrors production
 * createApiRoute behavior: runs middleware (if any), runs the Effect, and
 * catches any thrown exceptions (e.g., ZodValidationError from validateInput),
 * mapping them to HTTP error responses via mapError.
 *
 * @example
 * ```typescript
 * const result = await runTestEndpoint(
 *   container,
 *   endpoint,
 *   createTestRequest("POST", "/api/tasks/t1/abandon", { body: { projectSlug: "p" } }),
 *   { taskId: "t1" },
 * );
 * expect(result.status).toBe(200);
 * ```
 */
export async function runTestEndpoint(
  container: AwilixContainer<Record<string, unknown>>,
  program: WebProgram<unknown>,
  req: Request,
  params: Record<string, string> = {}
): Promise<Response> {
  try {
    if (program.middleware) await program.middleware(container);
    const runtime = createRuntime(container);
    return await runtime.runEffectAndUnwrap(program.run(req, params));
  } catch (error) {
    const mapped = mapError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
