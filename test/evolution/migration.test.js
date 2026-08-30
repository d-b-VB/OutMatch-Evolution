import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMigrationToResidentPools,
  determineMigrantEligibility,
  evaluateHypotheticalDestination,
  selectMigrants,
  planManualPopulationInterventions,
  planAutomaticMigration,
  sortMigrationCandidates,
  validateMigrationResidentPools
} from "../../src/evolution/migration.js";
import { R29_POPULATIONS } from "../../src/baseline/checkpoint.js";

function game(redId, blueId) {
  return {
    redId, blueId, outcome: "draw", winner: "", round: 20,
    redP: 1, redA: 1, redC: 1, blueP: 1, blueA: 1, blueC: 1,
    redKillByP: 1, redKillByA: 1, redKillByC: 1, blueKillByP: 1, blueKillByA: 1, blueKillByC: 1,
    redVictimP: 1, redVictimA: 1, redVictimC: 1, blueVictimP: 1, blueVictimA: 1, blueVictimC: 1
  };
}

test("outsiders are re-scored and ranked under the destination fitness formula", () => {
  const populations = new Map([["outsider", "generalists"], ["opponent", "pike_lords"]]);
  const result = evaluateHypotheticalDestination({
    id: "outsider", destinationPopulation: "horse_lords", rows: [game("outsider", "opponent")],
    populationByGenome: populations,
    destinationRankings: [{ id: "resident", fitness: 1 }]
  });
  assert.equal(result.currentPopulation, "generalists");
  assert.equal(result.destinationPopulation, "horse_lords");
  assert.equal(result.destinationRank, 2);
  assert.equal(result.hypotheticalFitness, 0);
});

test("migration eligibility requires a top-24 destination rank and strict improvement", () => {
  const rankings = { generalists: [{ id: "candidate", rank: 30 }] };
  const eligible = determineMigrantEligibility({
    id: "candidate", currentPopulation: "generalists", destinationRank: 20
  }, rankings);
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.rankImprovement, 10);
  assert.equal(determineMigrantEligibility({ ...eligible, destinationRank: 25 }, rankings).rejectionReason, "destination_rank");
  const tiedRankings = { generalists: [{ id: "candidate", rank: 20 }] };
  assert.equal(determineMigrantEligibility({ ...eligible, destinationRank: 20 }, tiedRankings).rejectionReason, "no_rank_improvement");
});

test("migration priority is destination rank, improvement, then stable ID", () => {
  const candidates = [
    { id: "c", destinationRank: 2, rankImprovement: 8 },
    { id: "b", destinationRank: 1, rankImprovement: 4 },
    { id: "a", destinationRank: 2, rankImprovement: 8 },
    { id: "d", destinationRank: 2, rankImprovement: 9 }
  ];
  assert.deepEqual(sortMigrationCandidates(candidates).map(candidate => candidate.id), ["b", "d", "a", "c"]);
});

test("automatic migrant selection honors enable and maximum controls", () => {
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    id: `g${index}`, destinationRank: index + 1, rankImprovement: 10, eligible: index !== 0
  }));
  assert.deepEqual(selectMigrants(candidates).map(candidate => candidate.id), ["g1", "g2", "g3", "g4"]);
  assert.deepEqual(selectMigrants(candidates, { enabled: false }), []);
  assert.deepEqual(selectMigrants(candidates, { maximumMigrants: 2 }).map(candidate => candidate.id), ["g1", "g2"]);
});

test("automatic migration evaluates outsiders only for the recruiting population", () => {
  const rows = [game("outsider", "resident")];
  const populationByGenome = new Map([["outsider", "generalists"], ["resident", "horse_lords"]]);
  const rankings = Object.fromEntries(R29_POPULATIONS.map(population => [population, []]));
  rankings.generalists = [{ id: "outsider", rank: 30, fitness: 0 }];
  rankings.horse_lords = [{ id: "resident", rank: 1, fitness: 0 }];
  const plan = planAutomaticMigration({
    rows, populationByGenome, rankings, destinationPopulation: "horse_lords", maximumMigrants: 1
  });
  assert.equal(plan.destinationPopulation, "horse_lords");
  assert.deepEqual(plan.candidates.map(candidate => candidate.id), ["outsider"]);
  assert.ok(plan.candidates.every(candidate => candidate.destinationPopulation === "horse_lords"));
  assert.deepEqual(planAutomaticMigration({
    rows, populationByGenome, rankings, destinationPopulation: "horse_lords", enabled: false
  }), { destinationPopulation: "horse_lords", candidates: [], selected: [] });
});

