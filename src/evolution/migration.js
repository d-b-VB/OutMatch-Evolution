import { R29_POPULATIONS } from "../baseline/checkpoint.js";
import { buildFitnessReport } from "../reports/fitness.js";
import { buildResidentPool } from "./breeding.js";

/** Advance the one-population-per-generation recruiting rotation. */
export function nextRecruitingPopulation(currentPopulation) {
  const index = R29_POPULATIONS.indexOf(currentPopulation);
  if (index === -1) throw new Error(`Unknown recruiting population: ${currentPopulation}`);
  return R29_POPULATIONS[(index + 1) % R29_POPULATIONS.length];
}

function compareCandidateToResident(candidate, resident) {
  return resident.fitness - candidate.fitness
    || (candidate.id < resident.id ? -1 : candidate.id > resident.id ? 1 : 0);
}

/** Re-score an outsider under the destination formula and calculate its hypothetical rank. */
export function evaluateHypotheticalDestination({
  id,
  destinationPopulation,
  rows,
  populationByGenome,
  destinationRankings
}) {
  const currentPopulation = populationByGenome.get(id);
  if (currentPopulation === undefined) throw new Error(`Unknown migration candidate: ${id}`);
  if (!R29_POPULATIONS.includes(destinationPopulation) || currentPopulation === destinationPopulation) {
    throw new Error(`Invalid migration destination for ${id}: ${destinationPopulation}`);
  }
  const hypotheticalPopulations = new Map(populationByGenome);
  hypotheticalPopulations.set(id, destinationPopulation);
  const report = buildFitnessReport(rows, hypotheticalPopulations).get(id);
  if (report === undefined) throw new Error(`Migration candidate has no ledger games: ${id}`);
  const candidate = { id, fitness: report.fitness };
  const destinationRank = 1 + destinationRankings.filter(resident =>
    compareCandidateToResident(candidate, resident) > 0).length;
  return {
    id,
    currentPopulation,
    destinationPopulation,
    currentRank: null,
    destinationRank,
    hypotheticalBase: report.base,
    hypotheticalFitness: report.fitness
  };
}

/** Attach current rank and determine the canonical migration eligibility rule. */
export function determineMigrantEligibility(candidate, rankings, maximumDestinationRank = 24) {
  if (!Number.isSafeInteger(maximumDestinationRank) || maximumDestinationRank < 1) throw new Error("Invalid migration rank limit");
  const current = rankings[candidate.currentPopulation]?.find(record => record.id === candidate.id);
  if (current === undefined) throw new Error(`Candidate is absent from current rankings: ${candidate.id}`);
  const currentRank = current.rank;
  const rankImprovement = currentRank - candidate.destinationRank;
  const eligible = candidate.destinationRank <= maximumDestinationRank && rankImprovement > 0;
  return {
    ...candidate,
    currentRank,
    rankImprovement,
    eligible,
    rejectionReason: eligible ? null
      : candidate.destinationRank > maximumDestinationRank ? "destination_rank" : "no_rank_improvement"
  };
}

/** Sort eligible migration candidates by destination rank, improvement, then ID. */
export function sortMigrationCandidates(candidates) {
  return [...candidates].sort((first, second) =>
    first.destinationRank - second.destinationRank
    || second.rankImprovement - first.rankImprovement
    || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0));
}

/** Select at most the configured number of automatic migrants. */
export function selectMigrants(candidates, { enabled = true, maximumMigrants = 4 } = {}) {
  if (!Number.isSafeInteger(maximumMigrants) || maximumMigrants < 0) throw new Error("Maximum migrants must be nonnegative");
  if (!enabled || maximumMigrants === 0) return [];
  return sortMigrationCandidates(candidates.filter(candidate => candidate.eligible)).slice(0, maximumMigrants);
}

/** Apply outgoing and incoming migrants to all fixed-size survivor pools. */
export function applyMigrationToResidentPools(rankings, migrants, survivorSlots = 14) {
  const outgoing = new Map(R29_POPULATIONS.map(population => [population, new Set()]));
  const incoming = new Map(R29_POPULATIONS.map(population => [population, []]));
  const migrantIds = new Set();
  for (const migrant of migrants) {
    if (migrantIds.has(migrant.id)) throw new Error(`Duplicate selected migrant: ${migrant.id}`);
    migrantIds.add(migrant.id);
    const source = outgoing.get(migrant.currentPopulation);
    if (source === undefined) throw new Error(`Unknown migrant source: ${migrant.currentPopulation}`);
    source.add(migrant.id);
    const destination = incoming.get(migrant.destinationPopulation);
    if (destination === undefined) throw new Error(`Unknown migrant destination: ${migrant.destinationPopulation}`);
    destination.push({
      id: migrant.id,
      rank: migrant.destinationRank,
      sourcePopulation: migrant.currentPopulation,
      destinationPopulation: migrant.destinationPopulation,
      origin: "automatic_migrant"
    });
  }
  return Object.fromEntries(R29_POPULATIONS.map(population => [population, buildResidentPool(rankings[population], {
    survivorSlots,
    outgoingIds: outgoing.get(population),
    incoming: incoming.get(population)
  })]));
}

/** Verify fixed pool sizes, unique residence, and insertion-cycle breeding restrictions. */
export function validateMigrationResidentPools(pools, survivorSlots = 14) {
  const ids = new Set();
  for (const population of R29_POPULATIONS) {
    const residents = pools[population];
    if (!Array.isArray(residents) || residents.length !== survivorSlots) {
      throw new Error(`Migration pool ${population} must contain ${survivorSlots} residents`);
    }
    for (const resident of residents) {
      if (ids.has(resident.id)) throw new Error(`Genome occupies multiple resident pools: ${resident.id}`);
      ids.add(resident.id);
      if (["automatic_migrant", "manual_migrant", "manual_copy"].includes(resident.origin)
        && resident.breedingEligible !== false) {
        throw new Error(`Incoming resident is incorrectly breeding-eligible: ${resident.id}`);
      }
    }
  }
  return pools;
}
