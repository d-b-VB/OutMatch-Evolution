import { RUBRICS, SPECIALIST_RUBRICS } from "./rubrics.js";

export function coloredGameKey(redId, blueId) {
  if (typeof redId !== "string" || typeof blueId !== "string" || redId === blueId) throw new Error("Invalid colored game key");
  return `${redId}\u0000${blueId}`;
}

function completedKeys(rows) {
  return new Set(rows.map(row => coloredGameKey(row.redId, row.blueId)));
}

/** Two-color round robin inside each of the seven random 49-person screening groups. */
export function buildScreeningSchedule(groups, startIndex = 0) {
  const schedule = [];
  let scheduleIndex = startIndex;
  for (let group = 0; group < groups.length; group += 1) {
    const ids = groups[group];
    for (let first = 0; first < ids.length; first += 1) {
      for (let second = first + 1; second < ids.length; second += 1) {
        schedule.push({ redId: ids[first], blueId: ids[second], stage: "screening", group, scheduleIndex: scheduleIndex++ });
        schedule.push({ redId: ids[second], blueId: ids[first], stage: "screening", group, scheduleIndex: scheduleIndex++ });
      }
    }
  }
  return schedule;
}

/** Complete the 161-person two-color elite round robin, skipping every colored game already in the ledger. */
export function buildEliteSchedule(eliteIds, priorRows, startIndex = 0) {
  const done = completedKeys(priorRows);
  const schedule = [];
  let scheduleIndex = startIndex;
  for (let first = 0; first < eliteIds.length; first += 1) {
    for (let second = first + 1; second < eliteIds.length; second += 1) {
      for (const [redId, blueId] of [[eliteIds[first], eliteIds[second]], [eliteIds[second], eliteIds[first]]]) {
        if (done.has(coloredGameKey(redId, blueId))) continue;
        schedule.push({ redId, blueId, stage: "elite", scheduleIndex: scheduleIndex++ });
      }
    }
  }
  return schedule;
}

/**
 * Build missing games for rubric-specific testing.  Red and Blue candidates only play
 * the indicated color unless some other rubric independently requires the reciprocal.
 */
export function buildCandidateTestingSchedule({
  requests,
  populationIds,
  priorRows,
  startIndex = 0,
  stage = "certification"
}) {
  if (!Array.isArray(requests) || !Array.isArray(populationIds) || !Array.isArray(priorRows)) throw new Error("Invalid candidate testing request");
  const done = completedKeys(priorRows);
  const planned = new Set();
  const schedule = [];
  let scheduleIndex = startIndex;
  const add = (redId, blueId, rubric, candidateId) => {
    if (redId === blueId) return;
    const key = coloredGameKey(redId, blueId);
    if (done.has(key) || planned.has(key)) return;
    planned.add(key);
    schedule.push({ redId, blueId, stage, rubric, candidateId, scheduleIndex: scheduleIndex++ });
  };

  for (const request of requests) {
    const { id, rubric } = request;
    if (!populationIds.includes(id) || !RUBRICS.includes(rubric)) throw new Error("Unknown certification contestant or rubric");
    for (const opponentId of populationIds) {
      if (opponentId === id) continue;
      if (rubric === "red") add(id, opponentId, rubric, id);
      else if (rubric === "blue") add(opponentId, id, rubric, id);
      else {
        add(id, opponentId, rubric, id);
        add(opponentId, id, rubric, id);
      }
    }
  }
  return schedule;
}

/** Initial rampage: top three Generalists and the champion of every specialty. */
export function buildInitialRampageRequests(rankings) {
  const requests = [];
  for (const entry of (rankings.generalist ?? []).slice(0, 3)) requests.push({ id: entry.id, rubric: "generalist" });
  for (const rubric of SPECIALIST_RUBRICS) {
    const champion = rankings[rubric]?.[0];
    if (champion !== undefined) requests.push({ id: champion.id, rubric });
  }
  return requests;
}

/**
 * An uncertified contestant may look good enough to enter a reward range, but that
 * provisional rank only earns further games.  Returns the next rubric-specific auditions.
 */
export function findRewardCertificationRequests(rankings, report, isCertified, {
  generalistSurvivors = 14,
  specialistSurvivors = 4
} = {}) {
  if (typeof isCertified !== "function") throw new Error("Certification predicate is required");
  const requests = [];
  const seen = new Set();
  for (const rubric of RUBRICS) {
    const cutoff = rubric === "generalist" ? generalistSurvivors : specialistSurvivors;
    for (const entry of (rankings[rubric] ?? []).slice(0, cutoff)) {
      const record = report.get(entry.id);
      if (record !== undefined && !isCertified(record, rubric)) {
        const key = `${entry.id}\u0000${rubric}`;
        if (!seen.has(key)) {
          seen.add(key);
          requests.push({ id: entry.id, rubric });
        }
      }
    }
  }
  return requests;
}

/** Rank-map helper used after every added testing tranche. */
export function buildRankingMap(report, rankRubric) {
  return Object.fromEntries(RUBRICS.map(rubric => [rubric, rankRubric(report, rubric)]));
}
