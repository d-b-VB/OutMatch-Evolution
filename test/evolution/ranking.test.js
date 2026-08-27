import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { indexR29Population } from "../../src/baseline/checkpoint.js";
import { parseR29Ledger } from "../../src/baseline/ledger.js";
import {
  buildExposureReport,
  isFullyEvaluated,
  rankLedger,
  rankPopulations,
  selectTentativeElites
} from "../../src/evolution/ranking.js";
import { buildPopulationRosters } from "../../src/evolution/schedule.js";

const archive = "OutMatch_Reach_Codex_Bootstrap.zip";
const extract = path => execFileSync("unzip", ["-p", archive, `OutMatch_Reach_Codex_Bootstrap/${path}`], {
  encoding: "utf8", maxBuffer: 20_000_000
});

test("population ranking sorts fitness descending and breaks ties by genome ID", () => {
  const records = [
    { id: "b", population: "generalists", fitness: 2 },
    { id: "c", population: "generalists", fitness: 3 },
    { id: "a", population: "generalists", fitness: 2 }
  ];
  assert.deepEqual(rankPopulations(records).generalists.map(({ id, rank }) => ({ id, rank })), [
    { id: "c", rank: 1 }, { id: "a", rank: 2 }, { id: "b", rank: 3 }
  ]);
  assert.throws(() => rankPopulations([{ id: "x", population: "generalists", fitness: NaN }]), /Non-finite/);
});

test("partial-ledger ranking remains deterministic with unequal game exposure", () => {
  const makeRow = (redId, blueId, winner) => ({
    redId, blueId, outcome: "elimination", winner, round: 20,
    redP: 1, redA: 1, redC: 1, blueP: 1, blueA: 1, blueC: 1,
    redKillByP: 1, redKillByA: 1, redKillByC: 1, blueKillByP: 1, blueKillByA: 1, blueKillByC: 1,
    redVictimP: 1, redVictimA: 1, redVictimC: 1, blueVictimP: 1, blueVictimA: 1, blueVictimC: 1
  });
  const populations = new Map([["a", "generalists"], ["b", "generalists"], ["x", "horse_hunters"]]);
  const rankings = rankLedger([makeRow("a", "x", "R"), makeRow("x", "a", "B"), makeRow("b", "x", "B")], populations);
  assert.deepEqual(rankings.generalists.map(record => record.id), ["a", "b"]);
});

test("Stage 1 ranking reproduces all 84 tentative R29 specialist elites", () => {
  const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
  const { populationByGenome } = indexR29Population(checkpoint);
  const stage1Rows = parseR29Ledger(extract("seed/r29/Reach_R29_Full_Staged_Ledger.csv"))
    .filter(row => row.stage === "stage1_core");
  const rankings = rankLedger(stage1Rows, populationByGenome, checkpoint.populationOrder);
  const elites = selectTentativeElites(rankings);
  const expected = JSON.parse(extract("fixtures/r29_tournament_schedule_expected.json"));
  for (const population of checkpoint.populationOrder) {
    assert.deepEqual(new Set(elites[population]), new Set(expected.tentativeStage1Top14[population]));
  }
  assert.equal(Object.values(elites).flat().length, 84);
});

test("exposure tracking requires both colors against every opposing genome", () => {
  const genomes = ["one", "two", "generalists"].flatMap(population => [1, 2].map(number => ({
    id: `${population}-${number}`, population
  })));
  const populations = new Map(genomes.map(genome => [genome.id, genome.population]));
  const rosters = new Map(["one", "two", "generalists"].map(population => [
    population, genomes.filter(genome => genome.population === population).map(genome => genome.id)
  ]));
  const generalId = "one-1";
  const rows = [...rosters.entries()].filter(([population]) => population !== "one").flatMap(([, ids]) =>
    ids.flatMap(id => [{ redId: generalId, blueId: id }, { redId: id, blueId: generalId }]));
  const complete = buildExposureReport(rows, generalId, populations, rosters);
  assert.equal(complete.games, 8);
  assert.ok(Object.values(complete.populations).every(population => population.complete));
  const missingColor = buildExposureReport(rows.slice(1), generalId, populations, rosters);
  assert.equal(missingColor.populations.two.completedOpponents, 1);
  assert.equal(missingColor.populations.two.complete, false);
});

test("full-evaluation detection requires all six opposing populations for specialists", () => {
  const complete = { population: "horse_lords", populations: Object.fromEntries(
    ["a", "b", "c", "d", "e", "f"].map(population => [population, { complete: true }])
  ) };
  assert.equal(isFullyEvaluated(complete), true);
  complete.populations.a.complete = false;
  assert.equal(isFullyEvaluated(complete), false);
  assert.equal(isFullyEvaluated({ population: "generalists", populations: {} }), true);
});
