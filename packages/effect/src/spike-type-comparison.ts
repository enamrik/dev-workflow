/**
 * SPIKE: Type inference comparison - Custom Effect vs effect-ts
 *
 * This file compares the TypeScript type inference between our custom Effect
 * library and the official effect-ts library. Run `pnpm tsc --noEmit` to see
 * the type-level behavior.
 *
 * This file is NOT meant to run - it's for type checking only.
 */

// ============================================================================
// PART A: Custom Effect Library Types
// ============================================================================

import { Effect as CustomEffect, Service as CustomService } from "./effect.js";

// Define tags with custom library
class CustomIssueRepo extends CustomService<{ findById(id: string): Promise<string | null> }>()(
  "issueRepo"
) {}
class CustomEventBus extends CustomService<{ emit(e: string): void }>()("eventBus") {}

// Effect.gen with custom library
const customOperation = CustomEffect.gen(function* () {
  // Type of `repo` when you hover in VS Code:
  // Custom: `{ findById(id: string): Promise<string | null> }`
  const repo = yield* CustomIssueRepo;
  const bus = yield* CustomEventBus;

  const result = yield* CustomEffect.promise(() => repo.findById("1"));
  bus.emit("done");
  return result;
});

// What is the inferred type of customOperation?
// CustomEffect<string | null, never, Tag<"issueRepo", ...> | Tag<"eventBus", ...>>
//
// The R channel shows Tag<Id, Service> which is not very readable.
// Error channel tracking: `never` (no errors declared)
// Hover customOperation in VS Code to see:
// Effect<string | null, never, Tag<"issueRepo", ...> | Tag<"eventBus", ...>>

// Error handling with custom library
const customWithError = CustomEffect.gen(function* () {
  const repo = yield* CustomIssueRepo;
  const result = yield* CustomEffect.tryPromise({
    try: () => repo.findById("1"),
    catch: (e) => new Error(`DB error: ${e}`),
  });
  if (!result) {
    return yield* CustomEffect.fail(new Error("Not found"));
  }
  return result;
});

// Type: CustomEffect<string, Error, Tag<"issueRepo", ...>>
// The Error union is: Error (merged from tryPromise.catch + fail)
// Hover customWithError in VS Code to see:
// Effect<string, Error, Tag<"issueRepo", ...>>

// ============================================================================
// PART B: effect-ts Library Types
// ============================================================================

import { Effect, Context } from "effect";

// Define tags with effect-ts
class EffectTsIssueRepo extends Context.Tag("issueRepo")<
  EffectTsIssueRepo,
  { findById(id: string): Promise<string | null> }
>() {}

class EffectTsEventBus extends Context.Tag("eventBus")<
  EffectTsEventBus,
  { emit(e: string): void }
>() {}

// Effect.gen with effect-ts
const effectTsOperation = Effect.gen(function* () {
  // Type of `repo` when you hover in VS Code:
  // effect-ts: `{ findById(id: string): Promise<string | null> }`
  const repo = yield* EffectTsIssueRepo;
  const bus = yield* EffectTsEventBus;

  const result = yield* Effect.promise(() => repo.findById("1"));
  bus.emit("done");
  return result;
});

// What is the inferred type of effectTsOperation?
// Effect<string | null, never, EffectTsIssueRepo | EffectTsEventBus>
//
// The R channel shows the TAG CLASS NAME - much more readable!
// Instead of Tag<"issueRepo", ...> we see EffectTsIssueRepo
// Hover effectTsOperation in VS Code to see:
// Effect<string | null, never, EffectTsIssueRepo | EffectTsEventBus>

// Error handling with effect-ts
const effectTsWithError = Effect.gen(function* () {
  const repo = yield* EffectTsIssueRepo;
  const result = yield* Effect.tryPromise({
    try: () => repo.findById("1"),
    catch: (e) => new Error(`DB error: ${e}`),
  });
  if (!result) {
    return yield* Effect.fail(new Error("Not found"));
  }
  return result;
});

// Type: Effect<string, Error, EffectTsIssueRepo>
// Error union is properly tracked
// Hover effectTsWithError in VS Code to see:
// Effect<string, Error, EffectTsIssueRepo>

// ============================================================================
// PART C: Key Differences
// ============================================================================

