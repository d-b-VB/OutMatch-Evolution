import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { runGame as reference } from "../src/engine/board.js";
import { runGame as fast } from "../src/engine/fast-board.js";

const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
const count = Number(process.argv[2] ?? 100);
const depth = Number(process.argv[3] ?? 3);
if (!Number.isSafeInteger(count) || count < 1 || ![1, 2, 3].includes(depth)) throw new Error("Usage: benchmark-fast-board [count] [depth]");
const pairs = Array.from({ length: count }, (_, index) => [
  checkpoint.population[index % checkpoint.population.length],
  checkpoint.population[(index * 37 + 100) % checkpoint.population.length]
]);
const measure = engine => {
  const started = performance.now();
  const outputs = pairs.map(pair => engine(pair[0], pair[1], { depth }));
  return { milliseconds: performance.now() - started, outputs };
};
const referenceRun = measure(reference);
const fastRun = measure(fast);
assert.deepEqual(fastRun.outputs, referenceRun.outputs, "Fast engine diverged from the reference engine");
const referenceMs = referenceRun.milliseconds;
const fastMs = fastRun.milliseconds;
process.stdout.write(`${JSON.stringify({ games: count, depth, referenceMs,
  fastMs, referenceMsPerGame: referenceMs / count, fastMsPerGame: fastMs / count,
  speedup: referenceMs / fastMs }, null, 2)}\n`);
