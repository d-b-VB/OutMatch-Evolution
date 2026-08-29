import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { indexR29Population, R29_POPULATIONS } from "../../src/baseline/checkpoint.js";
import { parseR29Ledger } from "../../src/baseline/ledger.js";
import { buildExposureReport, isFullyEvaluated, rankLedger, selectTentativeElites } from "../../src/evolution/ranking.js";
import {
  buildPopulationRosters,
  buildStage1Schedule,
  buildStage2Schedule,
  coloredGameKey,
  createScheduledGame,
  deduplicateSchedule,
  GENERALIST_POPULATION,
  pairingKey,
  RIVAL_POPULATION,
  scheduleAllRivalPairs,
  scheduleAllSpecialistsVsGeneralists,
  scheduleElitePopulationPair,
  scheduleEliteSide,
  scheduleRivalPair,
  scheduleSpecialistVsGeneralists,
  SPECIALIST_POPULATIONS,
  twoColorMatchups,
  unrelatedPopulationPairs,
  UNRELATED_SPECIALISTS,
  validatePopulationRelationships
} from "../../src/evolution/schedule.js";

test("canonical tournament relationships contain six symmetric specialist rivals", () => {
  const relationships = validatePopulationRelationships();
  assert.equal(relationships.generalist, GENERALIST_POPULATION);
  assert.equal(SPECIALIST_POPULATIONS.length, 6);
  assert.equal(new Set(Object.values(RIVAL_POPULATION)).size, 6);
  for (const population of SPECIALIST_POPULATIONS) {
    assert.equal(RIVAL_POPULATION[RIVAL_POPULATION[population]], population);
    assert.equal(UNRELATED_SPECIALISTS[population].length, 4);
    assert.ok(!UNRELATED_SPECIALISTS[population].includes(RIVAL_POPULATION[population]));
    for (const unrelated of UNRELATED_SPECIALISTS[population]) {
      assert.ok(UNRELATED_SPECIALISTS[unrelated].includes(population));
    }
  }
  assert.throws(() => validatePopulationRelationships(R29_POPULATIONS.slice(0, -1)), /seven canonical/);
  assert.throws(() => validatePopulationRelationships([...R29_POPULATIONS.slice(0, -1), R29_POPULATIONS[0]]), /duplicates/);
});

test("pair keys ignore color while colored game keys preserve it", () => {
  assert.equal(pairingKey("alpha", "beta"), pairingKey("beta", "alpha"));
  assert.notEqual(coloredGameKey("alpha", "beta"), coloredGameKey("beta", "alpha"));
  assert.throws(() => pairingKey("alpha", "alpha"), /with itself/);
  assert.throws(() => pairingKey("", "beta"), /non-empty string/);
});

test("two-color matchups have stable consecutive schedule indexes", () => {
  assert.deepEqual(twoColorMatchups("alpha", "beta", { stage: "stage1_core", startIndex: 12 }), [
    { stage: "stage1_core", scheduleIndex: 12, redId: "alpha", blueId: "beta", challengerIteration: null },
    { stage: "stage1_core", scheduleIndex: 13, redId: "beta", blueId: "alpha", challengerIteration: null }
  ]);
});

test("schedule deduplication retains the first occurrence without merging colors", () => {
  const games = [
    ...twoColorMatchups("alpha", "beta", { stage: "stage1_core" }),
    createScheduledGame({ stage: "stage2_elite", scheduleIndex: 2, redId: "alpha", blueId: "beta" })
  ];
  const unique = deduplicateSchedule(games);
  assert.equal(unique.length, 2);
  assert.deepEqual(unique.map(game => game.scheduleIndex), [0, 1]);
  assert.throws(() => deduplicateSchedule([games[0], { ...games[1], scheduleIndex: 0 }]), /Duplicate tournament schedule index/);
});

test("scheduled-game records validate stages, indexes, colors, and challenger iterations", () => {
  assert.deepEqual(createScheduledGame({
    stage: "challenger", scheduleIndex: 4, redId: "alpha", blueId: "beta", challengerIteration: 2
  }), {
    stage: "challenger", scheduleIndex: 4, redId: "alpha", blueId: "beta", challengerIteration: 2
  });
  assert.throws(() => createScheduledGame({ stage: "unknown", scheduleIndex: 0, redId: "a", blueId: "b" }), /Unknown tournament stage/);
  assert.throws(() => createScheduledGame({ stage: "stage1_core", scheduleIndex: -1, redId: "a", blueId: "b" }), /schedule index/);
  assert.throws(() => createScheduledGame({ stage: "challenger", scheduleIndex: 0, redId: "a", blueId: "b" }), /positive challenger iteration/);
  assert.throws(() => createScheduledGame({ stage: "stage2_elite", scheduleIndex: 0, redId: "a", blueId: "b", challengerIteration: 1 }), /cannot have/);
});

const syntheticGenomes = R29_POPULATIONS.flatMap(population => [1, 2].map(number => ({
  id: `${population}-${number}`,
  population
})));

