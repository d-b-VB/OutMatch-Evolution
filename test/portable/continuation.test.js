import assert from "node:assert/strict";
import test from "node:test";
import { R29_POPULATIONS } from "../../src/baseline/checkpoint.js";
import { generationFingerprint } from "../../src/evolution/generation.js";
import { SplitMix64 } from "../../src/evolution/prng.js";
import {
  continueImportedGeneration,
  prepareImportedContinuation
} from "../../src/portable/continuation.js";
import { createOmgenImportPlan } from "../../src/portable/import.js";
import { PERSISTENCE_SCHEMAS } from "../../src/persistence/schema.js";

function importedRecords() {
  const population = R29_POPULATIONS.map((populationName, index) => ({
    id: `${populationName}-one`, population: populationName, genes: { value: index }
  }));
  const checkpoint = {
    generation: "ReachR30",
    breedingSeed: "100",
    nextRecruitingPopulation: "horse_hunters",
    engineRulesVersion: "reach-v1",
    fitnessFormulaVersion: "fitness-v1",
    breedingPrngVersion: "splitmix64-v1",
    population,
    provenance: Object.fromEntries(population.map(genome => [genome.id, { origin: "test" }]))
  };
  checkpoint.fingerprint = generationFingerprint(checkpoint);
  const ledger = {
    schema: PERSISTENCE_SCHEMAS.ledger, runId: "source", generation: "ReachR30",
    ledgerId: "ledger", rows: []
  };
  const generation = {
    schema: PERSISTENCE_SCHEMAS.generation, runId: "source", generation: "ReachR30",
    parentGeneration: "ReachR29", completedAt: "2026-01-03T00:00:00.000Z",
    fingerprint: checkpoint.fingerprint, ledgerRef: "ledger", checkpoint,
    rankings: population.map((genome, index) => ({ id: genome.id, rank: index + 1 })),
    interventions: [], manifest: {}, controls: {}, migration: {}, breeding: {}, reports: {}
  };
  const manifest = {
    createdAt: "2026-01-04T00:00:00.000Z",
    generation: { runId: "source", generation: "ReachR30", fingerprint: checkpoint.fingerprint }
  };
  return { manifest, generation, ledger };
}

const preparation = {
  controlsHash: "controls-hash", interventionsHash: "interventions-hash",
  rosterSize: 1, locusCount: 1, updatedAt: "2026-01-05T00:00:00.000Z"
};

test("imported completed generations produce deterministic continuation inputs", () => {
  const plan = createOmgenImportPlan(importedRecords(), { targetRunId: "imported" });
  const prepared = prepareImportedContinuation(plan, preparation);
  assert.equal(prepared.childMetadata.generation, "ReachR31");
  assert.equal(prepared.childMetadata.breedingSeed, "101");
  assert.equal(prepared.parentGenomes.size, 7);
  assert.equal(prepared.progress.runId, "imported");
  assert.equal(prepared.progress.parentFingerprint, plan.generation.fingerprint);
  assert.equal(prepared.progress.targetGeneration, "ReachR31");
  assert.equal(prepared.progress.phase, "initialized");
});

test("continuation rejects altered fingerprints and malformed populations", () => {
  const plan = createOmgenImportPlan(importedRecords());
  assert.throws(() => prepareImportedContinuation({
    ...plan, generation: { ...plan.generation, fingerprint: "changed" }
  }, preparation), /fingerprint/);
  const malformed = structuredClone(plan);
  malformed.generation.checkpoint.population.pop();
  assert.throws(() => prepareImportedContinuation(malformed, preparation), /population size/);
});

test("renamed imports continue identically to the original completed record", async () => {
  const records = importedRecords();
  const original = prepareImportedContinuation(createOmgenImportPlan(records), preparation);
  const imported = prepareImportedContinuation(createOmgenImportPlan(records, { targetRunId: "imported" }), preparation);
  const evolve = ({ parentMetadata, parentGenomes }) => {
    const random = new SplitMix64((BigInt(parentMetadata.breedingSeed) + 1n).toString());
    return generationFingerprint({
      generation: "ReachR31",
      sample: random.nextUint64().toString(),
      ids: [...parentGenomes.keys()]
    });
  };
  assert.equal(await continueImportedGeneration(original, evolve), await continueImportedGeneration(imported, evolve));
});

test("continuation receives clones and cannot mutate imported records", async () => {
  const plan = createOmgenImportPlan(importedRecords());
  const prepared = prepareImportedContinuation(plan, preparation);
  await continueImportedGeneration(prepared, ({ parentMetadata, parentGenomes, rankings, progress }) => {
    parentMetadata.population[0].id = "changed";
    parentGenomes.clear();
    rankings.length = 0;
    progress.phase = "changed";
  });
  assert.notEqual(prepared.checkpoint.population[0].id, "changed");
  assert.equal(prepared.parentGenomes.size, 7);
  assert.equal(prepared.rankings.length, 7);
  assert.equal(prepared.progress.phase, "initialized");
});

test("continuation requires an explicit evolution function", async () => {
  const prepared = prepareImportedContinuation(createOmgenImportPlan(importedRecords()), preparation);
  await assert.rejects(continueImportedGeneration(prepared, null), /requires an evolution function/);
});
