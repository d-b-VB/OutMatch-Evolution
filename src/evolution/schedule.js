import { R29_POPULATIONS } from "../baseline/checkpoint.js";

export const GENERALIST_POPULATION = "generalists";
export const SPECIALIST_POPULATIONS = Object.freeze(
  R29_POPULATIONS.filter(population => population !== GENERALIST_POPULATION)
);
export const RIVAL_POPULATION = Object.freeze({
  horse_lords: "horse_hunters",
  pike_lords: "pike_hunters",
  archer_lords: "archer_hunters",
  horse_hunters: "horse_lords",
  pike_hunters: "pike_lords",
  archer_hunters: "archer_lords"
});
export const UNRELATED_SPECIALISTS = Object.freeze(Object.fromEntries(
  SPECIALIST_POPULATIONS.map(population => [population, Object.freeze(
    SPECIALIST_POPULATIONS.filter(candidate => candidate !== population && candidate !== RIVAL_POPULATION[population])
  )])
));
export const TOURNAMENT_STAGES = Object.freeze(["stage1_core", "stage2_elite", "challenger"]);

/** Validate the fixed relationships used by all three tournament stages. */
export function validatePopulationRelationships(populationOrder = R29_POPULATIONS) {
  if (new Set(populationOrder).size !== populationOrder.length) {
    throw new Error("Tournament population order contains duplicates");
  }
  if (populationOrder.length !== R29_POPULATIONS.length
    || R29_POPULATIONS.some(population => !populationOrder.includes(population))) {
    throw new Error("Tournament requires the seven canonical populations");
  }
  for (const population of SPECIALIST_POPULATIONS) {
    const rival = RIVAL_POPULATION[population];
    if (!SPECIALIST_POPULATIONS.includes(rival) || RIVAL_POPULATION[rival] !== population) {
      throw new Error(`Asymmetric rival relationship for ${population}`);
    }
    const unrelated = UNRELATED_SPECIALISTS[population];
    if (unrelated.length !== 4 || unrelated.includes(population) || unrelated.includes(rival)
      || unrelated.some(candidate => !UNRELATED_SPECIALISTS[candidate].includes(population))) {
      throw new Error(`Invalid unrelated specialist relationships for ${population}`);
    }
  }
  return {
    generalist: GENERALIST_POPULATION,
    specialists: SPECIALIST_POPULATIONS,
    rivals: RIVAL_POPULATION,
    unrelatedSpecialists: UNRELATED_SPECIALISTS
  };
}

function validateGenomeId(id, label) {
  if (typeof id !== "string" || id.length === 0) throw new Error(`${label} genome ID must be a non-empty string`);
}

/** Stable key for an unordered genome pairing. */
export function pairingKey(firstId, secondId) {
  validateGenomeId(firstId, "First");
  validateGenomeId(secondId, "Second");
  if (firstId === secondId) throw new Error(`Tournament cannot pair genome ${firstId} with itself`);
  return JSON.stringify([firstId, secondId].sort());
}

/** Stable key for one color assignment of a pairing. */
export function coloredGameKey(redId, blueId) {
  pairingKey(redId, blueId);
  return JSON.stringify([redId, blueId]);
}

/** Construct and validate the serializable record dispatched for one game. */
export function createScheduledGame({
  stage,
  scheduleIndex,
  redId,
  blueId,
  challengerIteration = null
}) {
  if (!TOURNAMENT_STAGES.includes(stage)) throw new Error(`Unknown tournament stage: ${stage}`);
  if (!Number.isSafeInteger(scheduleIndex) || scheduleIndex < 0) {
    throw new Error(`Invalid tournament schedule index: ${scheduleIndex}`);
  }
  coloredGameKey(redId, blueId);
  if (stage === "challenger") {
    if (!Number.isSafeInteger(challengerIteration) || challengerIteration < 1) {
      throw new Error("Challenger games require a positive challenger iteration");
    }
  } else if (challengerIteration !== null) {
    throw new Error(`${stage} games cannot have a challenger iteration`);
  }
  return Object.freeze({ stage, scheduleIndex, redId, blueId, challengerIteration });
}

/** Emit both color assignments for one genome pairing. */
export function twoColorMatchups(firstId, secondId, {
  stage,
  startIndex = 0,
  challengerIteration = null
} = {}) {
  pairingKey(firstId, secondId);
  return [
    createScheduledGame({ stage, scheduleIndex: startIndex, redId: firstId, blueId: secondId, challengerIteration }),
    createScheduledGame({ stage, scheduleIndex: startIndex + 1, redId: secondId, blueId: firstId, challengerIteration })
  ];
}

/** Remove repeated colored games while retaining their first scheduled occurrence. */
export function deduplicateSchedule(games) {
  const keys = new Set();
  const indexes = new Set();
  const unique = [];
  for (const game of games) {
    const validated = createScheduledGame(game);
    if (indexes.has(validated.scheduleIndex)) {
      throw new Error(`Duplicate tournament schedule index: ${validated.scheduleIndex}`);
    }
    indexes.add(validated.scheduleIndex);
    const key = coloredGameKey(validated.redId, validated.blueId);
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(validated);
  }
  return unique;
}

/** Index ordered genome IDs by their canonical population. */
export function buildPopulationRosters(genomes, populationOrder = R29_POPULATIONS) {
  validatePopulationRelationships(populationOrder);
  const rosters = new Map(populationOrder.map(population => [population, []]));
  const ids = new Set();
  for (const genome of genomes) {
    validateGenomeId(genome?.id, "Roster");
    if (ids.has(genome.id)) throw new Error(`Duplicate tournament genome ID: ${genome.id}`);
    ids.add(genome.id);
    const roster = rosters.get(genome.population);
    if (roster === undefined) throw new Error(`Unknown tournament population: ${genome.population}`);
    roster.push(genome.id);
  }
  return rosters;
}