test("one specialist-to-Generalist and one rival pair schedule both colors", () => {
  const rosters = buildPopulationRosters(syntheticGenomes);
  const generalistGames = scheduleSpecialistVsGeneralists("horse_lords", rosters);
  const rivalGames = scheduleRivalPair("horse_lords", rosters);
  assert.equal(generalistGames.length, 8);
  assert.equal(rivalGames.length, 8);
  assert.equal(new Set(generalistGames.map(game => pairingKey(game.redId, game.blueId))).size, 4);
  assert.throws(() => scheduleSpecialistVsGeneralists("generalists", rosters), /Not a specialist/);
  assert.throws(() => scheduleRivalPair("horse_hunters", rosters), /Not a Lord/);
});

test("all specialist-to-Generalist and rival schedules have stable indexes", () => {
  const rosters = buildPopulationRosters(syntheticGenomes);
  const generalistGames = scheduleAllSpecialistsVsGeneralists(rosters, 10);
  const rivalGames = scheduleAllRivalPairs(rosters, 10 + generalistGames.length);
  assert.equal(generalistGames.length, 48);
  assert.equal(rivalGames.length, 24);
  assert.deepEqual([...generalistGames, ...rivalGames].map(game => game.scheduleIndex),
    Array.from({ length: 72 }, (_, index) => index + 10));
});

test("complete R29 Stage 1 schedule reproduces all 43,218 canonical colored games", () => {
  const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
  const schedule = buildStage1Schedule(checkpoint.population, checkpoint.populationOrder);
  assert.equal(schedule.length, 43_218);
  assert.deepEqual(schedule.map(game => game.scheduleIndex), Array.from({ length: 43_218 }, (_, index) => index));

  const ledgerCsv = execFileSync("unzip", ["-p", "OutMatch_Reach_Codex_Bootstrap.zip",
    "OutMatch_Reach_Codex_Bootstrap/seed/r29/Reach_R29_Full_Staged_Ledger.csv"], {
    encoding: "utf8", maxBuffer: 20_000_000
  });
  const expectedKeys = parseR29Ledger(ledgerCsv)
    .filter(row => row.stage === "stage1_core")
    .map(row => coloredGameKey(row.redId, row.blueId));
  assert.equal(new Set(expectedKeys).size, 43_218);
  assert.deepEqual(new Set(schedule.map(game => coloredGameKey(game.redId, game.blueId))), new Set(expectedKeys));
});

test("unrelated specialist relationships produce 12 unique population pairs", () => {
  const pairs = unrelatedPopulationPairs();
  assert.equal(pairs.length, 12);
  assert.equal(new Set(pairs.map(pair => JSON.stringify([...pair].sort()))).size, 12);
  for (const [first, second] of pairs) {
    assert.notEqual(first, second);
    assert.notEqual(RIVAL_POPULATION[first], second);
  }
});

test("reciprocal elite exposure deduplicates elite-versus-elite games", () => {
  const firstRoster = ["a1", "a2", "a3"];
  const secondRoster = ["b1", "b2", "b3"];
  assert.equal(scheduleEliteSide(firstRoster.slice(0, 1), secondRoster).length, 6);
  const games = scheduleElitePopulationPair(firstRoster.slice(0, 1), firstRoster, secondRoster.slice(0, 1), secondRoster);
  assert.equal(games.length, 10);
  assert.equal(new Set(games.map(game => coloredGameKey(game.redId, game.blueId))).size, 10);
});

test("complete R29 Stage 2 schedule reproduces all 28,224 canonical colored games and elite exposure", () => {
  const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
  const { populationByGenome } = indexR29Population(checkpoint);
  const rosters = buildPopulationRosters(checkpoint.population, checkpoint.populationOrder);
  const ledgerRows = parseR29Ledger(execFileSync("unzip", ["-p", "OutMatch_Reach_Codex_Bootstrap.zip",
    "OutMatch_Reach_Codex_Bootstrap/seed/r29/Reach_R29_Full_Staged_Ledger.csv"], {
    encoding: "utf8", maxBuffer: 20_000_000
  }));
  const stage1Rows = ledgerRows.filter(row => row.stage === "stage1_core");
  const elites = selectTentativeElites(rankLedger(stage1Rows, populationByGenome, checkpoint.populationOrder));
  const stage2 = buildStage2Schedule(elites, rosters);
  assert.equal(stage2.length, 28_224);
  assert.deepEqual(stage2.map(game => game.scheduleIndex), Array.from({ length: 28_224 }, (_, index) => index));

  const expectedKeys = ledgerRows.filter(row => row.stage === "stage2_elite")
    .map(row => coloredGameKey(row.redId, row.blueId));
  assert.deepEqual(new Set(stage2.map(game => coloredGameKey(game.redId, game.blueId))), new Set(expectedKeys));

  const combined = [...buildStage1Schedule(checkpoint.population, checkpoint.populationOrder), ...stage2];
  for (const ids of Object.values(elites)) {
    for (const id of ids) {
      const exposure = buildExposureReport(combined, id, populationByGenome, rosters);
      assert.equal(exposure.games, 588);
      assert.equal(isFullyEvaluated(exposure), true);
    }
  }
  for (const population of SPECIALIST_POPULATIONS) {
    for (const id of rosters.get(population).filter(id => !elites[population].includes(id))) {
      assert.equal(buildExposureReport(combined, id, populationByGenome, rosters).games, 308);
    }
  }
});
