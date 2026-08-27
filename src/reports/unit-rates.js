const UNITS = Object.freeze(["P", "A", "C"]);

function divide(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

/** Normalize one color's ledger columns into a color-independent observation. */
export function readGeneralSide(row, color) {
  if (color !== "red" && color !== "blue") throw new Error(`Unknown ledger color: ${color}`);
  const prefix = color;
  const id = row[`${prefix}Id`];
  if (typeof id !== "string" || id === "") throw new Error(`Ledger row has no ${prefix} genome ID`);
  const read = field => {
    const value = row[`${prefix}${field}`];
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${prefix}${field} for ${id}`);
    return value;
  };
  return {
    id,
    opponentId: row[color === "red" ? "blueId" : "redId"],
    pokes: read("Pokes"),
    trained: Object.fromEntries(UNITS.map(unit => [unit, read(unit)])),
    kills: Object.fromEntries(UNITS.map(unit => [unit, read(`KillBy${unit}`)])),
    victims: Object.fromEntries(UNITS.map(unit => [unit, read(`Victim${unit}`)]))
  };
}

function emptyTotals() {
  return {
    games: 0,
    pokes: 0,
    trained: { P: 0, A: 0, C: 0 },
    kills: { P: 0, A: 0, C: 0 },
    victims: { P: 0, A: 0, C: 0 }
  };
}

function addObservation(totals, observation) {
  totals.games += 1;
  totals.pokes += observation.pokes;
  for (const unit of UNITS) {
    totals.trained[unit] += observation.trained[unit];
    totals.kills[unit] += observation.kills[unit];
    totals.victims[unit] += observation.victims[unit];
  }
}

function rates(totals) {
  const trainedTotal = UNITS.reduce((sum, unit) => sum + totals.trained[unit], 0);
  const killTotal = UNITS.reduce((sum, unit) => sum + totals.kills[unit], 0);
  return {
    games: totals.games,
    trainedPerGame: Object.fromEntries(UNITS.map(unit => [unit, divide(totals.trained[unit], totals.games)])),
    trainingShare: Object.fromEntries(UNITS.map(unit => [unit, divide(totals.trained[unit], trainedTotal)])),
    pokesPerGame: divide(totals.pokes, totals.games),
    killsPerGame: Object.fromEntries(UNITS.map(unit => [unit, divide(totals.kills[unit], totals.games)])),
    killShare: Object.fromEntries(UNITS.map(unit => [unit, divide(totals.kills[unit], killTotal)])),
    victimsPerGame: Object.fromEntries(UNITS.map(unit => [unit, divide(totals.victims[unit], totals.games)]))
  };
}

function observations(rows, populationByGenome) {
  return rows.flatMap(row => ["red", "blue"].map(color => {
    const observation = readGeneralSide(row, color);
    const population = populationByGenome.get(observation.id);
    const opponentPopulation = populationByGenome.get(observation.opponentId);
    if (population === undefined || opponentPopulation === undefined) {
      throw new Error(`Unknown genome in unit-rate ledger: ${observation.id} vs ${observation.opponentId}`);
    }
    return { ...observation, population, opponentPopulation };
  }));
}

/** Aggregate color-independent rates for every general. */
export function buildIndividualUnitRates(rows, populationByGenome) {
  const totals = new Map();
  for (const observation of observations(rows, populationByGenome)) {
    if (!totals.has(observation.id)) totals.set(observation.id, emptyTotals());
    addObservation(totals.get(observation.id), observation);
  }
  return new Map([...totals].map(([id, value]) => [id, {
    id,
    population: populationByGenome.get(id),
    ...rates(value)
  }]));
}

/** Aggregate each general separately against each opposing population. */
export function buildGeneralOpponentUnitRates(rows, populationByGenome) {
  const totals = new Map();
  for (const observation of observations(rows, populationByGenome)) {
    const key = `${observation.id}\0${observation.opponentPopulation}`;
    if (!totals.has(key)) totals.set(key, emptyTotals());
    addObservation(totals.get(key), observation);
  }
  return new Map([...totals].map(([key, value]) => {
    const [id, opponentPopulation] = key.split("\0");
    return [key, { id, population: populationByGenome.get(id), opponentPopulation, ...rates(value) }];
  }));
}

function averageGeneralRates(generals) {
  const result = { generals: generals.length };
  for (const field of ["trainedPerGame", "trainingShare", "killsPerGame", "killShare", "victimsPerGame"]) {
    result[field] = Object.fromEntries(UNITS.map(unit => [unit,
      generals.reduce((sum, general) => sum + general[field][unit], 0) / generals.length]));
  }
  result.pokesPerGame = generals.reduce((sum, general) => sum + general.pokesPerGame, 0) / generals.length;
  return result;
}

/** Build game-weighted and equal-general summaries for each population. */
export function buildPopulationUnitRates(rows, populationByGenome, populationOrder) {
  const populationTotals = new Map(populationOrder.map(population => [population, emptyTotals()]));
  for (const observation of observations(rows, populationByGenome)) {
    const totals = populationTotals.get(observation.population);
    if (totals === undefined) throw new Error(`Population missing from populationOrder: ${observation.population}`);
    addObservation(totals, observation);
  }
  const individual = buildIndividualUnitRates(rows, populationByGenome);
  return {
    gameWeighted: Object.fromEntries(populationOrder.map(population => [population, rates(populationTotals.get(population))])),
    equalGeneral: Object.fromEntries(populationOrder.map(population => {
      const generals = [...individual.values()].filter(general => general.population === population);
      if (generals.length === 0) throw new Error(`Population has no ledger games: ${population}`);
      return [population, averageGeneralRates(generals)];
    }))
  };
}
