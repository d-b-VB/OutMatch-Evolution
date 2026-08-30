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

/** Evaluate every outsider for the generation's single recruiting population. */
export function planAutomaticMigration({
  rows,
  populationByGenome,
  rankings,
  destinationPopulation,
  enabled = true,
  maximumMigrants = 4,
  maximumDestinationRank = 24
}) {
  if (!R29_POPULATIONS.includes(destinationPopulation)) throw new Error("Automatic migration requires a recruiting population");
  if (!Array.isArray(rows) || !(populationByGenome instanceof Map) || rankings?.[destinationPopulation] === undefined) {
    throw new Error("Invalid automatic migration inputs");
  }
  if (!enabled || maximumMigrants === 0) return { destinationPopulation, candidates: [], selected: [] };
  const candidates = [...populationByGenome].filter(([, population]) => population !== destinationPopulation)
    .map(([id]) => determineMigrantEligibility(evaluateHypotheticalDestination({
      id, destinationPopulation, rows, populationByGenome,
      destinationRankings: rankings[destinationPopulation]
    }), rankings, maximumDestinationRank));
  return {
    destinationPopulation,
    candidates,
    selected: selectMigrants(candidates, { enabled, maximumMigrants })
  };
}

/** Convert reviewed manual UI operations into auditable non-breeding entrants. */
export function planManualPopulationInterventions(operations, parentGenomes) {
  if (!Array.isArray(operations) || !(parentGenomes instanceof Map)) throw new Error("Invalid manual intervention inputs");
  const entrantIds = new Set();
  return operations.map(operation => {
    if (operation?.type === "manual-move") {
      const source = parentGenomes.get(operation.generalId);
      if (!source || source.population !== operation.from || operation.from === operation.to
        || !R29_POPULATIONS.includes(operation.to)) throw new Error(`Invalid manual move: ${operation?.generalId ?? "unknown"}`);
      if (entrantIds.has(source.id)) throw new Error(`Duplicate manual entrant: ${source.id}`);
      entrantIds.add(source.id);
      return {
        id: source.id, sourceId: source.id, currentPopulation: operation.from,
        destinationPopulation: operation.to, destinationRank: 1, origin: "manual_migrant", note: operation.note
      };
    }
    if (operation?.type === "copy-entrant") {
      const source = parentGenomes.get(operation.sourceGeneralId);
      if (!source || !R29_POPULATIONS.includes(operation.to) || typeof operation.newId !== "string" || !operation.newId
        || parentGenomes.has(operation.newId)) throw new Error(`Invalid copy entrant: ${operation?.newId ?? "unknown"}`);
      if (entrantIds.has(operation.newId)) throw new Error(`Duplicate manual entrant: ${operation.newId}`);
      entrantIds.add(operation.newId);
      return {
        id: operation.newId, sourceId: source.id, currentPopulation: source.population,
        destinationPopulation: operation.to, destinationRank: 1, origin: "manual_copy",
        newName: operation.newName, note: operation.note
      };
    }
    if (operation?.type === "replacement-upload") {
      const replaced = parentGenomes.get(operation.replacesGeneralId);
      const genome = structuredClone(operation.genome);
      if (!replaced || replaced.population !== operation.to || genome?.population !== operation.to
        || (parentGenomes.has(genome?.id) && genome.id !== replaced.id)) {
        throw new Error(`Invalid replacement upload: ${operation?.replacesGeneralId ?? "unknown"}`);
      }
      if (entrantIds.has(genome.id)) throw new Error(`Duplicate manual entrant: ${genome.id}`);
      entrantIds.add(genome.id);
      return {
        id: genome.id, sourceId: genome.id, currentPopulation: operation.to,
        destinationPopulation: operation.to, destinationRank: 1, origin: "manual_replacement",
        replacesId: replaced.id, uploadedGenome: genome, note: operation.note
      };
    }
    throw new Error(`Unsupported manual intervention: ${operation?.type ?? "unknown"}`);
  });
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
    if (migrant.origin === "manual_replacement") source.add(migrant.replacesId);
    else if (migrant.origin !== "manual_copy") source.add(migrant.sourceId ?? migrant.id);
    const destination = incoming.get(migrant.destinationPopulation);
    if (destination === undefined) throw new Error(`Unknown migrant destination: ${migrant.destinationPopulation}`);
    destination.push({
      id: migrant.id,
      sourceId: migrant.sourceId ?? migrant.id,
      rank: migrant.destinationRank,
      sourcePopulation: migrant.currentPopulation,
      destinationPopulation: migrant.destinationPopulation,
      origin: migrant.origin ?? "automatic_migrant",
      ...(migrant.replacesId ? { replacesId: migrant.replacesId } : {}),
      ...(migrant.newName ? { name: migrant.newName } : {}),
      ...(migrant.uploadedGenome ? { genome: structuredClone(migrant.uploadedGenome) } : {}),
      ...(migrant.note ? { note: migrant.note } : {})
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
      if (["automatic_migrant", "manual_migrant", "manual_copy", "manual_replacement"].includes(resident.origin)
        && resident.breedingEligible !== false) {
        throw new Error(`Incoming resident is incorrectly breeding-eligible: ${resident.id}`);
      }
    }
  }
  return pools;
}
