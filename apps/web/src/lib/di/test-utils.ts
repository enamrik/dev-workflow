/**
 * Test Utilities for API Endpoints
 *
 * This module provides utilities for testing API endpoints in isolation:
 * - runTestApiEndpoint: Execute an endpoint with a test container
 * - buildTestContainer: Create a container with mocked dependencies
 */

import { createContainer, InjectionMode, asValue, type AwilixContainer } from "awilix";
import type { WebCradle } from "./container";
import type { Endpoint } from "./bootstrap";

// =============================================================================
// Test Request Creation
// =============================================================================

/**
 * Create a Request object for testing.
 *
 * @param method - HTTP method (GET, POST, PUT, DELETE, etc.)
 * @param path - URL path (e.g., "/api/issues/42/close")
 * @param options - Optional body object (will be JSON stringified)
 * @returns A Request object ready for use with runTestApiEndpoint
 *
 * @example
 * ```typescript
 * // POST with body
 * const req = createTestRequest("POST", "/api/issues/42/close", {
 *   body: { projectSlug: "my-project" },
 * });
 *
 * // GET without body
 * const req = createTestRequest("GET", "/api/projects");
 * ```
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
// Test Container Building
// =============================================================================

/**
 * Build a test container with mocked dependencies.
 *
 * @param mocks - Partial mocks for WebCradle dependencies
 * @returns An Awilix container with the mocked dependencies
 *
 * @example
 * ```typescript
 * const testContainer = buildTestContainer({
 *   issueAppService: {
 *     closeIssue: vi.fn().mockResolvedValue({ id: '1', status: 'CLOSED' }),
 *   },
 * });
 * ```
 */
export function buildTestContainer(
  mocks: Partial<{ [K in keyof WebCradle]: Partial<WebCradle[K]> }>
): AwilixContainer<Partial<WebCradle>> {
  const container = createContainer<Partial<WebCradle>>({
    injectionMode: InjectionMode.CLASSIC,
  });

  // Register each mock as a value
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
 * Execute an endpoint with a test container.
 *
 * This allows testing endpoints in isolation by providing mocked dependencies.
 * The endpoint is called with the test container's cradle instead of production.
 *
 * @param req - The Request object (can be constructed with `new Request(...)`)
 * @param endpoint - The wrapped endpoint (result of createApiEndpoint)
 * @param testContainer - A container with mocked dependencies
 * @param params - Optional route params (default: {})
 * @returns The NextResponse from the endpoint
 *
 * @example
 * ```typescript
 * describe('closeIssueEndpoint', () => {
 *   it('closes an issue', async () => {
 *     const testContainer = buildTestContainer({
 *       issueAppService: {
 *         closeIssue: vi.fn().mockResolvedValue({
 *           issue: { id: '1', number: 42, status: 'CLOSED' },
 *           abandonedTasks: [],
 *         }),
 *       },
 *     });
 *
 *     const req = new Request('http://localhost/api/issues/42/close', {
 *       method: 'POST',
 *       body: JSON.stringify({ projectSlug: 'my-project' }),
 *     });
 *
 *     const result = await runTestApiEndpoint(
 *       req,
 *       endpoint,
 *       testContainer,
 *       { issueNumber: '42' }
 *     );
 *
 *     expect(result.status).toBe(200);
 *     const body = await result.json();
 *     expect(body.issue.status).toBe('CLOSED');
 *   });
 *
 *   it('returns 404 for non-existent issue', async () => {
 *     const testContainer = buildTestContainer({
 *       issueAppService: {
 *         closeIssue: vi.fn().mockRejectedValue(
 *           new EntityNotFoundError('Issue', '999')
 *         ),
 *       },
 *     });
 *
 *     const req = new Request('http://localhost/api/issues/999/close', {
 *       method: 'POST',
 *       body: JSON.stringify({ projectSlug: 'my-project' }),
 *     });
 *
 *     const result = await runTestApiEndpoint(
 *       req,
 *       endpoint,
 *       testContainer,
 *       { issueNumber: '999' }
 *     );
 *
 *     expect(result.status).toBe(404);
 *   });
 * });
 * ```
 */
export async function runTestApiEndpoint<TDeps extends keyof WebCradle>(
  req: Request,
  endpoint: Endpoint<TDeps>,
  testContainer: AwilixContainer<Partial<WebCradle>>,
  params: Record<string, string> = {}
): Promise<Response> {
  return endpoint(req, params, testContainer.cradle as Pick<WebCradle, TDeps>);
}
