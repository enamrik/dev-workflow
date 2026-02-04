/**
 * SPIKE: Performance comparison - Custom Effect vs effect-ts
 *
 * Run with: npx tsx packages/effect/src/spike-benchmark.ts
 */

import { Effect as EffectTs, Context, Runtime } from "effect";
import { Effect as CustomEffect, Service as CustomService, buildContainer } from "./effect.js";
import { createRuntime } from "./effect-runtime.js";
import { asValue } from "awilix";

const ITERATIONS = 10000;

// --- effect-ts setup ---
class EtsSvc extends Context.Tag("svc")<EtsSvc, { val: number }>() {}

const etsRuntime = Runtime.provideService(
  Runtime.defaultRuntime,
  EtsSvc,
  { val: 42 }
) as Runtime.Runtime<never>;
const etsRunPromise = Runtime.runPromise(etsRuntime);

const etsEffect = EffectTs.gen(function* () {
  const s = yield* EtsSvc;
  return s.val + 1;
});

// --- Custom effect setup ---
class CustSvc extends CustomService<{ val: number }>()("svc") {}

const container = buildContainer({ svc: asValue({ val: 42 }) });
const custRuntime = createRuntime(container);

const custEffect = CustomEffect.gen(function* () {
  const s = yield* CustSvc;
  return s.val + 1;
});

async function benchEffectTs(): Promise<number> {
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await etsRunPromise(etsEffect as unknown as EffectTs.Effect<number, never, never>);
  }
  return performance.now() - start;
}

async function benchCustom(): Promise<number> {
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await custRuntime.runEffectAndUnwrap(custEffect);
  }
  return performance.now() - start;
}

async function main() {
  console.log(`Benchmark: ${ITERATIONS} iterations of Effect.gen + yield* + service resolve\n`);

  // Warm up
  await benchEffectTs();
  await benchCustom();

  // Actual benchmark
  const etsTime = await benchEffectTs();
  const custTime = await benchCustom();

  console.log(`Custom effect:  ${custTime.toFixed(1)}ms (${(custTime / ITERATIONS).toFixed(3)}ms/op)`);
  console.log(`effect-ts:      ${etsTime.toFixed(1)}ms (${(etsTime / ITERATIONS).toFixed(3)}ms/op)`);
  console.log(`Ratio:          ${(etsTime / custTime).toFixed(2)}x`);
}

main().catch(console.error);
