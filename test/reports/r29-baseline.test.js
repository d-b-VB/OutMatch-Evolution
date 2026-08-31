import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { indexR29Population, R29_POPULATIONS } from "../../src/baseline/checkpoint.js";
import { parseR29Ledger, summarizeR29Ledger } from "../../src/baseline/ledger.js";
import { buildEliminationMatrix } from "../../src/reports/elimination.js";
import {
  adjustedGameScore,
  buildBaseFitness,
  buildFitnessReport,
  buildSpecializationStats,
  finalFitness,
  rawEliminationScore
} from "../../src/reports/fitness.js";

const archive = "OutMatch_Reach_Codex_Bootstrap.zip";
const extract = path => execFileSync("unzip", ["-p", archive, `OutMatch_Reach_Codex_Bootstrap/${path}`], {
  encoding: "utf8", maxBuffer: 20_000_000
});
const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
const { populationByGenome } = indexR29Population(checkpoint);
const rows = parseR29Ledger(extract("seed/r29/Reach_R29_Full_Staged_Ledger.csv"));

function assertClose(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} != ${expected}`);
}

test("full R29 ledger has the canonical stage totals", () => {
  assert.deepEqual(summarizeR29Ledger(rows), {
    totalGames: 72_556,
    stages: { stage1_core: 43_218, stage2_elite: 28_224, challenger: 1_114 }
  });
});

test("full R29 elimination report reproduces every matrix cell and count", () => {
  const expected = JSON.parse(extract("fixtures/r29_elimination_matrix_expected.json"));
  assert.deepEqual(buildEliminationMatrix(rows, populationByGenome, R29_POPULATIONS), {
    matrix: expected.matrix,
    counts: expected.counts
  });
});

test("raw elimination scoring handles speed, losses, and draws", () => {
  assert.equal(rawEliminationScore("win", 1), 1.5);
  assert.equal(rawEliminationScore("win", 20), 1);
  assert.equal(rawEliminationScore("loss", 1), -0.5);
  assert.equal(rawEliminationScore("draw", 20), 0);
  assert.throws(() => rawEliminationScore("win", 21), /Invalid elimination round/);
});

test("game-level fitness applies target training and Hunter partial credit", () => {
  const win = { outcome: "elimination", winner: "R", round: 10, blueC: 4, redVictimC: 0 };
  assertClose(adjustedGameScore(win, "red", "pike_lords"), rawEliminationScore("win", 10) * 3, "Pike Lord win");
  assertClose(adjustedGameScore(win, "red", "horse_hunters"), rawEliminationScore("win", 10) * 3, "Hunter win");
  const loss = { outcome: "elimination", winner: "B", round: 10, blueC: 3, redVictimC: 1 };
  assertClose(adjustedGameScore(loss, "red", "horse_hunters"), rawEliminationScore("loss", 10) * 0.75, "Hunter loss");
  const draw = { outcome: "draw", winner: "", round: 20, blueC: 3, redVictimC: 1 };
  assertClose(adjustedGameScore(draw, "red", "horse_hunters"), 0.125, "Hunter draw");
});

test("population-normalized base fitness reproduces all 343 R29 generals", () => {
  const expected = JSON.parse(extract("fixtures/r29_fitness_formula_verification.json"));
  const actual = buildBaseFitness(rows, populationByGenome);
  assert.equal(actual.size, 343);
  for (const fixture of expected.rows) assertClose(actual.get(fixture.id), fixture.expectedBase, fixture.id);
});

test("specialization statistics normalize each opponent population equally", () => {
  const syntheticRows = [
    { redId: "lord", blueId: "one", redP: 0, redA: 0, redC: 9, redKillByP: 0, redKillByA: 0, redKillByC: 3,
      blueP: 0, blueA: 0, blueC: 0, blueKillByP: 0, blueKillByA: 0, blueKillByC: 0 },
    { redId: "lord", blueId: "one", redP: 0, redA: 0, redC: 9, redKillByP: 0, redKillByA: 0, redKillByC: 3,
      blueP: 0, blueA: 0, blueC: 0, blueKillByP: 0, blueKillByA: 0, blueKillByC: 0 },
    { redId: "lord", blueId: "two", redP: 9, redA: 0, redC: 0, redKillByP: 3, redKillByA: 0, redKillByC: 0,
      blueP: 0, blueA: 0, blueC: 0, blueKillByP: 0, blueKillByA: 0, blueKillByC: 0 }
  ];
  const index = new Map([["lord", "horse_lords"], ["one", "one"], ["two", "two"]]);
  const stats = buildSpecializationStats(syntheticRows, index).get("lord");
  assert.equal(stats.opponentPopulations, 2);
  assert.equal(stats.recruitFraction.C, 0.5);
  assert.equal(stats.killShare.C, 0.5);
});

test("Lord multipliers use their population-specific specialization", () => {
  const specialization = { recruitFraction: { P: 0.25, A: 0.5, C: 0.75 }, killShare: { P: 0.16, A: 0.36, C: 0.64 }, pikesPerGame: 4 };
  assertClose(finalFitness(2, "horse_lords", specialization), 1.2, "Horse Lord");
  assertClose(finalFitness(2, "archer_lords", specialization), 0.6, "Archer Lord");
  assertClose(finalFitness(2, "pike_lords", specialization), 1.6, "Pike Lord");
  assert.equal(finalFitness(2, "generalists", specialization), 2);
});

test("Lord multipliers preserve non-positive bases instead of rewarding non-specialization", () => {
  const none = { recruitFraction: { P: 0, A: 0, C: 0 }, killShare: { P: 0, A: 0, C: 0 }, pikesPerGame: 0 };
  const strong = { recruitFraction: { P: 0.8, A: 0.6, C: 0.75 }, killShare: { P: 0.81, A: 0.64, C: 0.49 }, pikesPerGame: 9 };

  assert.equal(finalFitness(-0.1, "pike_lords", none), -0.1);
  assert.equal(finalFitness(-0.1, "pike_lords", strong), -0.1);
  assert.equal(finalFitness(0.1, "pike_lords", none), 0);
  assertClose(finalFitness(0.1, "pike_lords", strong), 0.27, "positive Pike Lord");
  assert.equal(finalFitness(-0.1, "horse_lords", none), -0.1);
  assert.equal(finalFitness(-0.1, "horse_lords", strong), -0.1);
  assert.equal(finalFitness(-0.1, "archer_lords", none), -0.1);
  assert.equal(finalFitness(-0.1, "archer_lords", strong), -0.1);
  assert.equal(finalFitness(-0.1, "generalists", none), -0.1);
  assert.equal(finalFitness(-0.1, "horse_hunters", none), -0.1);
  assert.equal(finalFitness(0.1, "generalists", none), 0.1);
  assert.equal(finalFitness(0.1, "horse_hunters", none), 0.1);
});

test("prospective fitness rule evaluates all 343 historical R29 ledger participants", () => {
  const expected = JSON.parse(extract("fixtures/r29_fitness_formula_verification.json"));
  const actual = buildFitnessReport(rows, populationByGenome);
  assert.equal(actual.size, 343);
  let intentionallyChanged = 0;
  for (const fixture of expected.rows) {
    const report = actual.get(fixture.id);
    assertClose(report.base, fixture.expectedBase, `${fixture.id} base`);
    assert.ok(Number.isFinite(report.fitness), `${fixture.id} fitness must be finite`);
    if (Math.abs(report.fitness - fixture.expectedFitness) >= 1e-12) intentionallyChanged += 1;
  }
  assert.ok(intentionallyChanged > 0, "v2 must differ from the historical v1 specialist fixture");
});
