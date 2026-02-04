import { type AwilixContainer, createContainer, type Resolver } from "awilix";

// types
export interface Effect<A, E = never, R = never> {
  readonly _tag: "Effect";
  _run: (env: DepsToRecord<R>) => Promise<Either<A, E>>;
  [Symbol.iterator](): Generator<Effect<A, E, R>, A, unknown>;
}

export type Either<A, E> = { _tag: "Right"; right: A } | { _tag: "Left"; left: E };

/**
 * Tag - internal type used by Service (not exported for direct use)
 */
class Tag<Id, Service> implements Effect<Service, never, Tag<Id, Service>> {
  readonly _tag = "Effect" as const;

  constructor(readonly id: Id & string) {}

  _run(env: Record<string, unknown>): Promise<Either<Service, never>> {
    return Promise.resolve({ _tag: "Right", right: env[this.id] as Service });
  }

  [Symbol.iterator](): Generator<Effect<Service, never, Tag<Id, Service>>, Service, unknown> {
    return function* (this: Tag<Id, Service>) {
      return (yield this) as Service;
    }.call(this);
  }
}

/**
 * Service - creates a base class for Effect-based services
 *
 * Services extend this base class to become yieldable in Effect.gen blocks.
 * The class name is used both as the value (yield* AuthProvider) and in
 * dependency types (typeof AuthProvider).
 *
 * Example:
 *   class AuthProvider extends Service<AuthProvider>()('AuthProvider') {
 *     private apiKey: string
 *     constructor(apiKey: string) {
 *       super()
 *       this.apiKey = apiKey
 *     }
 *     async sync(id: string): Promise<void> { ... }
 *   }
 *
 * Usage:
 *   - Yield in generators: const auth = yield* AuthProvider
 *   - Type in signatures: Effect<User, Error, typeof AuthProvider>
 */
export const Service =
  <Self>() =>
  <Id extends string>(id: Id) => {
    // Static-only class pattern required for dual-purpose service tags
    // Used both as values (yield* AuthProvider) and types (typeof AuthProvider)
    // biome-ignore lint/complexity/noStaticOnlyClass: Required for Effect service tag pattern
    abstract class ServiceBase {
      static readonly _tag = "Effect" as const;
      static readonly id = id;

      static _run(env: Record<string, unknown>): Promise<Either<Self, never>> {
        return Promise.resolve({ _tag: "Right", right: env[id] as Self });
      }

      static *[Symbol.iterator](): Generator<Effect<Self, never, Tag<Id, Self>>, Self, unknown> {
        return (yield ServiceBase) as Self;
      }
    }

    // Explicitly type the class constructor as an Effect
    return ServiceBase as typeof ServiceBase & Effect<Self, never, Tag<Id, Self>>;
  };

export type DepsToRecord<R> = [R] extends [never]
  ? Record<string, never>
  : { [S in R as TagId<S>]: ServiceType<S> };

// Type extractors use 'infer X extends Constraint' pattern to extract specific type parameters
// while ignoring others. Constraints on infer ensure extracted types are valid (e.g., string for keys).
type TagId<S> = S extends Tag<infer Id extends string, unknown> ? Id : never;
type ServiceType<S> = S extends Tag<unknown, infer Service> ? Service : never;
type ErrorOf<C> = C extends Effect<unknown, infer E, unknown> ? E : never;
type DepsOf<C> = C extends Effect<unknown, unknown, infer R> ? R : never;

// Helper to create Effects with iterator protocol
const makeEffect = <A, E = never, R = never>(
  run: (env: DepsToRecord<R>) => Promise<Either<A, E>>
): Effect<A, E, R> => {
  const effect: Effect<A, E, R> = {
    _tag: "Effect",
    _run: run,
    [Symbol.iterator]: function* () {
      return (yield effect) as A;
    },
  };
  return effect;
};

