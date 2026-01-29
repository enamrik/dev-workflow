/**
 * Error Mapping (Infrastructure Layer)
 *
 * This module provides HTTP-aware error mapping for domain errors.
 * It is the ONLY place in the codebase that knows about HTTP status codes.
 * Domain errors remain pure business concepts.
 */

import {
  DomainError,
  EntityNotFoundError,
  ValidationError,
  ZodValidationError,
  ConflictError,
  BusinessRuleError,
  AuthenticationError,
  AuthorizationError,
} from "../errors.js";

/**
 * HTTP response structure for errors
 */
export interface HttpErrorResponse {
  status: number;
  body: {
    error: string;
    code?: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Maps a domain error to an HTTP error response.
 *
 * This is the single source of truth for error-to-HTTP mapping.
 * All HTTP handlers should use this to convert caught errors.
 *
 * @param error - Any error thrown during request processing
 * @returns HTTP-ready response with status and body
 */
export function mapError(error: unknown): HttpErrorResponse {
  // Handle domain errors with specific mappings
  if (error instanceof EntityNotFoundError) {
    return {
      status: 404,
      body: {
        error: error.message,
        code: error.code,
        details: {
          entityType: error.entityType,
          id: error.id,
        },
      },
    };
  }

  if (error instanceof ValidationError) {
    return {
      status: 400,
      body: {
        error: error.message,
        code: error.code,
        details: {
          field: error.field,
          reason: error.reason,
        },
      },
    };
  }

  if (error instanceof ZodValidationError) {
    return {
      status: 400,
      body: {
        error: error.message,
        code: error.code,
        details: {
          issues: error.issues,
        },
      },
    };
  }

  if (error instanceof ConflictError) {
    return {
      status: 409,
      body: {
        error: error.message,
        code: error.code,
      },
    };
  }

  if (error instanceof BusinessRuleError) {
    return {
      status: 422,
      body: {
        error: error.message,
        code: error.code,
      },
    };
  }

  if (error instanceof AuthenticationError) {
    return {
      status: 401,
      body: {
        error: error.message,
        code: error.code,
      },
    };
  }

  if (error instanceof AuthorizationError) {
    return {
      status: 403,
      body: {
        error: error.message,
        code: error.code,
      },
    };
  }

  // Handle any other DomainError subclasses we haven't mapped explicitly
  if (error instanceof DomainError) {
    return {
      status: 500,
      body: {
        error: error.message,
        code: error.code,
      },
    };
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        error: error.message,
      },
    };
  }

  // Handle non-Error values
  return {
    status: 500,
    body: {
      error: String(error),
    },
  };
}

/**
 * Type guard to check if an error is a domain error
 */
export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
