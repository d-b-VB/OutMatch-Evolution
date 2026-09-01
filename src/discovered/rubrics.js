export const RUBRICS = Object.freeze([
  "generalist",
  "horse_lord",
  "pike_lord",
  "archer_lord",
  "horse_hunter",
  "pike_hunter",
  "archer_hunter",
  "red",
  "blue"
]);

export const SPECIALIST_RUBRICS = Object.freeze(RUBRICS.filter(rubric => rubric !== "generalist"));
export const LORD_RUBRICS = Object.freeze(["horse_lord", "pike_lord", "archer_lord"]);
export const HUNTER_RUBRICS = Object.freeze(["horse_hunter", "pike_hunter", "archer_hunter"]);

const LORD_UNITS = Object.freeze({ horse_lord: "C", pike_lord: "P", archer_lord: "A" });
const HUNTER_UNITS = Object.freeze({ horse_hunter: "C", pike_hunter: "P", archer_hunter: "A" });

function resultForColor(row, color) {
  const winner = color === "red" ? "R" : "B";
  if (row.outcome === "draw" && (row.winner === "" || row.winner === null)) return "draw";
  if (row.outcome === "elimination" && ["R", "B"].includes(row.winner)) {
    return row.winner === winner ? "win" : "loss";
  }
  throw new Error(`Invalid ledger result: ${row.outcome} with winner ${row.winner}`);
}

/** Reach-style natural-elimination score.  More games never add an evidence bonus. */
export function baseGameScore(result, round, speedCoefficient = 0.5) {
  if (!Number.isFinite(speedCoefficient) || speedCoefficient < 0) throw new Error("Invalid speed coefficient");
  if (result === "draw") return 0;
  if (!Number.isInteger(round) || round < 1 || round > 20) throw new Error(`Invalid elimination round: ${round}`);
  const speed = speedCoefficient * (20 - round) / 19;
  if (result === "win") return 1 + speed;
  if (result === "loss") return -speed;
  throw new Error(`Unknown game result: ${result}`);
}