// constructors - match Effect's API
export const Effect = {
  /**
   * Create a custom Effect with full control over execution
   * Use this when you need to manually handle the environment
   */
  make: makeEffect,
  succeed: <A>(value: A): Effect<A, never, never> =>
    makeEffect(async () => ({ _tag: "Right", right: value })),

  fail: <E>(error: E): Effect<never, E, never> =>
    makeEffect(async () => ({ _tag: "Left", left: error })),

  /**
   * Wraps a Promise. Unexpected errors propagate as exceptions.
   * Use for internal wrapping (e.g., repo calls in domain services).
   */
  promise: <A>(fn: () => Promise<A>): Effect<A, never, never> =>
    makeEffect(async () => ({ _tag: "Right", right: await fn() })),

  tryPromise: <A, E>(options: {
    try: () => Promise<A>;
    catch: (e: unknown) => E;
  }): Effect<A, E, never> =>
    makeEffect(async () => {
      try {
        return { _tag: "Right", right: await options.try() };
      } catch (e) {
        return { _tag: "Left", left: options.catch(e) };
      }
    }),

  // Now supports yield* with full type safety
  gen: <Eff extends Effect<unknown, unknown, unknown>, AReturn>(
    fn: () => Generator<Eff, AReturn, unknown>
  ): Effect<AReturn, ErrorOf<Eff>, DepsOf<Eff>> =>
    makeEffect(async (env) => {
      try {
        const gen = fn();
        let next = gen.next();

        while (!next.done) {
          const effect = next.value;
          const result = await effect._run(env as DepsToRecord<DepsOf<Eff>>);
          if (result._tag === "Left") return result as Either<never, ErrorOf<Eff>>;
          next = gen.next(result.right);
        }

        return { _tag: "Right", right: next.value };
      } catch (error) {
        return { _tag: "Left", left: error as ErrorOf<Eff> };
      }
    }),

  map: <A, B, E, R>(self: Effect<A, E, R>, fn: (a: A) => B): Effect<B, E, R> =>
    makeEffect(async (env) => {
      const result = await self._run(env as DepsToRecord<R>);
      if (result._tag === "Left") return result;
      return { _tag: "Right", right: fn(result.right) };
    }),

  flatMap: <A, B, E1, E2, R1, R2>(
    self: Effect<A, E1, R1>,
    fn: (a: A) => Effect<B, E2, R2>
  ): Effect<B, E1 | E2, R1 | R2> =>
    makeEffect(async (env) => {
      const result = await self._run(env as DepsToRecord<R1>);
      if (result._tag === "Left") return result as Either<never, E1 | E2>;
      return fn(result.right)._run(env as DepsToRecord<R2>);
    }),

  catchAll: <A, E, E2, R, R2>(
    self: Effect<A, E, R>,
    fn: (e: E) => Effect<A, E2, R2>
  ): Effect<A, E2, R | R2> =>
    makeEffect(async (env) => {
      const result = await self._run(env as DepsToRecord<R>);
      if (result._tag === "Left") return fn(result.left)._run(env as DepsToRecord<R2>);
      return result;
    }),

  all: <T extends readonly Effect<unknown, unknown, unknown>[]>(
    effects: T
  ): Effect<
    { [K in keyof T]: T[K] extends Effect<infer A, unknown, unknown> ? A : never },
    ErrorOf<T[number]>,
    DepsOf<T[number]>
  > =>
    makeEffect(async (env) => {
      const results: unknown[] = [];
      for (const effect of effects) {
        const result = await effect._run(env as DepsToRecord<DepsOf<T[number]>>);
        if (result._tag === "Left") return result as Either<never, ErrorOf<T[number]>>;
        results.push(result.right);
      }
      return {
        _tag: "Right",
        right: results as {
          [K in keyof T]: T[K] extends Effect<infer A, unknown, unknown> ? A : never;
        },
      };
    }),

  // parallel version
  allPar: <T extends readonly Effect<unknown, unknown, unknown>[]>(
    effects: T
  ): Effect<
    { [K in keyof T]: T[K] extends Effect<infer A, unknown, unknown> ? A : never },
    ErrorOf<T[number]>,
    DepsOf<T[number]>
  > =>
    makeEffect(async (env) => {
      const results = await Promise.all(
        effects.map((e) => e._run(env as DepsToRecord<DepsOf<T[number]>>))
      );
      const firstError = results.find((r) => r._tag === "Left");
      if (firstError) return firstError as Either<never, ErrorOf<T[number]>>;
      return {
        _tag: "Right",
        right: results.map((r) => (r._tag === "Right" ? r.right : undefined)) as {
          [K in keyof T]: T[K] extends Effect<infer A, unknown, unknown> ? A : never;
        },
      };
    }),

  // provide dependencies
  provide: <A, E, R, R2 extends Partial<DepsToRecord<R>>>(
    self: Effect<A, E, R>,
    deps: R2
  ): Effect<A, E, Exclude<R, R2[keyof R2]>> =>
    makeEffect(async (env) => self._run({ ...env, ...deps } as DepsToRecord<R>)),

  // Run an effect with provided dependencies and return a Promise
  runPromise: async <A, E, R>(
    effect: Effect<A, E, R>,
    deps: DepsToRecord<R> = {} as DepsToRecord<R>
  ): Promise<A> => {
    const result = await effect._run(deps);
    if (result._tag === "Left") {
      throw result.left;
    }
    return result.right;
  },
};

// awilix integration
/**
 * Creates a container with compile-time enforcement that ALL cradle properties are registered.
 * Unlike awilix's register() which accepts partial registrations, this requires everything upfront.
 */
export function buildContainer<Cradle extends Record<string, unknown>>(registrations: {
  [K in keyof Cradle]: Resolver<Cradle[K]>;
}): AwilixContainer<Cradle> {
  const container = createContainer<Cradle>();
  container.register(registrations);
  return container;
}

export const runWithContainer = async <A, E, R, Cradle extends DepsToRecord<R>>(
  effect: Effect<A, E, R>,
  container: AwilixContainer<Cradle>
): Promise<Either<A, E>> => {
  return effect._run(container.cradle as DepsToRecord<R>);
};
