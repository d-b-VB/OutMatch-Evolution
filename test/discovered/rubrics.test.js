import test from "node:test";
import assert from "node:assert/strict";
import { baseGameScore, buildRubricReport } from "../../src/discovered/rubrics.js";
import { buildScreeningSchedule, buildCandidateTestingSchedule } from "../../src/discovered/schedule.js";
import { planGuaranteedAwards } from "../../src/discovered/breeding.js";

function row({ redId = "r", blueId = "b", winner = "R", round = 10, red = {}, blue = {} } = {}) {
  const unitFields = side => ({
    P: side.P ?? 0, A: side.A ?? 0, C: side.C ?? 0,
    KillByP: side.KillByP ?? 0, KillByA: side.KillByA ?? 0, KillByC: side.KillByC ?? 0
  });
  const fields = {};
  for (const [name, value] of Object.entries(unitFields(red))) fields[`red${name}`] = value;
  for (const [name, value] of Object.entries(unitFields(blue))) fields[`blue${name}`] = value;
  return { redId, blueId, outcome: winner ? "elimination" : "draw", winner: winner ?? "", round, ...fields };
}

test("base score preserves Reach elimination-speed rule", () => {
  assert.equal(baseGameScore("win", 1), 1.5);
  assert.equal(baseGameScore("win", 20), 1);
  assert.equal(baseGameScore("loss", 1), -0.5);
  assert.equal(baseGameScore("loss", 20), 0);
  assert.equal(baseGameScore("draw", 20), 0);
});

test("hunter prevalence changes stakes, not the scale by itself", () => {
  const rows = [
    row({ redId: "hunter", blueId: "allHorse", red: { A: 1 }, blue: { C: 4 }, winner: "R" }),
    row({ redId: "hunter", blueId: "noHorse", red: { A: 1 }, blue: { A: 4 }, winner: "B" })
  ];
  const report = buildRubricReport(rows).get("hunter");
  const win = baseGameScore("win", 10);
  const loss = baseGameScore("loss", 10);
  assert.equal(report.scores.horse_hunter, (6 * win + loss) / 7);
  assert.equal(report.evidence.hunters.horse_hunter.totalStake, 7);
});

test("quick all-target recruitment receives maximum hunter stake", () => {
  const report = buildRubricReport([
    row({ redId: "hunter", blueId: "prey", round: 1, red: { A: 1 }, blue: { C: 1 }, winner: "R" })
  ]).get("hunter");
  assert.equal(report.evidence.hunters.horse_hunter.meanTargetFraction, 1);
  assert.equal(report.evidence.hunters.horse_hunter.totalStake, 6);
});

test("seven 49-person screening groups schedule 16,464 colored games", () => {
  const groups = Array.from({ length: 7 }, (_, group) => Array.from({ length: 49 }, (_, index) => `g${group}_${index}`));
  assert.equal(buildScreeningSchedule(groups).length, 16464);
});

test("red-only certification contender is not scheduled as blue", () => {
  const ids = ["candidate", "a", "b"];
  const schedule = buildCandidateTestingSchedule({ requests: [{ id: "candidate", rubric: "red" }], populationIds: ids, priorRows: [] });
  assert.deepEqual(schedule.map(game => [game.redId, game.blueId]), [["candidate", "a"], ["candidate", "b"]]);
});

test("guaranteed awards total 35 and stack by rubric", () => {
  const make = count => Array.from({ length: count }, (_, index) => ({ id: `x${index + 1}`, rank: index + 1 }));
  const rankings = {
    generalist: make(14),
    horse_lord: make(4), pike_lord: make(4), archer_lord: make(4),
    horse_hunter: make(4), pike_hunter: make(4), archer_hunter: make(4),
    red: make(4), blue: make(4)
  };
  const awards = planGuaranteedAwards(rankings);
  assert.equal(awards.length, 35);
  assert.equal(awards.filter(award => award.rubric === "generalist" && award.fatherId === "x1").length, 3);
  assert.equal(awards.filter(award => award.rubric === "horse_lord" && award.fatherId === "x1").length, 2);
});
