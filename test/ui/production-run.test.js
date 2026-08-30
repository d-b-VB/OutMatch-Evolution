import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { R29_POPULATIONS } from "../../src/baseline/checkpoint.js";
import { prepareProductionGeneration } from "../../src/ui/production-run.js";
import { INTERVENTIONS_SCHEMA } from "../../src/ui/interventions.js";

test("production preparer builds the real child, canonical schedule, and immutable record hooks", async () => {
  const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
  const similarityBaseline = JSON.parse(readFileSync("seed/genetic_similarity_baseline_r29.json", "utf8"));
  const mutationRangeDocument = JSON.parse(readFileSync("seed/mutation_ranges.json", "utf8"));
  const fixture = JSON.parse(execFileSync("unzip", ["-p", "OutMatch_Reach_Codex_Bootstrap.zip",
    "OutMatch_Reach_Codex_Bootstrap/fixtures/r29_fitness_formula_verification.json"], { encoding: "utf8" }));
  const rankings = R29_POPULATIONS.flatMap(population => fixture.rows.filter(row => row.population === population)
    .map((row, index) => ({ ...row, rank: index + 1 })));
  const parent = { generation: "ReachR29", fingerprint: "parent", checkpoint, rankings };
  const controlReview = {
    controls: {
      workerCount: 2, migrationEnabled: false, maximumMigrants: 0,
      wildcardProbability: 0.5, mutationProbability: 0.02
    },
    controlsHash: "controls-hash", interventionsHash: "interventions-hash",
    interventions: { schema: INTERVENTIONS_SCHEMA, parentGeneration: "ReachR29", operations: [] }
  };
  const prepared = prepareProductionGeneration({
    runId: "run-one", parent, controlReview, breedingSeed: "202608231656",
    parentLedger: { rows: [] }, similarityBaseline, mutationRangeDocument,
    now: () => "2026-08-30T00:00:00.000Z"
  });
  assert.equal(prepared.childCandidate.population.length, 343);
  assert.equal(prepared.stage1Schedule.length, 43_218);
  assert.equal(prepared.genomes.length, 343);
  assert.equal(prepared.workerCount, 2);
  assert.deepEqual(prepared.finalizationHooks.buildLedgerRecord({ ledger: [] }), {
    schema: "outmatch-ledger-record-v1", runId: "run-one", generation: "ReachR30",
    ledgerId: "run-one:ReachR30", rows: []
  });
  const rankingObject = Object.fromEntries(R29_POPULATIONS.map(population => [population, [{
    id: prepared.childCandidate.population.find(genome => genome.population === population).id,
    population, rank: 1, fitness: 1
  }]]));
  const generation = prepared.finalizationHooks.buildGenerationRecord({
    rankings: rankingObject, reports: { stored: true }, ledgerRecord: { ledgerId: "run-one:ReachR30" }
  });
  assert.equal(generation.fingerprint, prepared.childCandidate.fingerprint);
  assert.equal(generation.rankings.length, 7);
  assert.deepEqual(generation.reports, { stored: true });
  assert.deepEqual(generation.migration.selected, []);
});

test("production preparer rejects incomplete evolution resources before scheduling", () => {
  const checkpoint = { generation: "ReachR29", seed: "1", nextRecruitingPopulation: "generalists", population: [] };
  assert.throws(() => prepareProductionGeneration({
    runId: "run", parent: { generation: "ReachR29", checkpoint, rankings: [] },
    controlReview: { controls: {}, interventions: {
      schema: INTERVENTIONS_SCHEMA, parentGeneration: "ReachR29", operations: []
    } }, breedingSeed: "wrong",
    parentLedger: { rows: [] }, similarityBaseline: { locusOrder: [] }, mutationRangeDocument: {}
  }), /mutation ranges|resident/i);
});
