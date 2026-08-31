import assert from "node:assert/strict";
import test from "node:test";
import { executeResumableSchedule } from "../../src/persistence/executor.js";
import { buildProgressCheckpoint } from "../../src/persistence/resume.js";
import { generationFingerprint } from "../../src/evolution/generation.js";

const COUNT = 10_000;
const BATCH = 256;
const schedule = Array.from({ length: COUNT }, (_, scheduleIndex) => ({
  stage: "stage1_core", scheduleIndex, redId: `red-${scheduleIndex}`, blueId: `blue-${scheduleIndex}`
}));

function checkpoint() {
  return buildProgressCheckpoint({
    runId: "scale", parentGeneration: "ReachR29", parentFingerprint: "fingerprint",
    targetGeneration: "ReachR30", controlsHash: "controls", interventionsHash: "interventions",
    breedingSeed: "1", breedingPrngVersion: "splitmix64-v1", phase: "stage1_running",
    schedule, updatedAt: "2026-08-31T00:00:00.000Z"
  });
}

test("production-scale batching preserves serial order with about forty checkpoints", async () => {
  let batches = 0;
  const checkpoints = [];
  const optimized = await executeResumableSchedule({
    checkpoint: checkpoint(), executeGame: async game => game,
    executeBatch: async games => { batches += 1; return games; }, checkpointInterval: BATCH,
    saveCheckpoint: async value => checkpoints.push(value.cursor)
  });
  assert.equal(batches, Math.ceil(COUNT / BATCH));
  assert.equal(checkpoints.length, Math.ceil(COUNT / BATCH));
  assert.deepEqual(optimized.checkpoint.partialLedger, schedule);
  assert.deepEqual(optimized.checkpoint.partialLedger.map(row => row.scheduleIndex),
    Array.from({ length: COUNT }, (_, index) => index));
});

test("production-scale pause and resume retains the exact serial ledger", async () => {
  let pause = false;
  let durable;
  const first = await executeResumableSchedule({
    checkpoint: checkpoint(), executeGame: async game => game,
    executeBatch: async games => { pause = true; return games; }, checkpointInterval: BATCH,
    shouldPause: () => pause, saveCheckpoint: async value => { durable = value; }
  });
  assert.equal(first.status, "paused");
  const resumed = await executeResumableSchedule({
    checkpoint: durable, executeGame: async game => game, executeBatch: async games => games,
    checkpointInterval: BATCH, saveCheckpoint: async value => { durable = value; }
  });
  assert.deepEqual(resumed.checkpoint.partialLedger, schedule);
});

test("optimized and reference serial semantics produce exactly identical deterministic artifacts", async () => {
  const smaller = { ...checkpoint(), schedule: schedule.slice(0, 17), partialLedger: [], cursor: 0 };
  const run = executeBatch => executeResumableSchedule({
    checkpoint: structuredClone(smaller), executeGame: async game => ({ ...game, outcome: "draw", winner: "" }),
    ...(executeBatch ? { executeBatch: async games => games.map(game => ({ ...game, outcome: "draw", winner: "" })) } : {}),
    checkpointInterval: 4, saveCheckpoint: async () => {}
  });
  const serial = await run(false);
  const optimized = await run(true);
  const artifacts = ledger => {
    const rankings = ledger.map((row, index) => ({ id: row.redId, rank: index + 1 }));
    const reports = { games: ledger.length, draws: ledger.filter(row => row.outcome === "draw").length };
    const migration = { selected: rankings.slice(0, 1) };
    const breeding = { seed: "deterministic", parents: rankings.slice(0, 2) };
    const childPopulation = rankings.map(record => ({ id: `child-${record.rank}`, parent: record.id }));
    return { ledger, rankings, reports, migration, breeding, childPopulation,
      childFingerprint: generationFingerprint({ childPopulation, migration, breeding }) };
  };
  assert.deepEqual(artifacts(optimized.checkpoint.partialLedger), artifacts(serial.checkpoint.partialLedger));
});