function sideValue(row, color, field) {
  const value = row[`${color}${field}`];
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${color}${field}`);
  return value;
}

function emptyRecord(id) {
  return {
    id,
    games: 0,
    redGames: 0,
    blueGames: 0,
    baseSum: 0,
    opponents: new Set(),
    redOpponents: new Set(),
    blueOpponents: new Set(),
    trained: { P: 0, A: 0, C: 0 },
    kills: { P: 0, A: 0, C: 0 },
    hunters: Object.fromEntries(HUNTER_RUBRICS.map(rubric => [rubric, {
      weightedScore: 0,
      weight: 0,
      weightSquared: 0,
      targetFractionSum: 0
    }]))
  };
}

function hunterWeight(row, color, targetUnit) {
  const opponent = color === "red" ? "blue" : "red";
  const total = sideValue(row, opponent, "P") + sideValue(row, opponent, "A") + sideValue(row, opponent, "C");
  const target = sideValue(row, opponent, targetUnit);
  const fraction = total === 0 ? 0 : target / total;
  return { fraction, weight: 1 + 5 * fraction };
}

function scoreLord(record, rubric, generalist) {
  if (generalist <= 0) return generalist;
  const unit = LORD_UNITS[rubric];
  const trainedTotal = record.trained.P + record.trained.A + record.trained.C;
  const killTotal = record.kills.P + record.kills.A + record.kills.C;
  const killShare = killTotal === 0 ? 0 : record.kills[unit] / killTotal;
  if (rubric === "pike_lord") {
    const pikesPerGame = record.games === 0 ? 0 : record.trained.P / record.games;
    return generalist * Math.sqrt(pikesPerGame) * Math.sqrt(killShare);
  }
  const recruitFraction = trainedTotal === 0 ? 0 : record.trained[unit] / trainedTotal;
  return generalist * recruitFraction * Math.sqrt(killShare);
}

/**
 * Score every contestant under all nine rubrics from the games actually played.
 * Hunter stakes depend on the enemy's target-unit recruitment ratio, not its count:
 *   w = 1 + 5q; H = sum(w * base) / sum(w).
 * Consequently target-heavy schedules do not themselves raise Hunter fitness; wins and
 * losses in target-heavy games simply matter more.
 */
export function buildRubricReport(rows) {
  const records = new Map();
  for (const row of rows) {
    for (const color of ["red", "blue"]) {
      const id = row[`${color}Id`];
      const opponentId = row[color === "red" ? "blueId" : "redId"];
      if (typeof id !== "string" || id === "" || typeof opponentId !== "string" || opponentId === "") {
        throw new Error("Ledger row contains an invalid contestant ID");
      }
      if (!records.has(id)) records.set(id, emptyRecord(id));
      const record = records.get(id);
      const base = baseGameScore(resultForColor(row, color), row.round);
      record.games += 1;
      record.baseSum += base;
      record.opponents.add(opponentId);
      record[`${color}Games`] += 1;
      record[`${color}Opponents`].add(opponentId);
      for (const unit of ["P", "A", "C"]) {
        record.trained[unit] += sideValue(row, color, unit);
        record.kills[unit] += sideValue(row, color, `KillBy${unit}`);
      }
      for (const rubric of HUNTER_RUBRICS) {
        const stake = hunterWeight(row, color, HUNTER_UNITS[rubric]);
        const hunter = record.hunters[rubric];
        hunter.weightedScore += stake.weight * base;
        hunter.weight += stake.weight;
        hunter.weightSquared += stake.weight * stake.weight;
        hunter.targetFractionSum += stake.fraction;
      }
    }
  }

  return new Map([...records].map(([id, record]) => {
    const generalist = record.games === 0 ? Number.NEGATIVE_INFINITY : record.baseSum / record.games;
    const redBase = rowsForColorScore(rows, id, "red");
    const blueBase = rowsForColorScore(rows, id, "blue");
    const scores = {
      generalist,
      horse_lord: scoreLord(record, "horse_lord", generalist),
      pike_lord: scoreLord(record, "pike_lord", generalist),
      archer_lord: scoreLord(record, "archer_lord", generalist),
      horse_hunter: hunterScore(record.hunters.horse_hunter),
      pike_hunter: hunterScore(record.hunters.pike_hunter),
      archer_hunter: hunterScore(record.hunters.archer_hunter),
      red: redBase,
      blue: blueBase
    };
    const hunterEvidence = Object.fromEntries(HUNTER_RUBRICS.map(rubric => {
      const hunter = record.hunters[rubric];
      const effectiveGames = hunter.weightSquared === 0 ? 0 : hunter.weight * hunter.weight / hunter.weightSquared;
      return [rubric, {
        totalStake: hunter.weight,
        effectiveGames,
        meanTargetFraction: record.games === 0 ? 0 : hunter.targetFractionSum / record.games
      }];
    }));
    return [id, {
      id,
      scores,
      evidence: {
        games: record.games,
        distinctOpponents: record.opponents.size,
        redGames: record.redGames,
        blueGames: record.blueGames,
        redOpponents: record.redOpponents.size,
        blueOpponents: record.blueOpponents.size,
        hunters: hunterEvidence
      },
      specialization: {
        trained: { ...record.trained },
        kills: { ...record.kills }
      }
    }];
  }));
}

function hunterScore(hunter) {
  return hunter.weight === 0 ? Number.NEGATIVE_INFINITY : hunter.weightedScore / hunter.weight;
}

function rowsForColorScore(rows, id, color) {
  let sum = 0;
  let games = 0;
  for (const row of rows) {
    if (row[`${color}Id`] !== id) continue;
    sum += baseGameScore(resultForColor(row, color), row.round);
    games += 1;
  }
  return games === 0 ? Number.NEGATIVE_INFINITY : sum / games;
}

export function rankRubric(report, rubric, ids = null) {
  if (!RUBRICS.includes(rubric) || !(report instanceof Map)) throw new Error("Invalid rubric ranking request");
  const allowed = ids === null ? null : new Set(ids);
  return [...report.values()]
    .filter(record => allowed === null || allowed.has(record.id))
    .filter(record => Number.isFinite(record.scores[rubric]))
    .sort((a, b) => b.scores[rubric] - a.scores[rubric] || a.id.localeCompare(b.id))
    .map((record, index) => ({ id: record.id, score: record.scores[rubric], rank: index + 1, evidence: record.evidence }));
}

/** Screening can nominate a contestant; certification is required before awards. */
export function isRubricCertified(record, rubric, {
  minimumOpponents = 160,
  populationSize = 343,
  fullRampage = false
} = {}) {
  if (!RUBRICS.includes(rubric) || record?.evidence === undefined) return false;
  const required = fullRampage ? populationSize - 1 : minimumOpponents;
  if (rubric === "red") return record.evidence.redOpponents >= required && record.evidence.redGames >= required;
  if (rubric === "blue") return record.evidence.blueOpponents >= required && record.evidence.blueGames >= required;
  return record.evidence.distinctOpponents >= required
    && record.evidence.redOpponents >= required
    && record.evidence.blueOpponents >= required;
}