test("migration removes outgoing survivors, inserts non-breeding migrants, and preserves pool sizes", () => {
  const rankings = Object.fromEntries(R29_POPULATIONS.map(population => [population,
    Array.from({ length: 5 }, (_, index) => ({ id: `${population}-${index + 1}`, rank: index + 1 }))]));
  const migrant = {
    id: "generalists-1", currentPopulation: "generalists", destinationPopulation: "horse_lords", destinationRank: 1
  };
  const pools = applyMigrationToResidentPools(rankings, [migrant], 3);
  assert.ok(!pools.generalists.some(resident => resident.id === migrant.id));
  assert.deepEqual(pools.generalists.map(resident => resident.id), ["generalists-2", "generalists-3", "generalists-4"]);
  assert.deepEqual(pools.horse_lords.map(resident => resident.id), [migrant.id, "horse_lords-1", "horse_lords-2"]);
  assert.equal(pools.horse_lords[0].breedingEligible, false);
  assert.ok(R29_POPULATIONS.every(population => pools[population].length === 3));
  assert.equal(validateMigrationResidentPools(pools, 3), pools);
  pools.pike_lords[0] = pools.horse_lords[0];
  assert.throws(() => validateMigrationResidentPools(pools, 3), /multiple resident pools/);
});

test("manual moves and copies become audited non-breeding entrants", () => {
  const parentGenomes = new Map([
    ["source", { id: "source", population: "pike_lords" }],
    ["copy-source", { id: "copy-source", population: "generalists" }]
  ]);
  const entrants = planManualPopulationInterventions([
    { type: "manual-move", generalId: "source", from: "pike_lords", to: "horse_lords", note: "move" },
    { type: "copy-entrant", sourceGeneralId: "copy-source", to: "pike_hunters", newId: "copy", newName: "Copy", note: "copy" }
  ], parentGenomes);
  assert.deepEqual(entrants.map(entry => [entry.id, entry.sourceId, entry.origin]), [
    ["source", "source", "manual_migrant"], ["copy", "copy-source", "manual_copy"]
  ]);
  assert.throws(() => planManualPopulationInterventions([
    { type: "copy-entrant", sourceGeneralId: "copy-source", to: "pike_hunters", newId: "source" }
  ], parentGenomes), /Invalid copy entrant/);
});

test("manual copies retain their source while moves leave their source population", () => {
  const rankings = Object.fromEntries(R29_POPULATIONS.map(population => [population,
    Array.from({ length: 4 }, (_, index) => ({ id: `${population}-${index + 1}`, rank: index + 1 }))]));
  const entrants = [
    { id: "pike_lords-1", sourceId: "pike_lords-1", currentPopulation: "pike_lords", destinationPopulation: "generalists", destinationRank: 1, origin: "manual_migrant" },
    { id: "copy", sourceId: "horse_lords-1", currentPopulation: "horse_lords", destinationPopulation: "generalists", destinationRank: 1, origin: "manual_copy", newName: "Copy" }
  ];
  const pools = applyMigrationToResidentPools(rankings, entrants, 3);
  assert.ok(!pools.pike_lords.some(entry => entry.id === "pike_lords-1"));
  assert.ok(pools.horse_lords.some(entry => entry.id === "horse_lords-1"));
  assert.deepEqual(pools.generalists.slice(0, 2).map(entry => [entry.id, entry.origin, entry.sourceId]), [
    ["pike_lords-1", "manual_migrant", "pike_lords-1"], ["copy", "manual_copy", "horse_lords-1"]
  ]);
});

test("replacement uploads evict one resident and retain the audited uploaded genome", () => {
  const rankings = Object.fromEntries(R29_POPULATIONS.map(population => [population,
    Array.from({ length: 4 }, (_, index) => ({ id: `${population}-${index + 1}`, rank: index + 1 }))]));
  const uploadedGenome = { id: "uploaded", name: "Uploaded", population: "horse_lords", genes: { value: 1 } };
  const parentGenomes = new Map([["horse_lords-1", { id: "horse_lords-1", population: "horse_lords" }]]);
  const [entrant] = planManualPopulationInterventions([{
    type: "replacement-upload", replacesGeneralId: "horse_lords-1", to: "horse_lords",
    genome: uploadedGenome, note: "replace"
  }], parentGenomes);
  const pools = applyMigrationToResidentPools(rankings, [entrant], 3);
  assert.ok(!pools.horse_lords.some(entry => entry.id === "horse_lords-1"));
  assert.equal(pools.horse_lords[0].id, "uploaded");
  assert.deepEqual(pools.horse_lords[0].genome, uploadedGenome);
  assert.equal(pools.horse_lords[0].breedingEligible, false);
});
