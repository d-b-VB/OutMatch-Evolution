import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { indexR29Population } from "../../src/baseline/checkpoint.js";
import { parseR29Ledger } from "../../src/baseline/ledger.js";
import { assertR29TournamentAudit, auditTournamentSchedule } from "../../src/evolution/audit.js";
import {
  buildChallengerSchedule,
  identifyChallengers,
  runChallengerCleanup,
  scheduleChallengerMissingGames
} from "../../src/evolution/challengers.js";
import { rankLedger, selectTentativeElites } from "../../src/evolution/ranking.js";
import {
  buildPopulationRosters,
  buildStage1Schedule,
  buildStage2Schedule,
  coloredGameKey
} from "../../src/evolution/schedule.js";

const archive = "OutMatch_Reach_Codex_Bootstrap.zip";
const extract = path => execFileSync("unzip", ["-p", archive, `OutMatch_Reach_Codex_Bootstrap/${path}`], {
  encoding: "utf8", maxBuffer: 20_000_000
});

test("one challenger schedules only its missing color assignments", () => {
  const rosters = new Map([
    ["horse_lords", ["challenger"]],
    ["pike_lords", ["opponent"]]
  ]);
  const populations = new Map([["challenger", "horse_lords"], ["opponent", "pike_lords"]]);
  const games = scheduleChallengerMissingGames("challenger", [
    { redId: "challenger", blueId: "opponent" }
  ], populations, rosters, { iteration: 2, startIndex: 8 });
  assert.deepEqual(games, [{
    stage: "challenger", scheduleIndex: 8, redId: "opponent", blueId: "challenger", challengerIteration: 2
  }]);
});

test("overlapping challenger requests emit each colored game once", () => {
  const rosters = new Map([
    ["horse_lords", ["first"]],
    ["pike_lords", ["second"]]
  ]);
  const populations = new Map([["first", "horse_lords"], ["second", "pike_lords"]]);
  const games = buildChallengerSchedule([{ id: "first" }, { id: "second" }], [], populations, rosters);
  assert.equal(games.length, 2);
  assert.deepEqual(games.map(game => game.scheduleIndex), [0, 1]);
});

test("R29 challenger cleanup reranks, identifies four challengers, and reproduces 1,114 games", async () => {
  const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
  const { populationByGenome } = indexR29Population(checkpoint);
  const rosters = buildPopulationRosters(checkpoint.population, checkpoint.populationOrder);
  const allRows = parseR29Ledger(extract("seed/r29/Reach_R29_Full_Staged_Ledger.csv"));
  const completed = allRows.filter(row => row.stage !== "challenger");
  const expectedRows = allRows.filter(row => row.stage === "challenger");
  const expectedByKey = new Map(expectedRows.map(row => [coloredGameKey(row.redId, row.blueId), row]));

  const postStage2 = rankLedger(completed, populationByGenome, checkpoint.populationOrder);
  const challengers = identifyChallengers(postStage2, completed, populationByGenome, rosters);
  const fixture = JSON.parse(extract("fixtures/r29_tournament_schedule_expected.json"));
  assert.deepEqual(challengers.map(challenger => challenger.id), fixture.challengers.map(challenger => challenger.id));
  assert.deepEqual(challengers.map(challenger =>
    scheduleChallengerMissingGames(challenger.id, completed, populationByGenome, rosters).length), [280, 280, 280, 280]);

  const result = await runChallengerCleanup({
    rows: completed,
    populationByGenome,
    rosters,
    populationOrder: checkpoint.populationOrder,
    executeSchedule: async schedule => schedule.map(game => expectedByKey.get(coloredGameKey(game.redId, game.blueId)))
  });
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].schedule.length, 1_114);
  assert.deepEqual(new Set(result.history[0].schedule.map(game => coloredGameKey(game.redId, game.blueId))),
    new Set(expectedByKey.keys()));
  assert.equal(result.rows.length, 72_556);
  assert.equal(identifyChallengers(result.rankings, result.rows, populationByGenome, rosters).length, 0);

  const stage1Schedule = buildStage1Schedule(checkpoint.population, checkpoint.populationOrder);
  const stage1Rankings = rankLedger(allRows.filter(row => row.stage === "stage1_core"), populationByGenome, checkpoint.populationOrder);
  const stage2Schedule = buildStage2Schedule(selectTentativeElites(stage1Rankings), rosters, stage1Schedule.length);
  const audit = auditTournamentSchedule(
    [...stage1Schedule, ...stage2Schedule, ...result.history[0].schedule.map((game, index) => ({
      ...game, scheduleIndex: stage1Schedule.length + stage2Schedule.length + index
    }))],
    populationByGenome,
    rosters,
    result.rankings
  );
  assert.deepEqual(audit, {
    totalGames: 72_556,
    stageCounts: { stage1_core: 43_218, stage2_elite: 28_224, challenger: 1_114 },
    challengerRounds: 1,
    uniqueColoredGames: 72_556,
    incompleteFinalists: []
  });
  assert.equal(assertR29TournamentAudit(audit), audit);
});
