/**
 * Web Bootstrap - API endpoint and route creation utilities
 *
 * This module provides the infrastructure for creating type-safe API routes:
 * - parseJsonBody: Validates request body with Zod, throws on failure
 * - createApiEndpoint: Wraps endpoint with middleware and error handling
 * - createApiRoute: Binds endpoint to production container
 */

import { NextResponse } from "next/server";
import type { z } from "zod";
import { mapError } from "@dev-workflow/core";
import { ZodValidationError } from "@dev-workflow/core";
import { getWebContainer, type WebCradle } from "./container";

// =============================================================================
// Validation
// =============================================================================

/**
 * Validates request body against a Zod schema.
 * Throws ZodValidationError if validation fails (caught by createApiEndpoint).
 *
 * @param schema - Zod schema to validate against
 * @param body - Request body to validate
 * @returns Validated and typed data
 * @throws ZodValidationError if validation fails
 */
export function parseJsonBody<T extends z.ZodSchema>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    // Map Zod issues to our expected format (PropertyKey[] -> (string | number)[])
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
      message: issue.message,
    }));
    throw new ZodValidationError(issues);
  }
  return result.data;
}

// =============================================================================
// Endpoint Types
// =============================================================================

/**
 * An endpoint function that processes a request with access to the DI cradle.
 * Endpoints are pure functions that validate input, call AppServices, and return NextResponse.
 *
 * @template TDeps - The subset of WebCradle dependencies this endpoint needs
 */
export type Endpoint<TDeps extends keyof WebCradle = keyof WebCradle> = (
  req: Request,
  params: Record<string, string>,
  cradle: Pick<WebCradle, TDeps>
) => Promise<NextResponse>;

/**
 * Middleware that runs before the endpoint.
 * Can throw errors (caught by error handler) or return early responses.
 */
export type ApiMiddleware = (
  req: Request,
  params: Record<string, string>,
  cradle: WebCradle
) => Promise<NextResponse | void> | NextResponse | void;

// =============================================================================
// Endpoint Creation
// =============================================================================

/**
 * Wraps an endpoint with middleware and error handling.
 *
 * The wrapped endpoint:
 * 1. Runs middleware (if provided)
 * 2. Executes the endpoint
 * 3. Catches errors and maps them to HTTP responses via mapError
 *
 * @param endpoint - The pure endpoint function
 * @param middleware - Optional middleware to run before the endpoint
 * @returns A wrapped endpoint with error handling
 *
 * @example
 * ```typescript
 * const closeIssueEndpoint = async (
 *   req: Request,
 *   params: { issueNumber: string },
 *   { issueAppService }: Pick<WebCradle, 'issueAppService'>
 * ) => {
 *   const body = await req.json();
 *   const validated = parseJsonBody(CloseIssueSchema, { ...body, ...params });
 *   const result = await issueAppService.closeIssue(validated.projectSlug, validated.issueNumber);
 *   return NextResponse.json(result);
 * };
 *
 * export const endpoint = createApiEndpoint(closeIssueEndpoint);
 * ```
 */
export function createApiEndpoint<TDeps extends keyof WebCradle>(
  endpoint: Endpoint<TDeps>,
  middleware?: ApiMiddleware
): Endpoint<TDeps> {
  return async (
    req: Request,
    params: Record<string, string>,
    cradle: Pick<WebCradle, TDeps>
  ): Promise<NextResponse> => {
    try {
      // Run middleware first if provided
      if (middleware) {
        const earlyReturn = await middleware(req, params, cradle as WebCradle);
        if (earlyReturn !== undefined) {
          return earlyReturn;
        }
      }

      // Execute the endpoint
      return await endpoint(req, params, cradle);
    } catch (error) {
      // Map domain errors to HTTP responses
      const mapped = mapError(error);
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
  };
}

// =============================================================================
// Route Creation
// =============================================================================

/**
 * Next.js route context with params promise
 */
interface RouteContext {
  params: Promise<Record<string, string>>;
}

/**
 * Creates a Next.js route handler from an endpoint.
 *
 * This function:
 * 1. Imports the production container
 * 2. Extracts route params
 * 3. Calls the endpoint with the container's cradle
 *
 * @param endpoint - The wrapped endpoint (result of createApiEndpoint)
 * @returns A Next.js route handler function
 *
 * @example
 * ```typescript
 * // route.ts
 * import { createApiEndpoint, createApiRoute } from '@/lib/di/bootstrap';
 * import { closeIssueEndpoint } from './endpoint';
 *
 * export const endpoint = createApiEndpoint(closeIssueEndpoint);
 * export const POST = createApiRoute(endpoint);
 * ```
 */
export function createApiRoute<TDeps extends keyof WebCradle>(
  endpoint: Endpoint<TDeps>
): (req: Request, context?: RouteContext) => Promise<NextResponse> {
  return async (req: Request, context?: RouteContext): Promise<NextResponse> => {
    const container = getWebContainer();
    const params = context?.params ? await context.params : {};
    return endpoint(req, params, container.cradle as Pick<WebCradle, TDeps>);
  };
}
