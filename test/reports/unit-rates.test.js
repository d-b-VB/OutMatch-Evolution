import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { indexR29Population, R29_POPULATIONS } from "../../src/baseline/checkpoint.js";
import { parseR29Ledger } from "../../src/baseline/ledger.js";
import {
  buildGeneralOpponentUnitRates,
  buildIndividualUnitRates,
  buildPopulationUnitRates,
  readGeneralSide
} from "../../src/reports/unit-rates.js";

const row = {
  redId: "red", blueId: "blue",
  redP: 1, redA: 2, redC: 3, blueP: 4, blueA: 5, blueC: 6,
  redPokes: 7, bluePokes: 8,
  redKillByP: 9, redKillByA: 10, redKillByC: 11,
  blueKillByP: 12, blueKillByA: 13, blueKillByC: 14,
  redVictimP: 15, redVictimA: 16, redVictimC: 17,
  blueVictimP: 18, blueVictimA: 19, blueVictimC: 20
};
const populations = new Map([["red", "one"], ["blue", "two"]]);

function assertClose(actual, expected, path = "report") {
  if (typeof expected === "number") {
    assert.ok(Math.abs(actual - expected) < 1e-12, `${path}: ${actual} != ${expected}`);
    return;
  }
  for (const [key, value] of Object.entries(expected)) assertClose(actual[key], value, `${path}.${key}`);
}

test("normalizes either ledger color", () => {
  assert.deepEqual(readGeneralSide(row, "red"), {
    id: "red", opponentId: "blue", pokes: 7,
    trained: { P: 1, A: 2, C: 3 }, kills: { P: 9, A: 10, C: 11 }, victims: { P: 15, A: 16, C: 17 }
  });
  assert.deepEqual(readGeneralSide(row, "blue").trained, { P: 4, A: 5, C: 6 });
  assert.throws(() => readGeneralSide(row, "green"), /Unknown ledger color/);
});

test("builds individual and opponent-population rates", () => {
  const individual = buildIndividualUnitRates([row], populations).get("red");
  assert.deepEqual(individual.trainedPerGame, { P: 1, A: 2, C: 3 });
  assert.deepEqual(individual.trainingShare, { P: 1 / 6, A: 2 / 6, C: 3 / 6 });
  const versus = buildGeneralOpponentUnitRates([row], populations).get("red\0two");
  assert.equal(versus.games, 1);
  assert.equal(versus.opponentPopulation, "two");
});

test("distinguishes game-weighted from equal-general population rates", () => {
  const second = { ...row, redId: "other", redP: 10, redA: 0, redC: 0 };
  const index = new Map([...populations, ["other", "one"]]);
  const report = buildPopulationUnitRates([row, row, second], index, ["one", "two"]);
  assert.equal(report.gameWeighted.one.trainedPerGame.P, 4);
  assert.equal(report.equalGeneral.one.trainedPerGame.P, 5.5);
  assert.equal(report.equalGeneral.one.generals, 2);
});

test("reproduces all R29 individual and population unit-rate fixtures", () => {
  const archive = "OutMatch_Reach_Codex_Bootstrap.zip";
  const extract = path => execFileSync("unzip", ["-p", archive, `OutMatch_Reach_Codex_Bootstrap/${path}`], { encoding: "utf8", maxBuffer: 20_000_000 });
  const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
  const { populationByGenome } = indexR29Population(checkpoint);
  const rows = parseR29Ledger(extract("seed/r29/Reach_R29_Full_Staged_Ledger.csv"));
  const expectedPopulation = JSON.parse(extract("fixtures/r29_population_unit_rates_expected.json"));
  const actualPopulation = buildPopulationUnitRates(rows, populationByGenome, R29_POPULATIONS);
  assertClose(actualPopulation, {
    gameWeighted: expectedPopulation.gameWeighted,
    equalGeneral: expectedPopulation.equalGeneral
  });

  const individualCsv = extract("fixtures/r29_individual_unit_rates_expected.csv").trim().split(/\r?\n/);
  const headers = individualCsv.shift().split(",");
  const expectedIndividuals = individualCsv.map(line => Object.fromEntries(line.split(",").map((value, index) => [
    headers[index], ["id", "population"].includes(headers[index]) ? value : Number(value)
  ])));
  const actualIndividuals = buildIndividualUnitRates(rows, populationByGenome);
  assert.equal(expectedIndividuals.length, 343);
  for (const expected of expectedIndividuals) {
    const actual = actualIndividuals.get(expected.id);
    assert.ok(actual, `missing ${expected.id}`);
    assert.equal(actual.games, expected.games);
    assertClose(actual.pokesPerGame, expected.pokesPerGame, `${expected.id}.pokesPerGame`);
    for (const unit of ["P", "A", "C"]) {
      assertClose(actual.trainedPerGame[unit], expected[`train${unit}PerGame`], `${expected.id}.train${unit}`);
      assertClose(actual.trainingShare[unit], expected[`trainShare${unit}`], `${expected.id}.trainShare${unit}`);
      assertClose(actual.killsPerGame[unit], expected[`kill${unit}PerGame`], `${expected.id}.kill${unit}`);
      assertClose(actual.killShare[unit], expected[`killShare${unit}`], `${expected.id}.killShare${unit}`);
      assertClose(actual.victimsPerGame[unit], expected[`victim${unit}PerGame`], `${expected.id}.victim${unit}`);
    }
  }
});
