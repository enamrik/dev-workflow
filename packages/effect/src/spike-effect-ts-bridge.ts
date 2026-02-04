/**
 * SPIKE: Proof-of-concept for bridging Awilix with effect-ts
 *
 * This file demonstrates how to replace the custom Effect library with the
 * official effect-ts library while keeping Awilix for dependency injection.
 *
 * Run with: npx tsx packages/effect/src/spike-effect-ts-bridge.ts
 */

import { Context, Effect, Runtime } from "effect";
import { createContainer, asClass, type AwilixContainer, type Resolver } from "awilix";

// ============================================================================
// SECTION 1: Define service tags using effect-ts Context.Tag
// ============================================================================

// Pattern: class Name extends Context.Tag("cradleKey")<Name, ServiceType>() {}
// The string ID matches the Awilix cradle key, just like our custom Service()() pattern.

interface IIssueRepository {
  findById(id: string): Promise<{ id: string; title: string } | null>;
  findAll(): Promise<Array<{ id: string; title: string }>>;
}

interface IEventBus {
  emit(event: string, data: unknown): void;
}

// Tags - ID string matches Awilix registration key
class IssueRepo extends Context.Tag("issueRepository")<IssueRepo, IIssueRepository>() {}
class EventBusTag extends Context.Tag("eventBus")<EventBusTag, IEventBus>() {}

// ============================================================================
// SECTION 2: Implement services (same as current codebase)
// ============================================================================

class InMemoryIssueRepository implements IIssueRepository {
  private readonly issues = [
    { id: "1", title: "First issue" },
    { id: "2", title: "Second issue" },
  ];

  async findById(id: string): Promise<{ id: string; title: string } | null> {
    return this.issues.find((i) => i.id === id) ?? null;
  }

  async findAll(): Promise<Array<{ id: string; title: string }>> {
    return this.issues;
  }
}

class SimpleEventBus implements IEventBus {
  emit(event: string, data: unknown): void {
    console.log(`[EventBus] ${event}:`, data);
  }
}

// ============================================================================
// SECTION 3: The Bridge - createRuntime from Awilix container
// ============================================================================

/**
 * Registry mapping Awilix cradle keys to effect-ts Context.Tags.
 *
 * This is the ONLY place where the mapping is defined.
 * Each entry maps: cradleKey -> Context.Tag
 *
 * TYPE SAFETY NOTE: We lose the compile-time R-channel tracking here.
 * The official effect-ts approach uses Layers for compile-time DI validation.
 * Since we're using Awilix instead, the R channel becomes runtime-checked.
 * This is the fundamental tradeoff of keeping Awilix.
 */
type TagEntry = { readonly tag: Context.Tag<unknown, unknown>; readonly key: string };

const TAG_REGISTRY: readonly TagEntry[] = [
  { tag: IssueRepo as Context.Tag<unknown, unknown>, key: "issueRepository" },
  { tag: EventBusTag as Context.Tag<unknown, unknown>, key: "eventBus" },
] as const;

/**
 * Creates an effect-ts Runtime from an Awilix container.
 *
 * This replaces our custom createRuntime() from effect-runtime.ts.
 * It builds an effect-ts Context from the Awilix cradle, then wraps it in a Runtime.
 */
function createRuntimeFromAwilix(container: AwilixContainer): Runtime.Runtime<never> {
  const cradle = container.cradle as Record<string, unknown>;

  // Start from the default runtime and add services from Awilix cradle
  let runtime = Runtime.defaultRuntime as Runtime.Runtime<never>;
  for (const entry of TAG_REGISTRY) {
    const value = cradle[entry.key];
    if (value !== undefined) {
      runtime = Runtime.provideService(runtime, entry.tag, value) as Runtime.Runtime<never>;
    }
  }

  return runtime;
}

// ============================================================================
// SECTION 4: Write an operation using effect-ts Effect.gen
// ============================================================================

/**
 * Example operation: close an issue
 * Uses yield* to resolve services from the R channel, just like our current code.
 */
function closeIssue(issueId: string) {
  return Effect.gen(function* () {
    // Yield service tags - same pattern as current codebase
    const repo = yield* IssueRepo;
    const eventBus = yield* EventBusTag;

    // Use the services
    const issue = yield* Effect.promise(() => repo.findById(issueId));
    if (!issue) {
      return yield* Effect.fail(new Error(`Issue not found: ${issueId}`));
    }

    eventBus.emit("issue:closed", { id: issue.id, title: issue.title });
    return { closed: true, issue };
  });
}

/**
 * Example operation that composes multiple effects
 */
function listAndCountIssues() {
  return Effect.gen(function* () {
    const repo = yield* IssueRepo;
    const issues = yield* Effect.promise(() => repo.findAll());
    return { count: issues.length, issues };
  });
}

// ============================================================================
// SECTION 5: Alternative approach - provideService (no registry needed)
// ============================================================================

/**
 * Alternative: Instead of building a runtime from a registry,
 * use Effect.provideService to inject one service at a time.
 *
 * This avoids the TAG_REGISTRY entirely, but requires explicit wiring per-service.
 */
function createProviderFromAwilix(container: AwilixContainer) {
  const cradle = container.cradle as Record<string, unknown>;

  return {
    runEffectAndUnwrap: async <A, E>(
      effect: Effect.Effect<A, E, IssueRepo | EventBusTag>
    ): Promise<A> => {
      const provided = effect.pipe(
        Effect.provideService(IssueRepo, cradle["issueRepository"] as IIssueRepository),
        Effect.provideService(EventBusTag, cradle["eventBus"] as IEventBus)
      );
      return Effect.runPromise(provided);
    },
  };
}

// ============================================================================
// SECTION 6: Run the prototype
// ============================================================================

async function main() {
  console.log("=== SPIKE: effect-ts + Awilix Bridge ===\n");

  // 1. Create Awilix container (same as current codebase)
  const container = createContainer();
  container.register({
    issueRepository: asClass(InMemoryIssueRepository).singleton(),
    eventBus: asClass(SimpleEventBus).singleton(),
  } as Record<string, Resolver<unknown>>);

  // 2. Approach A: Runtime from registry
  console.log("--- Approach A: Runtime from TAG_REGISTRY ---");
  const runtime = createRuntimeFromAwilix(container);
  const runPromise = Runtime.runPromise(runtime);

  // The `as never` cast on the effect's R channel is needed because the runtime
  // is typed as Runtime<never> (we lose type info when building from registry).
  // This mirrors the existing `container as AwilixContainer<never>` cast in our current bridge.
  const closeResult = await runPromise(
    closeIssue("1") as unknown as Effect.Effect<unknown, unknown, never>
  );
  console.log("Close result:", closeResult);

  const listResult = await runPromise(
    listAndCountIssues() as unknown as Effect.Effect<unknown, unknown, never>
  );
  console.log("List result:", listResult);

  // 3. Approach B: provideService
  console.log("\n--- Approach B: Effect.provideService ---");
  const provider = createProviderFromAwilix(container);
  const closeResult2 = await provider.runEffectAndUnwrap(closeIssue("2"));
  console.log("Close result:", closeResult2);

  // 4. Error handling test
  console.log("\n--- Error handling test ---");
  try {
    await provider.runEffectAndUnwrap(closeIssue("999"));
  } catch (e) {
    console.log("Caught error:", (e as Error).message);
  }

  console.log("\n=== SPIKE COMPLETE ===");
}

main().catch(console.error);
