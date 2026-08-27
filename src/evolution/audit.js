import { buildExposureReport, isFullyEvaluated } from "./ranking.js";
import { coloredGameKey, SPECIALIST_POPULATIONS, TOURNAMENT_STAGES } from "./schedule.js";

/** Audit a completed three-stage schedule before its results are used for breeding. */
export function auditTournamentSchedule(games, populationByGenome, rosters, finalRankings, eliteCount = 14) {
  const stageCounts = Object.fromEntries(TOURNAMENT_STAGES.map(stage => [stage, 0]));
  const keys = new Set();
  const challengerIterations = new Set();
  for (const game of games) {
    if (!Object.hasOwn(stageCounts, game.stage)) throw new Error(`Unknown audited stage: ${game.stage}`);
    const redPopulation = populationByGenome.get(game.redId);
    const bluePopulation = populationByGenome.get(game.blueId);
    if (redPopulation === undefined || bluePopulation === undefined) throw new Error("Audited game references an unknown genome");
    if (game.redId === game.blueId) throw new Error("Audited schedule contains a self-game");
    if (redPopulation === bluePopulation) throw new Error("Audited schedule contains a within-population game");
    const key = coloredGameKey(game.redId, game.blueId);
    if (keys.has(key)) throw new Error(`Duplicate audited colored game: ${game.redId} vs ${game.blueId}`);
    keys.add(key);
    stageCounts[game.stage] += 1;
    if (game.stage === "challenger") challengerIterations.add(game.challengerIteration);
  }
  const incompleteFinalists = [];
  for (const population of SPECIALIST_POPULATIONS) {
    for (const record of finalRankings[population].slice(0, eliteCount)) {
      if (!isFullyEvaluated(buildExposureReport(games, record.id, populationByGenome, rosters))) {
        incompleteFinalists.push(record.id);
      }
    }
  }
  return {
    totalGames: games.length,
    stageCounts,
    challengerRounds: challengerIterations.size,
    uniqueColoredGames: keys.size,
    incompleteFinalists
  };
}

/** Enforce the frozen R29 schedule acceptance gate. */
export function assertR29TournamentAudit(audit) {
  const expected = { stage1_core: 43_218, stage2_elite: 28_224, challenger: 1_114 };
  if (audit.totalGames !== 72_556 || audit.uniqueColoredGames !== 72_556
    || audit.challengerRounds !== 1 || audit.incompleteFinalists.length !== 0
    || Object.entries(expected).some(([stage, count]) => audit.stageCounts[stage] !== count)) {
    throw new Error("Tournament schedule does not satisfy the canonical R29 acceptance gate");
  }
  return audit;
}
