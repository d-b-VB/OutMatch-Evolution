import { R29_POPULATIONS } from "../baseline/checkpoint.js";
import { buildExposureReport, isFullyEvaluated, rankLedger } from "./ranking.js";
import { coloredGameKey, createScheduledGame, SPECIALIST_POPULATIONS } from "./schedule.js";

/** Find currently top-ranked specialists that still lack complete two-color exposure. */
export function identifyChallengers(rankings, rows, populationByGenome, rosters, eliteCount = 14) {
  if (!Number.isSafeInteger(eliteCount) || eliteCount < 1) throw new Error(`Invalid elite count: ${eliteCount}`);
  const challengers = [];
  for (const population of SPECIALIST_POPULATIONS) {
    for (const ranking of rankings[population].slice(0, eliteCount)) {
      const exposure = buildExposureReport(rows, ranking.id, populationByGenome, rosters);
      if (!isFullyEvaluated(exposure)) challengers.push({
        id: ranking.id,
        population,
        rank: ranking.rank,
        exposure
      });
    }
  }
  return challengers;
}

function completedGameKeys(rows) {
  return new Set(rows.map(row => coloredGameKey(row.redId, row.blueId)));
}

/** Schedule every missing colored game needed to fully evaluate one challenger. */
export function scheduleChallengerMissingGames(
  challengerId,
  completedRows,
  populationByGenome,
  rosters,
  { iteration = 1, startIndex = 0 } = {}
) {
  const ownPopulation = populationByGenome.get(challengerId);
  if (!SPECIALIST_POPULATIONS.includes(ownPopulation)) throw new Error(`Challenger is not a specialist: ${challengerId}`);
  const completed = completedGameKeys(completedRows);
  const games = [];
  for (const [population, opponentIds] of rosters) {
    if (population === ownPopulation) continue;
    for (const opponentId of opponentIds) {
      for (const [redId, blueId] of [[challengerId, opponentId], [opponentId, challengerId]]) {
        if (completed.has(coloredGameKey(redId, blueId))) continue;
        games.push(createScheduledGame({
          stage: "challenger",
          scheduleIndex: startIndex + games.length,
          redId,
          blueId,
          challengerIteration: iteration
        }));
      }
    }
  }
  return games;
}

/** Merge challenger requests without replaying completed or overlapping colored games. */
export function buildChallengerSchedule(
  challengers,
  completedRows,
  populationByGenome,
  rosters,
  { iteration = 1, startIndex = 0 } = {}
) {
  const seen = completedGameKeys(completedRows);
  const games = [];
  for (const challenger of challengers) {
    const requested = scheduleChallengerMissingGames(
      challenger.id,
      completedRows,
      populationByGenome,
      rosters,
      { iteration, startIndex: 0 }
    );
    for (const game of requested) {
      const key = coloredGameKey(game.redId, game.blueId);
      if (seen.has(key)) continue;
      seen.add(key);
      games.push(createScheduledGame({
        ...game,
        scheduleIndex: startIndex + games.length
      }));
    }
  }
  return games;
}

/** Rerank and execute challenger rounds until every final specialist elite is complete. */
export async function runChallengerCleanup({
  rows,
  populationByGenome,
  rosters,
  executeSchedule,
  populationOrder = R29_POPULATIONS,
  eliteCount = 14,
  maxIterations = 20
}) {
  if (typeof executeSchedule !== "function") throw new Error("Challenger cleanup requires a schedule executor");
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) throw new Error("Invalid challenger iteration limit");
  const ledger = [...rows];
  const history = [];
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const rankings = rankLedger(ledger, populationByGenome, populationOrder);
    const challengers = identifyChallengers(rankings, ledger, populationByGenome, rosters, eliteCount);
    if (challengers.length === 0) return { rows: ledger, rankings, history };
    const schedule = buildChallengerSchedule(challengers, ledger, populationByGenome, rosters, { iteration });
    if (schedule.length === 0) throw new Error(`Challenger cleanup made no progress in iteration ${iteration}`);
    const results = await executeSchedule(schedule);
    if (!Array.isArray(results) || results.length !== schedule.length) {
      throw new Error(`Challenger executor returned ${results?.length ?? "invalid"} rows for ${schedule.length} games`);
    }
    for (let index = 0; index < schedule.length; index += 1) {
      if (coloredGameKey(results[index].redId, results[index].blueId)
        !== coloredGameKey(schedule[index].redId, schedule[index].blueId)) {
        throw new Error(`Challenger result does not match schedule index ${schedule[index].scheduleIndex}`);
      }
    }
    ledger.push(...results);
    history.push({ iteration, challengers, schedule });
  }
  throw new Error(`Challenger cleanup exceeded ${maxIterations} iterations`);
}
