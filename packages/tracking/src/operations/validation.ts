/**
 * Input validation utility for operations
 *
 * Provides runtime validation using Zod schemas. Operations call validateInput()
 * at their entry point to validate untrusted input from any presentation layer.
 */

import type { ZodSchema, ZodIssue } from "zod";
import { ZodValidationError } from "../domain/errors.js";

/**
 * Validate input against a Zod schema.
 *
 * @throws ZodValidationError if validation fails
 */
export function validateInput<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ZodValidationError(
      result.error.issues.map((i: ZodIssue) => ({
        path: i.path.filter((p): p is string | number => typeof p !== "symbol"),
        message: i.message,
      }))
    );
  }
  return result.data;
}
