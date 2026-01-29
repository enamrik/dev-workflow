/**
 * Middleware Composition
 *
 * Utilities for building middleware chains that operate on (request, container) tuples.
 * Middleware can either complete successfully (void), throw errors, or return early responses.
 */

import type { AwilixContainer } from "awilix";

/**
 * A middleware function that processes a request with access to the DI container.
 *
 * Middleware can:
 * - Complete successfully (return void/undefined)
 * - Throw an error to stop the chain (caught by error handler)
 * - Return a response early (stops chain, returns to caller)
 *
 * @template TRequest - The request type (e.g., Web Request, MCP tool args)
 * @template TContainer - The DI container cradle type
 * @template TResponse - Optional early return response type
 */
export type Middleware<TRequest, TContainer, TResponse = void> = (
  request: TRequest,
  container: TContainer
) => Promise<TResponse | void> | TResponse | void;

/**
 * Composes multiple middleware functions into a single middleware.
 *
 * Middleware is executed in order. Each middleware can:
 * - Complete successfully → next middleware runs
 * - Throw an error → chain stops, error propagates
 * - Return a value → chain stops, value is returned
 *
 * @example
 * ```typescript
 * const chain = compose(
 *   validateRequest,   // throws ValidationError if invalid
 *   authenticate,      // throws AuthenticationError if not authed
 *   authorize,         // throws AuthorizationError if forbidden
 * );
 *
 * // Use in handler
 * await chain(request, container);
 * // If we get here, all middleware passed
 * ```
 *
 * @param middlewares - Array of middleware functions to compose
 * @returns A single middleware that runs all composed middleware in order
 */
export function compose<TRequest, TContainer, TResponse>(
  ...middlewares: Middleware<TRequest, TContainer, TResponse>[]
): Middleware<TRequest, TContainer, TResponse> {
  return async (request: TRequest, container: TContainer): Promise<TResponse | void> => {
    for (const middleware of middlewares) {
      const result = await middleware(request, container);
      // If middleware returns a value (not void/undefined), stop chain and return it
      if (result !== undefined) {
        return result;
      }
    }
    // All middleware completed without returning
    return undefined;
  };
}

/**
 * Creates an endpoint that combines middleware with a handler.
 *
 * The middleware chain runs first. If it completes without returning,
 * the handler is called. If middleware returns a value, that value
 * is returned instead of calling the handler.
 *
 * @example
 * ```typescript
 * const middlewareChain = compose(validateRequest, authenticate);
 *
 * const getIssue = createEndpoint(
 *   async (request, { issueService }) => {
 *     const issue = await issueService.findById(request.params.id);
 *     return issue;
 *   },
 *   middlewareChain
 * );
 * ```
 *
 * @param handler - The main handler function
 * @param middleware - Optional middleware chain to run before handler
 * @returns An endpoint function that combines middleware and handler
 */
export function createEndpoint<TRequest, TContainer, TResponse>(
  handler: (request: TRequest, container: TContainer) => Promise<TResponse> | TResponse,
  middleware?: Middleware<TRequest, TContainer, TResponse | void>
): (request: TRequest, container: TContainer) => Promise<TResponse> {
  return async (request: TRequest, container: TContainer): Promise<TResponse> => {
    // Run middleware first if provided
    if (middleware) {
      const earlyReturn = await middleware(request, container);
      if (earlyReturn !== undefined) {
        return earlyReturn as TResponse;
      }
    }

    // Run the main handler
    return handler(request, container);
  };
}

/**
 * Creates an API handler that provides DI container scope and error handling.
 *
 * This is the outermost wrapper for web endpoints. It:
 * 1. Creates a scoped container for the request
 * 2. Runs the endpoint with the scoped container
 * 3. Maps any errors to HTTP responses
 * 4. Disposes the container scope when done
 *
 * @example
 * ```typescript
 * // Define the endpoint with middleware
 * const endpoint = createEndpoint(getIssueHandler, authMiddleware);
 *
 * // Wrap with API handler to get a ready-to-use route
 * export const GET = createApiHandler(webContainer, endpoint);
 * ```
 *
 * Note: This is a reference implementation. Each package (web, mcp, cli)
 * may have its own version with package-specific error handling.
 *
 * @param container - The parent DI container
 * @param endpoint - The endpoint function to wrap
 * @param errorMapper - Function to map errors to responses (defaults to mapError)
 * @returns An async function suitable for HTTP route handlers
 */
export function createApiHandler<TRequest, TCradle extends object, TResponse>(
  container: AwilixContainer<TCradle>,
  endpoint: (request: TRequest, cradle: TCradle) => Promise<TResponse>,
  errorMapper: (error: unknown) => { status: number; body: object } = (error) => ({
    status: 500,
    body: { error: error instanceof Error ? error.message : String(error) },
  })
): (request: TRequest) => Promise<{ status: number; body: TResponse | object }> {
  return async (request: TRequest) => {
    const scope = container.createScope();
    try {
      const result = await endpoint(request, scope.cradle);
      return { status: 200, body: result };
    } catch (error) {
      const mapped = errorMapper(error);
      return { status: mapped.status, body: mapped.body };
    } finally {
      await scope.dispose();
    }
  };
}
