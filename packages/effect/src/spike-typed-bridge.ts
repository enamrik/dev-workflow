/**
 * SPIKE: Type-safe Awilix → effect-ts bridge
 *
 * Demonstrates how to create a Runtime whose R type matches the Awilix Cradle,
 * so TypeScript enforces that the container provides all services an Effect needs.
 *
 * Run with: npx tsx packages/effect/src/spike-typed-bridge.ts
 */

import { Context, Effect, Runtime } from "effect";
import { createContainer, asClass, type AwilixContainer, type Resolver } from "awilix";

// ============================================================================
// STEP 1: Define service interfaces and tags
// ============================================================================

interface IIssueRepository {
  findById(id: string): Promise<{ id: string; title: string } | null>;
}

interface IEventBus {
  emit(event: string, data: unknown): void;
}

// Tags — ID string matches Awilix cradle key
class IssueRepoTag extends Context.Tag("issueRepository")<IssueRepoTag, IIssueRepository>() {}
class EventBusTag extends Context.Tag("eventBus")<EventBusTag, IEventBus>() {}

// ============================================================================
// STEP 2: Define the Cradle interface (Awilix knows about this)
// ============================================================================

interface AppCradle {
  issueRepository: IIssueRepository;
  eventBus: IEventBus;
}

// ============================================================================
// STEP 3: The type-safe bridge
//
// Key insight: Context.add returns Context<ExistingServices | NewService>.
// By chaining Context.add calls (not looping), TypeScript accumulates the full
// union type. The resulting Context is typed as Context<AllTags>.
//
// The Runtime created from this Context is then Runtime<AllTags>.
// When you run an Effect<A, E, R> against this Runtime, TypeScript verifies
// that R ⊆ AllTags at compile time.
// ============================================================================

// Union of all service tags — this is what the Runtime provides
type AppServices = IssueRepoTag | EventBusTag;

/**
 * Builds a typed effect-ts Context from an Awilix cradle.
 *
 * Each Context.add call is explicit (no loop), so TypeScript tracks the full
 * union type. If you add a new tag here but it's not on AppCradle, TypeScript
 * errors because cradle.newKey doesn't exist. If you forget to add a tag here,
 * any Effect requiring that tag won't compile against the runtime.
 */
function buildContext(cradle: AppCradle): Context.Context<AppServices> {
  return Context.empty().pipe(
    Context.add(IssueRepoTag, cradle.issueRepository),
    Context.add(EventBusTag, cradle.eventBus),
  );
}

/**
 * Creates a typed Runtime from an Awilix container.
 *
 * The return type Runtime<AppServices> means:
 * - Effects requiring any subset of AppServices will compile ✓
 * - Effects requiring a service NOT in AppServices will fail to compile ✗
 */
function createTypedRuntime(container: AwilixContainer<AppCradle>): Runtime.Runtime<AppServices> {
  const ctx = buildContext(container.cradle);
  const defaultRt = Runtime.defaultRuntime;
  return Runtime.make({
    context: ctx,
    runtimeFlags: defaultRt.runtimeFlags,
    fiberRefs: defaultRt.fiberRefs,
  });
}

// ============================================================================
// STEP 4: Operations — same yield* pattern, now with compile-time checks
// ============================================================================

function closeIssue(issueId: string) {
  return Effect.gen(function* () {
    const repo = yield* IssueRepoTag;
    const eventBus = yield* EventBusTag;

    const issue = yield* Effect.promise(() => repo.findById(issueId));
    if (!issue) {
      return yield* Effect.fail(new Error(`Issue not found: ${issueId}`));
    }

    eventBus.emit("issue:closed", { id: issue.id });
    return { closed: true, issue };
  });
}
// Inferred type: Effect<{closed: true, issue: ...}, Error, IssueRepoTag | EventBusTag>
// R = IssueRepoTag | EventBusTag ⊆ AppServices ✓

function listIssues() {
  return Effect.gen(function* () {
    const repo = yield* IssueRepoTag;
    return yield* Effect.promise(() => repo.findById("1"));
  });
}
// Inferred type: Effect<..., never, IssueRepoTag>
// R = IssueRepoTag ⊆ AppServices ✓ (subset is fine)

// ============================================================================
// STEP 5: Demonstrate compile-time safety
// ============================================================================

// An unregistered service — NOT in AppCradle or AppServices
class UnregisteredTag extends Context.Tag("unregistered")<UnregisteredTag, { foo(): string }>() {}

// Used below to demonstrate compile error — void to suppress noUnusedLocals
function _operationUsingUnregisteredService() {
  return Effect.gen(function* () {
    const svc = yield* UnregisteredTag;
    return svc.foo();
  });
}
// Inferred type: Effect<string, never, UnregisteredTag>
// R = UnregisteredTag ⊄ AppServices — will FAIL to compile when run against the runtime!

// ============================================================================
// STEP 6: Run and verify
// ============================================================================

class InMemoryIssueRepo implements IIssueRepository {
  async findById(id: string) {
    return id === "1" ? { id: "1", title: "Test issue" } : null;
  }
}

class SimpleEventBus implements IEventBus {
  emit(event: string, data: unknown) {
    console.log(`[EventBus] ${event}:`, data);
  }
}

async function main() {
  console.log("=== Type-safe Awilix → effect-ts bridge ===\n");

  // Create Awilix container
  const container = createContainer<AppCradle>();
  container.register({
    issueRepository: asClass(InMemoryIssueRepo).singleton(),
    eventBus: asClass(SimpleEventBus).singleton(),
  } as { [K in keyof AppCradle]: Resolver<AppCradle[K]> });

  // Create typed runtime
  const runtime = createTypedRuntime(container);
  const run = Runtime.runPromise(runtime);

  // ✅ This compiles — closeIssue requires IssueRepoTag | EventBusTag ⊆ AppServices
  console.log("--- closeIssue (requires IssueRepoTag | EventBusTag) ---");
  const result = await run(closeIssue("1"));
  console.log("Result:", result);

  // ✅ This compiles — listIssues requires only IssueRepoTag ⊆ AppServices
  console.log("\n--- listIssues (requires only IssueRepoTag) ---");
  const result2 = await run(listIssues());
  console.log("Result:", result2);

  // ❌ This does NOT compile — uncomment to see the error:
  // const result3 = await run(_operationUsingUnregisteredService());
  //
  // Error: Argument of type 'Effect<string, never, UnregisteredTag>'
  //   is not assignable to parameter of type 'Effect<string, never, IssueRepoTag | EventBusTag>'
  //   Type 'UnregisteredTag' is not assignable to type 'IssueRepoTag | EventBusTag'

  console.log("\n--- Compile-time safety verification ---");
  console.log("_operationUsingUnregisteredService() requires UnregisteredTag");
  console.log("Runtime provides: IssueRepoTag | EventBusTag");
  console.log("UnregisteredTag ⊄ AppServices → compile error if uncommented");
  void _operationUsingUnregisteredService; // suppress unused warning

  console.log("\n=== DONE ===");
}

main().catch(console.error);