// 1. R channel readability:
//    Custom:    Tag<"issueRepo", { findById... }> | Tag<"eventBus", { emit... }>
//    effect-ts: EffectTsIssueRepo | EffectTsEventBus
//    Winner: effect-ts (class names in R channel, not opaque Tag types)

// 2. Error type tracking:
//    Both track Error types in the E channel similarly.
//    effect-ts has richer error types (Cause, defects vs failures)

// 3. Effect.gen signature:
//    Custom:    Effect.gen(function* () { ... })   ← same!
//    effect-ts: Effect.gen(function* () { ... })   ← same!
//    No difference in generator syntax.

// 4. yield* behavior:
//    Custom:    yield* CustomIssueRepo → service type
//    effect-ts: yield* EffectTsIssueRepo → service type
//    Identical usage pattern.

// 5. Composition (map, flatMap, catchAll):
//    Custom:    Effect.map(effect, fn)      ← static method style
//    effect-ts: effect.pipe(Effect.map(fn)) ← pipeable + static
//    effect-ts also supports: Effect.map(effect, fn) ← same as custom!

// 6. Additional effect-ts features available after migration:
//    - Effect.retry with Schedule
//    - Effect.timeout
//    - Effect.race
//    - Effect.fork (fibers)
//    - Effect.acquireRelease (resource management)
//    - Stream, Queue, Ref, etc.
//    - Schema (runtime validation with type inference)

// ============================================================================
// PART D: Breaking Changes Identified
// ============================================================================

// 1. Import paths change:
//    BEFORE: import { Effect, Service } from "@dev-workflow/effect"
//    AFTER:  import { Effect, Context } from "effect"

// 2. Service definition changes:
//    BEFORE: class Foo extends Service<FooType>()("foo") {}
//    AFTER:  class Foo extends Context.Tag("foo")<Foo, FooType>() {}

// 3. buildContainer (Awilix helper) stays the same - it's just Awilix

// 4. createRuntime changes:
//    BEFORE: createRuntime(container).runEffectAndUnwrap(effect)
//    AFTER:  Runtime.runPromise(runtimeFromAwilix)(effect)
//    OR:     Effect.runPromise(Effect.provide(effect, contextFromAwilix))

// 5. Either type changes:
//    BEFORE: { _tag: "Right", right: A } | { _tag: "Left", left: E }
//    AFTER:  effect-ts uses Exit<A, E> (Exit.Success | Exit.Failure)
//    The Either from our custom lib is not used directly by consumers
//    since runEffectAndUnwrap unwraps it. This is internal.

// 6. Effect.provide signature changes:
//    BEFORE: Effect.provide(effect, partialDeps)  ← plain object
//    AFTER:  Effect.provideService(effect, Tag, impl) or Effect.provide(effect, context)
//    Our custom Effect.provide takes a partial deps object.
//    effect-ts requires explicit Tag + value pairs.

// ============================================================================
// PART E: Type-level verification that patterns work
// ============================================================================

// Verify: yielding a tag gives the correct service type
const _verifyYield = Effect.gen(function* () {
  const repo: { findById(id: string): Promise<string | null> } = yield* EffectTsIssueRepo;
  const bus: { emit(e: string): void } = yield* EffectTsEventBus;
  return { repo, bus };
});

// Verify: catchAll works
const _verifyCatchAll = Effect.gen(function* () {
  const repo = yield* EffectTsIssueRepo;
  return yield* Effect.tryPromise({
    try: () => repo.findById("1"),
    catch: (e) => new Error(`${e}`),
  });
}).pipe(
  Effect.catchAll((e) => Effect.succeed(`recovered from: ${e.message}`))
);
// Type: Effect<string | null, never, EffectTsIssueRepo>

// Verify: map works
const _verifyMap = Effect.map(effectTsOperation, (result) => ({ wrapped: result }));
// Type: Effect<{ wrapped: string | null }, never, EffectTsIssueRepo | EffectTsEventBus>

// Verify: flatMap works
const _verifyFlatMap = Effect.flatMap(effectTsOperation, (result) =>
  Effect.succeed({ processed: result })
);

// Prevent unused variable errors
void _verifyYield;
void _verifyCatchAll;
void _verifyMap;
void _verifyFlatMap;
void customOperation;
void customWithError;
void effectTsOperation;
void effectTsWithError;
