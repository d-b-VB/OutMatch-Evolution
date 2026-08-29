import { runChallengerCleanup } from "./challengers.js";
import { rankLedger, selectTentativeElites } from "./ranking.js";
import { buildPopulationRosters, buildStage1Schedule, buildStage2Schedule, coloredGameKey } from "./schedule.js";

const TRANSITIONS = Object.freeze({
  idle: ["stage1_scheduling"],
  stage1_scheduling: ["stage1_running"],
  stage1_running: ["stage1_ranking"],
  stage1_ranking: ["stage2_scheduling"],
  stage2_scheduling: ["stage2_running"],
  stage2_running: ["stage2_ranking"],
  stage2_ranking: ["challenger_cleanup"],
  challenger_cleanup: ["final_ranking"],
  final_ranking: ["complete"],
  complete: []
});

export class TournamentState {
  constructor() {
    this.status = "idle";
    this.history = ["idle"];
  }

  transition(next) {
    if (!TRANSITIONS[this.status].includes(next)) throw new Error(`Illegal tournament transition: ${this.status} -> ${next}`);
    this.status = next;
    this.history.push(next);
    return this.status;
  }
}

/** Execute and correlate one deterministic stage schedule. */
export async function executeTournamentStage(schedule, executeSchedule) {
  if (!Array.isArray(schedule) || typeof executeSchedule !== "function") throw new Error("Invalid tournament stage executor");
  const rows = await executeSchedule(schedule);
  if (!Array.isArray(rows) || rows.length !== schedule.length) {
    throw new Error(`Tournament stage returned ${rows?.length ?? "invalid"} rows for ${schedule.length} games`);
  }
  for (let index = 0; index < schedule.length; index += 1) {
    if (coloredGameKey(rows[index].redId, rows[index].blueId) !== coloredGameKey(schedule[index].redId, schedule[index].blueId)) {
      throw new Error(`Tournament stage result mismatch at schedule index ${schedule[index].scheduleIndex}`);
    }
  }
  return rows;
}

/** Run scheduling, execution, reranking, and challenger cleanup for one tournament. */
export async function runTournament({
  genomes,
  populationOrder,
  executeSchedule,
  eliteCount = 14
}) {
  if (!Array.isArray(genomes)) throw new Error("Tournament genomes must be an array");
  const state = new TournamentState();
  const populationByGenome = new Map(genomes.map(genome => [genome.id, genome.population]));
  if (populationByGenome.size !== genomes.length) throw new Error("Tournament contains duplicate genome IDs");
  const rosters = buildPopulationRosters(genomes, populationOrder);

  state.transition("stage1_scheduling");
  const stage1Schedule = buildStage1Schedule(genomes, populationOrder);
  state.transition("stage1_running");
  const stage1Rows = await executeTournamentStage(stage1Schedule, executeSchedule);
  state.transition("stage1_ranking");
  const stage1Rankings = rankLedger(stage1Rows, populationByGenome, populationOrder);
  const tentativeElites = selectTentativeElites(stage1Rankings, eliteCount);

  state.transition("stage2_scheduling");
  const stage2Schedule = buildStage2Schedule(tentativeElites, rosters, stage1Schedule.length);
  state.transition("stage2_running");
  const stage2Rows = await executeTournamentStage(stage2Schedule, executeSchedule);
  const preCleanupRows = [...stage1Rows, ...stage2Rows];
  state.transition("stage2_ranking");
  const stage2Rankings = rankLedger(preCleanupRows, populationByGenome, populationOrder);

  state.transition("challenger_cleanup");
  const cleanup = await runChallengerCleanup({
    rows: preCleanupRows,
    populationByGenome,
    rosters,
    populationOrder,
    eliteCount,
    executeSchedule: schedule => executeTournamentStage(schedule, executeSchedule)
  });
  state.transition("final_ranking");
  const rankings = cleanup.rankings;
  state.transition("complete");
  return {
    ledger: cleanup.rows,
    rankings,
    tentativeElites,
    schedules: { stage1: stage1Schedule, stage2: stage2Schedule, challengers: cleanup.history },
    stage2Rankings,
    state
  };
}
