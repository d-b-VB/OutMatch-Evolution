import assert from "node:assert/strict";
import test from "node:test";
import { R29_POPULATIONS } from "../../src/baseline/checkpoint.js";
import { readFileSync } from "node:fs";
import { handleGameRequest } from "../../src/evolution/worker-protocol.js";
import { runWorkerSchedule } from "../../src/evolution/worker-pool.js";
import { runTournament, executeTournamentStage, TournamentState } from "../../src/evolution/tournament.js";

function ledgerRow(game) {
  return {
    ...game,
    outcome: "draw", winner: "", round: 20, redScore: 0, blueScore: 0,
    redP: 1, redA: 1, redC: 1, blueP: 1, blueA: 1, blueC: 1,
    redPokes: 0, bluePokes: 0,
    redKillByP: 1, redKillByA: 1, redKillByC: 1,
    blueKillByP: 1, blueKillByA: 1, blueKillByC: 1,
    redVictimP: 1, redVictimA: 1, redVictimC: 1,
    blueVictimP: 1, blueVictimA: 1, blueVictimC: 1
  };
}

test("single-stage execution rejects missing and misordered results", async () => {
  const schedule = [{ redId: "a", blueId: "b", scheduleIndex: 4 }];
  assert.deepEqual(await executeTournamentStage(schedule, async games => games.map(ledgerRow)), [ledgerRow(schedule[0])]);
  await assert.rejects(executeTournamentStage(schedule, async () => []), /returned 0 rows/);
  await assert.rejects(executeTournamentStage(schedule, async () => [{ redId: "b", blueId: "a" }]), /result mismatch/);
});

test("tournament state machine rejects illegal stage transitions", () => {
  const state = new TournamentState();
  assert.equal(state.transition("stage1_scheduling"), "stage1_scheduling");
  assert.throws(() => state.transition("stage2_running"), /Illegal tournament transition/);
});

test("reduced seven-population tournament runs both stages and finishes without challengers", async () => {
  const genomes = R29_POPULATIONS.map((population, index) => ({ id: `genome-${index}`, population, genes: {} }));
  const result = await runTournament({
    genomes,
    populationOrder: R29_POPULATIONS,
    eliteCount: 1,
    executeSchedule: async schedule => schedule.map(ledgerRow)
  });
  assert.equal(result.schedules.stage1.length, 18);
  assert.equal(result.schedules.stage2.length, 24);
  assert.equal(result.schedules.challengers.length, 0);
  assert.equal(result.ledger.length, 42);
  assert.equal(result.state.status, "complete");
  assert.deepEqual(result.state.history, [
    "idle", "stage1_scheduling", "stage1_running", "stage1_ranking", "stage2_scheduling",
    "stage2_running", "stage2_ranking", "challenger_cleanup", "final_ranking", "complete"
  ]);
  for (const population of R29_POPULATIONS) assert.equal(result.rankings[population][0].id,
    genomes.find(genome => genome.population === population).id);
});

class InlineGameWorker {
  constructor() { this.listeners = { message: [], error: [] }; }
  addEventListener(type, listener) { this.listeners[type].push(listener); }
  postMessage(request) {
    setTimeout(() => {
      try {
        const data = handleGameRequest(request);
        for (const listener of this.listeners.message) listener({ data });
      } catch (error) {
        for (const listener of this.listeners.error) listener({ error });
      }
    }, 0);
  }
  terminate() {}
}

test("reduced tournament executes the real engine through the Worker pool", async () => {
  const checkpoint = JSON.parse(readFileSync("seed/r29/Reach_R29_Complete_Checkpoint.json", "utf8"));
  const genomes = R29_POPULATIONS.map(population => checkpoint.population.find(genome => genome.population === population));
  const genomeIndex = new Map(genomes.map(genome => [genome.id, genome]));
  const result = await runTournament({
    genomes,
    populationOrder: R29_POPULATIONS,
    eliteCount: 1,
    executeSchedule: schedule => runWorkerSchedule({
      schedule,
      genomes: genomeIndex,
      workerCount: 2,
      engineOptions: { depth: 1 },
      createWorker: () => new InlineGameWorker()
    })
  });
  assert.equal(result.ledger.length, 42);
  assert.equal(result.state.status, "complete");
  assert.ok(result.ledger.every(row => row.engineRulesVersion === "reach-v1"));
});
