const HUNTER_TARGETS = Object.freeze({
  horse_hunters: { population: "horse_lords", unit: "C" },
  pike_hunters: { population: "pike_lords", unit: "P" },
  archer_hunters: { population: "archer_lords", unit: "A" }
});

export const FITNESS_FORMULA_VERSION = "reach-fitness-v2";

function resultForColor(row, color) {
  const winner = color === "red" ? "R" : "B";
  if (row.outcome === "draw" && (row.winner === "" || row.winner === null)) return "draw";
  if (row.outcome === "elimination" && ["R", "B"].includes(row.winner)) {
    return row.winner === winner ? "win" : "loss";
  }
  throw new Error(`Invalid ledger result: ${row.outcome} with winner ${row.winner}`);
}

/** Score only the natural-elimination result and its round speed. */
export function rawEliminationScore(result, round, speedCoefficient = 0.5) {
  if (!Number.isFinite(speedCoefficient) || speedCoefficient < 0) throw new Error("Invalid speed coefficient");
  if (result === "draw") return 0;
  if (!Number.isInteger(round) || round < 1 || round > 20) throw new Error(`Invalid elimination round: ${round}`);
  const speed = speedCoefficient * (20 - round) / 19;
  if (result === "win") return 1 + speed;
  if (result === "loss") return -speed;
  throw new Error(`Unknown game result: ${result}`);
}

function sideField(row, color, field) {
  const prefix = color;
  const value = row[`${prefix}${field}`];
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${prefix}${field}`);
  return value;
}

/** Apply the Pike Lord/Hunter game-level target-unit selection credits. */
export function adjustedGameScore(row, color, population) {
  if (color !== "red" && color !== "blue") throw new Error(`Unknown ledger color: ${color}`);
  const result = resultForColor(row, color);
  const raw = rawEliminationScore(result, row.round);
  const hunterTarget = HUNTER_TARGETS[population];
  const targetUnit = population === "pike_lords" ? "C" : hunterTarget?.unit;
  if (targetUnit === undefined) return raw;

  const opponentColor = color === "red" ? "blue" : "red";
  const enemyTargetTrained = sideField(row, opponentColor, targetUnit);
  if (result === "win") return raw * (1 + Math.sqrt(enemyTargetTrained));
  if (hunterTarget === undefined) return raw;
  const targetUnitsKilled = sideField(row, color, `Victim${targetUnit}`);
  const coverage = Math.sqrt(targetUnitsKilled / (1 + enemyTargetTrained));
  if (result === "loss") return raw * (1 - 0.5 * coverage);
  return 0.25 * coverage;
}

/** Population-normalize adjusted game scores and return every general's base fitness. */
export function buildBaseFitness(rows, populationByGenome) {
  const totals = new Map();
  for (const row of rows) {
    for (const color of ["red", "blue"]) {
      const id = row[`${color}Id`];
      const opponentId = row[color === "red" ? "blueId" : "redId"];
      const population = populationByGenome.get(id);
      const opponentPopulation = populationByGenome.get(opponentId);
      if (population === undefined || opponentPopulation === undefined) {
        throw new Error(`Unknown genome in fitness ledger: ${id} vs ${opponentId}`);
      }
      if (!totals.has(id)) totals.set(id, new Map());
      const byPopulation = totals.get(id);
      if (!byPopulation.has(opponentPopulation)) byPopulation.set(opponentPopulation, { sum: 0, games: 0 });
      const group = byPopulation.get(opponentPopulation);
      group.sum += adjustedGameScore(row, color, population);
      group.games += 1;
    }
  }

  return new Map([...totals].map(([id, groups]) => {
    const population = populationByGenome.get(id);
    const target = HUNTER_TARGETS[population]?.population;
    let weightedSum = 0;
    let weights = 0;
    for (const [opponentPopulation, group] of groups) {
      const weight = opponentPopulation === target ? 6 : 1;
      weightedSum += weight * group.sum / group.games;
      weights += weight;
    }
    return [id, weightedSum / weights];
  }));
}

function emptySpecializationGroup() {
  return { games: 0, trained: { P: 0, A: 0, C: 0 }, kills: { P: 0, A: 0, C: 0 } };
}

/** Compute each general's opponent-population-normalized recruitment and kill statistics. */
export function buildSpecializationStats(rows, populationByGenome) {
  const totals = new Map();
  for (const row of rows) {
    for (const color of ["red", "blue"]) {
      const id = row[`${color}Id`];
      const opponentId = row[color === "red" ? "blueId" : "redId"];
      const population = populationByGenome.get(id);
      const opponentPopulation = populationByGenome.get(opponentId);
      if (population === undefined || opponentPopulation === undefined) {
        throw new Error(`Unknown genome in specialization ledger: ${id} vs ${opponentId}`);
      }
      if (!totals.has(id)) totals.set(id, new Map());
      const groups = totals.get(id);
      if (!groups.has(opponentPopulation)) groups.set(opponentPopulation, emptySpecializationGroup());
      const group = groups.get(opponentPopulation);
      group.games += 1;
      for (const unit of ["P", "A", "C"]) {
        group.trained[unit] += sideField(row, color, unit);
        group.kills[unit] += sideField(row, color, `KillBy${unit}`);
      }
    }
  }

  return new Map([...totals].map(([id, groups]) => {
    const groupStats = [...groups.values()].map(group => {
      const trainedTotal = group.trained.P + group.trained.A + group.trained.C;
      const killTotal = group.kills.P + group.kills.A + group.kills.C;
      return {
        recruitFraction: Object.fromEntries(["P", "A", "C"].map(unit => [unit,
          trainedTotal === 0 ? 0 : group.trained[unit] / trainedTotal])),
        killShare: Object.fromEntries(["P", "A", "C"].map(unit => [unit,
          killTotal === 0 ? 0 : group.kills[unit] / killTotal])),
        pikesPerGame: group.trained.P / group.games
      };
    });
    const mean = selector => groupStats.reduce((sum, group) => sum + selector(group), 0) / groupStats.length;
    return [id, {
      opponentPopulations: groupStats.length,
      recruitFraction: Object.fromEntries(["P", "A", "C"].map(unit => [unit, mean(group => group.recruitFraction[unit])])),
      killShare: Object.fromEntries(["P", "A", "C"].map(unit => [unit, mean(group => group.killShare[unit])])),
      pikesPerGame: mean(group => group.pikesPerGame)
    }];
  }));
}

/** Apply Lord specialization only to positive reproductive success. */
export function finalFitness(base, population, specialization) {
  if (!Number.isFinite(base)) throw new Error("Base fitness must be finite");
  if (base <= 0) return base;
  if (population === "horse_lords") return base * specialization.recruitFraction.C * Math.sqrt(specialization.killShare.C);
  if (population === "archer_lords") return base * specialization.recruitFraction.A * Math.sqrt(specialization.killShare.A);
  if (population === "pike_lords") return base * Math.sqrt(specialization.pikesPerGame) * Math.sqrt(specialization.killShare.P);
  return base;
}

/** Compose base scores and specialization statistics into final fitness records. */
export function buildFitnessReport(rows, populationByGenome) {
  const bases = buildBaseFitness(rows, populationByGenome);
  const specializations = buildSpecializationStats(rows, populationByGenome);
  return new Map([...bases].map(([id, base]) => {
    const population = populationByGenome.get(id);
    const specialization = specializations.get(id);
    return [id, { id, population, base, specialization, fitness: finalFitness(base, population, specialization) }];
  }));
}
