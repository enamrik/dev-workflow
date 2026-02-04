/**
 * Web Bootstrap - Effect-based API route creation
 *
 * createApiEndpoint: Creates a WebProgram from an Effect-returning handler.
 * createApiRoute: Binds a WebProgram to the container, producing a Next.js route handler.
 */

import { NextResponse } from "next/server";
import { Effect, createRuntime } from "@dev-workflow/effect";
import type { AwilixContainer } from "awilix";
import { mapError, ZodValidationError } from "@dev-workflow/tracking";
import { getWebContainer } from "./container";

/**
 * Version-agnostic schema interface. Works with both Zod 3 and Zod 4.
 * Any schema with a `parse` method that throws on invalid input.
 */
interface ParseableSchema<T> {
  parse(input: unknown): T;
}

/**
 * Parse input against a schema, converting parse failures to ZodValidationError.
 *
 * Unlike validateInput (which requires ZodSchema), this works with any
 * ParseableSchema. Parse errors with an `issues` array (Zod convention)
 * are converted to ZodValidationError for consistent HTTP 400 mapping.
 */
function parseSchema<T>(schema: ParseableSchema<T>, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (error: unknown) {
    if (
      error != null &&
      typeof error === "object" &&
      "issues" in error &&
      Array.isArray((error as Record<string, unknown>)["issues"])
    ) {
      const issues = (error as { issues: Array<{ path?: unknown[]; message?: string }> }).issues;
      throw new ZodValidationError(
        issues.map((i) => ({
          path: (i.path ?? []).filter(
            (p): p is string | number => typeof p === "string" || typeof p === "number"
          ),
          message: typeof i.message === "string" ? i.message : "Validation failed",
        }))
      );
    }
    throw error;
  }
}

/**
 * Container middleware for registering dynamic values before handler runs.
 */
export type ContainerMiddleware = (container: AwilixContainer) => Promise<void> | void;

// =============================================================================
// Type Definitions
// =============================================================================

interface RouteContext {
  params: Promise<Record<string, string>>;
}

/**
 * Program struct returned by createApiEndpoint.
 * Contains the Effect function and optional middleware.
 * All errors are handled — run always produces a NextResponse.
 */
export interface WebProgram<R> {
  readonly run: (req: Request, params: Record<string, string>) => Effect<NextResponse, never, R>;
  readonly middleware?: ContainerMiddleware;
}

// =============================================================================
// Program Creator
// =============================================================================

/**
 * Creates a WebProgram from an Effect handler.
 *
 * When bodySchema is provided, the request body is parsed and validated
 * before the handler runs (POST/PUT/PATCH). Without it, body is undefined (GET).
 *
 * Effect.gen converts thrown errors to Left values, so Effect.catchAll
 * handles both Effect failures and thrown errors (e.g. parseSchema).
 */
export function createApiEndpoint<T = undefined, E = unknown, R = never>(config: {
  bodySchema?: ParseableSchema<T>;
  handler: (req: Request, params: Record<string, string>, body: T) => Effect<NextResponse, E, R>;
  middleware?: ContainerMiddleware;
}): WebProgram<R> {
  const { bodySchema, handler, middleware } = config;

  return {
    run: (req: Request, params: Record<string, string>) =>
      Effect.catchAll(
        Effect.gen(function* () {
          const body = bodySchema
            ? parseSchema(
                bodySchema,
                yield* Effect.tryPromise({
                  try: async () => await req.json(),
                  catch: (e) => (e instanceof Error ? e : new Error("Invalid JSON body")),
                })
              )
            : (undefined as T);
          return yield* handler(req, params, body);
        }),
        (error: unknown) => {
          const mapped = mapError(error);
          return Effect.succeed(NextResponse.json(mapped.body, { status: mapped.status }));
        }
      ),
    middleware,
  };
}

// =============================================================================
// Route Binding (Runner)
// =============================================================================

/**
 * Binds a WebProgram to the container, producing a Next.js route handler.
 * Executes middleware (if any) before each request, then runs the Effect.
 */
export function createApiRoute<R>(
  program: WebProgram<R>
): (req: Request, context?: RouteContext) => Promise<NextResponse> {
  return async (req: Request, context?: RouteContext): Promise<NextResponse> => {
    try {
      if (program.middleware) await program.middleware(getWebContainer());
      const runtime = createRuntime(getWebContainer());
      const params = context?.params ? await context.params : {};
      return await runtime.runEffectAndUnwrap(program.run(req, params));
    } catch (error) {
      const mapped = mapError(error);
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
  };
}

// =============================================================================
// Helpers (Deprecated — use bodySchema instead)
// =============================================================================

/**
 * Parse and validate JSON body from a request as an Effect.
 *
 * @deprecated Use `bodySchema` option in `createApiEndpoint` instead.
 */
export function jsonBody<T>(req: Request, schema: ParseableSchema<T>): Effect<T, Error, never> {
  return Effect.tryPromise({
    try: async () => parseSchema(schema, await req.json()),
    catch: (e) => (e instanceof Error ? e : new Error("Invalid JSON body")),
  });
}
