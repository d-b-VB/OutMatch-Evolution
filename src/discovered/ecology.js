import { SplitMix64 } from "../evolution/prng.js";
import { buildRubricReport, isRubricCertified, rankRubric, SPECIALIST_RUBRICS } from "./rubrics.js";
import {
  buildEliteTestingCohort,
  buildRandomScreeningGroups,
  selectGeneralistCohort,
  selectNonOverlappingSpecialistCohorts
} from "./cohorts.js";
import {
  buildCandidateTestingSchedule,
  buildEliteSchedule,
  buildInitialRampageRequests,
  buildRankingMap,
  buildScreeningSchedule,
  findRewardCertificationRequests
} from "./schedule.js";

function validateResults(schedule, rows) {
  if (!Array.isArray(rows) || rows.length !== schedule.length) throw new Error("Schedule executor returned the wrong number of games");
  for (let index = 0; index < schedule.length; index += 1) {
    if (rows[index].redId !== schedule[index].redId || rows[index].blueId !== schedule[index].blueId) {
      throw new Error(`Schedule/result mismatch at ${index}`);
    }
  }
  return rows;
}

async function execute(schedule, executeSchedule) {
  if (schedule.length === 0) return [];
  return validateResults(schedule, await executeSchedule(schedule));
}

function cohortRubrics(generalists, specialists) {
  const map = new Map(generalists.map(id => [id, "generalist"]));
  for (const rubric of SPECIALIST_RUBRICS) for (const id of specialists[rubric]) map.set(id, rubric);
  return map;
}

/**
 * Run the complete discovered-niche tournament. Screening scores nominate contestants;
 * only contestants with substantial elite/rampage exposure may occupy reward positions.
 */
export async function runDiscoveredEcology({
  genomes,
  executeSchedule,
  groupingSeed = "1",
  maximumCertificationRounds = 343
}) {
  if (!Array.isArray(genomes) || genomes.length !== 343 || typeof executeSchedule !== "function") {
    throw new Error("Discovered ecology requires exactly 343 genomes and a schedule executor");
  }
  if (new Set(genomes.map(genome => genome.id)).size !== 343) throw new Error("Discovered ecology contains duplicate IDs");
  const random = new SplitMix64(groupingSeed);
  const populationIds = genomes.map(genome => genome.id);

  const groups = buildRandomScreeningGroups(genomes, random);
  const screeningSchedule = buildScreeningSchedule(groups);
  const screeningRows = await execute(screeningSchedule, executeSchedule);
  let rows = [...screeningRows];
  let report = buildRubricReport(rows);

  const generalists = selectGeneralistCohort(report, groups);
  const specialists = selectNonOverlappingSpecialistCohorts(report, groups, generalists);
  const eliteIds = buildEliteTestingCohort(generalists, specialists);
  const rubricById = cohortRubrics(generalists, specialists);
  const eliteSchedule = buildEliteSchedule(eliteIds, rows, screeningSchedule.length, rubricById);
  const eliteRows = await execute(eliteSchedule, executeSchedule);
  rows.push(...eliteRows);
  report = buildRubricReport(rows);
  let rankings = buildRankingMap(report, rankRubric);

  const rampageRequests = buildInitialRampageRequests(rankings);
  const rampageSchedule = buildCandidateTestingSchedule({
    requests: rampageRequests,
    populationIds,
    priorRows: rows,
    startIndex: screeningSchedule.length + eliteSchedule.length,
    stage: "rampage"
  });
  const rampageRows = await execute(rampageSchedule, executeSchedule);
  rows.push(...rampageRows);

  const certificationHistory = [];
  for (let round = 1; round <= maximumCertificationRounds; round += 1) {
    report = buildRubricReport(rows);
    rankings = buildRankingMap(report, rankRubric);
    const requests = findRewardCertificationRequests(rankings, report, isRubricCertified);
    if (requests.length === 0) break;
    const schedule = buildCandidateTestingSchedule({
      requests,
      populationIds,
      priorRows: rows,
      startIndex: screeningSchedule.length + eliteSchedule.length + rampageSchedule.length
        + certificationHistory.reduce((sum, item) => sum + item.schedule.length, 0),
      stage: "challenger"
    });
    if (schedule.length === 0) throw new Error("Uncertified reward contender has no missing certification games");
    const added = await execute(schedule, executeSchedule);
    rows.push(...added);
    certificationHistory.push({ round, requests, schedule });
    if (round === maximumCertificationRounds) throw new Error("Certification cleanup did not converge");
  }

  report = buildRubricReport(rows);
  rankings = buildRankingMap(report, rankRubric);
  const uncertifiedRewards = findRewardCertificationRequests(rankings, report, isRubricCertified);
  if (uncertifiedRewards.length !== 0) throw new Error("Tournament ended with uncertified reward positions");

  return {
    rows,
    report,
    rankings,
    groups,
    cohorts: { generalists, specialists, eliteIds },
    schedules: {
      screening: screeningSchedule,
      elite: eliteSchedule,
      rampage: rampageSchedule,
      certification: certificationHistory
    }
  };
}
