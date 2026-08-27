import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMigrationToResidentPools,
  determineMigrantEligibility,
  evaluateHypotheticalDestination,
  selectMigrants,
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