/** Schedule a full two-color Cartesian product between two population rosters. */
export function schedulePopulationPair(firstRoster, secondRoster, {
  stage = "stage1_core",
  startIndex = 0,
  challengerIteration = null
} = {}) {
  if (!Array.isArray(firstRoster) || firstRoster.length === 0
    || !Array.isArray(secondRoster) || secondRoster.length === 0) {
    throw new Error("Population pair scheduling requires two non-empty rosters");
  }
  const games = [];
  for (const firstId of firstRoster) {
    for (const secondId of secondRoster) {
      games.push(...twoColorMatchups(firstId, secondId, {
        stage,
        startIndex: startIndex + games.length,
        challengerIteration
      }));
    }
  }
  return games;
}

/** Schedule one specialist population against all Generalists. */
export function scheduleSpecialistVsGeneralists(specialist, rosters, startIndex = 0) {
  if (!SPECIALIST_POPULATIONS.includes(specialist)) throw new Error(`Not a specialist population: ${specialist}`);
  return schedulePopulationPair(rosters.get(specialist), rosters.get(GENERALIST_POPULATION), { startIndex });
}

/** Schedule all six specialist populations against the Generalists. */
export function scheduleAllSpecialistsVsGeneralists(rosters, startIndex = 0) {
  const games = [];
  for (const specialist of SPECIALIST_POPULATIONS) {
    games.push(...scheduleSpecialistVsGeneralists(specialist, rosters, startIndex + games.length));
  }
  return games;
}

/** Schedule one canonical Lord/Hunter rival population pair. */
export function scheduleRivalPair(lordPopulation, rosters, startIndex = 0) {
  if (!lordPopulation.endsWith("_lords") || RIVAL_POPULATION[lordPopulation] === undefined) {
    throw new Error(`Not a Lord population: ${lordPopulation}`);
  }
  return schedulePopulationPair(rosters.get(lordPopulation), rosters.get(RIVAL_POPULATION[lordPopulation]), { startIndex });
}

/** Schedule all three unique Lord/Hunter rival population pairs. */
export function scheduleAllRivalPairs(rosters, startIndex = 0) {
  const games = [];
  for (const lordPopulation of SPECIALIST_POPULATIONS.filter(population => population.endsWith("_lords"))) {
    games.push(...scheduleRivalPair(lordPopulation, rosters, startIndex + games.length));
  }
  return games;
}

/** Build the complete deterministic Stage 1 core schedule. */
export function buildStage1Schedule(genomes, populationOrder = R29_POPULATIONS) {
  const rosters = buildPopulationRosters(genomes, populationOrder);
  const generalistGames = scheduleAllSpecialistsVsGeneralists(rosters);
  const rivalGames = scheduleAllRivalPairs(rosters, generalistGames.length);
  return [...generalistGames, ...rivalGames];
}

/** Enumerate each unrelated specialist-population relationship exactly once. */
export function unrelatedPopulationPairs() {
  const seen = new Set();
  const pairs = [];
  for (const population of SPECIALIST_POPULATIONS) {
    for (const unrelated of UNRELATED_SPECIALISTS[population]) {
      const key = JSON.stringify([population, unrelated].sort());
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([population, unrelated]);
    }
  }
  return pairs;
}

/** Schedule one population's tentative elites against an unrelated full roster. */
export function scheduleEliteSide(eliteIds, opponentRoster, startIndex = 0) {
  if (!Array.isArray(eliteIds) || eliteIds.length === 0) throw new Error("Elite schedule requires at least one elite");
  if (new Set(eliteIds).size !== eliteIds.length) throw new Error("Elite schedule contains duplicate genome IDs");
  return schedulePopulationPair(eliteIds, opponentRoster, { stage: "stage2_elite", startIndex });
}

/** Schedule reciprocal elite exposure, emitting elite-versus-elite pairings only once. */
export function scheduleElitePopulationPair(firstElites, firstRoster, secondElites, secondRoster, startIndex = 0) {
  const requestedPairs = [
    ...firstElites.flatMap(firstId => secondRoster.map(secondId => [firstId, secondId])),
    ...secondElites.flatMap(secondId => firstRoster.map(firstId => [firstId, secondId]))
  ];
  const seen = new Set();
  const games = [];
  for (const [firstId, secondId] of requestedPairs) {
    const key = pairingKey(firstId, secondId);
    if (seen.has(key)) continue;
    seen.add(key);
    games.push(...twoColorMatchups(firstId, secondId, {
      stage: "stage2_elite",
      startIndex: startIndex + games.length
    }));
  }
  return games;
}

/** Build complete Stage 2 exposure for all 12 unrelated specialist pairs. */
export function buildStage2Schedule(tentativeElites, rosters, startIndex = 0) {
  const games = [];
  for (const [firstPopulation, secondPopulation] of unrelatedPopulationPairs()) {
    const firstElites = tentativeElites[firstPopulation];
    const secondElites = tentativeElites[secondPopulation];
    if (!Array.isArray(firstElites) || !Array.isArray(secondElites)) {
      throw new Error(`Missing tentative elites for ${firstPopulation} or ${secondPopulation}`);
    }
    games.push(...scheduleElitePopulationPair(
      firstElites,
      rosters.get(firstPopulation),
      secondElites,
      rosters.get(secondPopulation),
      startIndex + games.length
    ));
  }
  return games;
}
