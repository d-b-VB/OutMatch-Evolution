import { R29_POPULATIONS } from "../baseline/checkpoint.js";
import { buildFitnessReport } from "../reports/fitness.js";
import { GENERALIST_POPULATION, SPECIALIST_POPULATIONS } from "./schedule.js";

function compareIds(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

/** Rank supplied fitness records within each population with a stable ID tie-break. */
export function rankPopulations(fitnessRecords, populationOrder = R29_POPULATIONS) {
  const rankings = Object.fromEntries(populationOrder.map(population => [population, []]));
  for (const record of fitnessRecords) {
    if (!Object.hasOwn(rankings, record.population)) throw new Error(`Unknown ranking population: ${record.population}`);
    if (!Number.isFinite(record.fitness)) throw new Error(`Non-finite fitness for ${record.id}`);
    rankings[record.population].push(record);
  }
  for (const population of populationOrder) {
    rankings[population] = rankings[population]
      .sort((first, second) => second.fitness - first.fitness || compareIds(first.id, second.id))
      .map((record, index) => ({ ...record, rank: index + 1 }));
  }
  return rankings;
}

/** Calculate and rank fitness from any completed subset of tournament ledger rows. */
export function rankLedger(rows, populationByGenome, populationOrder = R29_POPULATIONS) {
  return rankPopulations(buildFitnessReport(rows, populationByGenome).values(), populationOrder);
}

/** Select the tentative top specialists after Stage 1; Generalists need no elite exposure. */
export function selectTentativeElites(rankings, eliteCount = 14) {
  if (!Number.isSafeInteger(eliteCount) || eliteCount < 1) throw new Error(`Invalid elite count: ${eliteCount}`);
  return Object.fromEntries(R29_POPULATIONS.map(population => [
    population,
    population === GENERALIST_POPULATION
      ? []
      : rankings[population].slice(0, eliteCount).map(record => record.id)
  ]));
}

/** Track distinct color assignments completed by one general against each opponent. */
export function buildExposureReport(rows, generalId, populationByGenome, rosters) {
  const ownPopulation = populationByGenome.get(generalId);
  if (ownPopulation === undefined) throw new Error(`Unknown exposure genome: ${generalId}`);
  const colorsByOpponent = new Map();
  for (const row of rows) {
    let opponentId;
    let color;
    if (row.redId === generalId) {
      opponentId = row.blueId;
      color = "red";
    } else if (row.blueId === generalId) {
      opponentId = row.redId;
      color = "blue";
    } else {
      continue;
    }
    if (populationByGenome.get(opponentId) === undefined) throw new Error(`Unknown exposure opponent: ${opponentId}`);
    if (!colorsByOpponent.has(opponentId)) colorsByOpponent.set(opponentId, new Set());
    colorsByOpponent.get(opponentId).add(color);
  }

  const populations = {};
  for (const [population, roster] of rosters) {
    if (population === ownPopulation) continue;
    const completedOpponents = roster.filter(id => colorsByOpponent.get(id)?.size === 2).length;
    const coloredGames = roster.reduce((sum, id) => sum + (colorsByOpponent.get(id)?.size ?? 0), 0);
    populations[population] = {
      opponents: roster.length,
      completedOpponents,
      coloredGames,
      complete: completedOpponents === roster.length
    };
  }
  return {
    id: generalId,
    population: ownPopulation,
    games: [...colorsByOpponent.values()].reduce((sum, colors) => sum + colors.size, 0),
    populations
  };
}

/** A specialist is fully evaluated after both colors against every other population roster. */
export function isFullyEvaluated(exposure) {
  if (!SPECIALIST_POPULATIONS.includes(exposure.population)) return true;
  const populations = Object.values(exposure.populations);
  return populations.length === 6 && populations.every(population => population.complete);
}
