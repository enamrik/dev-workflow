/**
 * Effect Runtime Utilities
 *
 * Helper functions for running Effects in different contexts.
 * Apps should create their own runtime instances with their containers.
 */

import type { AwilixContainer } from "awilix";
import type { Effect, Either } from "./effect.js";
import { runWithContainer } from "./effect.js";

/**
 * Unwraps an Either result, throwing the error if Left.
 * Useful for handlers that want to let errors propagate.
 */
export function unwrap<A, E>(either: Either<A, E>): A {
  if (either._tag === "Left") {
    throw either.left;
  }
  return either.right;
}

/**
 * Creates a runtime bound to a specific container.
 * Apps should create their own runtime with their app container.
 *
 * @param container - The Awilix container to use
 * @returns Runtime functions bound to this container
 *
 * @example
 * ```typescript
 * // In your app
 * const runtime = createRuntime(appContainer);
 *
 * // Use in handlers
 * const result = await runtime.runEffect(myEffect);
 * const data = await runtime.runEffectAndUnwrap(myEffect);
 * ```
 */
export function createRuntime<Cradle extends Record<string, unknown>>(
  container: AwilixContainer<Cradle>
) {
  return {
    /**
     * Runs an Effect with this container.
     * @returns Promise resolving to Either<Success, Error>
     */
    runEffect: async <A, E, R>(effect: Effect<A, E, R>): Promise<Either<A, E>> => {
      // Cast is safe: runtime provides dependencies from container at runtime
      // Type system validates Effect requirements against Cradle at compile time
      return runWithContainer(effect, container as AwilixContainer<never>);
    },

    /**
     * Runs an Effect and unwraps the result, throwing if error.
     * Convenient for route handlers.
     */
    runEffectAndUnwrap: async <A, E, R>(effect: Effect<A, E, R>): Promise<A> => {
      // Cast is safe: runtime provides dependencies from container at runtime
      // Type system validates Effect requirements against Cradle at compile time
      const result = await runWithContainer(effect, container as AwilixContainer<never>);
      return unwrap(result);
    },

    /**
     * The container this runtime is bound to.
     */
    container,
  };
}

export type Runtime<Cradle extends Record<string, unknown>> = ReturnType<
  typeof createRuntime<Cradle>
>;
