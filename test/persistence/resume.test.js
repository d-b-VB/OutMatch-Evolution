import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeCheckpointBoundary,
  buildProgressCheckpoint,
  normalizePersistedProgressRecord,
  restoreProgressCheckpoint,
  verifyResumeCompatibility
} from "../../src/persistence/resume.js";

const schedule = [
  { stage: "stage1", scheduleIndex: 0, redId: "red-0", blueId: "blue-0" },
  { stage: "stage1", scheduleIndex: 1, redId: "red-1", blueId: "blue-1" }
];

const identity = {
  runId: "run-one",
  parentGeneration: "ReachR29",
  parentFingerprint: "parent-fingerprint",
  targetGeneration: "ReachR30",
  controlsHash: "controls-hash",
  interventionsHash: "interventions-hash",
  breedingSeed: "seed",
  breedingPrngVersion: "splitmix64-v1"
};

function checkpoint(overrides = {}) {
  return buildProgressCheckpoint({
    ...identity,
    phase: "stage1_running",
    schedule,
    partialLedger: schedule.slice(0, 1),
    tentativeElites: ["elite-one"],
    challengerHistory: [],
    childCandidate: { population: [] },
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides
  });
}

test("progress builder snapshots live state at a safe between-games boundary", () => {
  const liveSchedule = structuredClone(schedule);
  const record = checkpoint({ schedule: liveSchedule, partialLedger: liveSchedule.slice(0, 1) });
  liveSchedule[0].redId = "mutated";
  assert.equal(record.cursor, 1);
  assert.equal(record.schedule[0].redId, "red-0");
  assert.equal(record.schema, "outmatch-run-progress-v1");
});

test("safe boundaries require the ledger to be the completed schedule prefix", () => {
  const record = checkpoint();
  assert.equal(assertSafeCheckpointBoundary(record), record);
  assert.throws(() => assertSafeCheckpointBoundary({ ...record, cursor: 2 }), /one ledger row/);
  const divergent = structuredClone(record);
  divergent.partialLedger[0].blueId = "other-blue";
  assert.throws(() => assertSafeCheckpointBoundary(divergent), /diverges/);
});

test("phase-specific boundaries reject mid-operation checkpoints", () => {
  assert.throws(() => checkpoint({ phase: "stage1_ranking" }), /completed schedule/);
  assert.throws(() => checkpoint({ phase: "breeding_migration" }), /cannot contain tournament work/);
  assert.doesNotThrow(() => checkpoint({
    phase: "stage1_ranking", partialLedger: schedule, cursor: schedule.length
  }));
});

test("resume compatibility freezes parent and deterministic controls", () => {
  const record = checkpoint();
  assert.equal(verifyResumeCompatibility(record, identity), record);
  for (const field of ["parentFingerprint", "controlsHash", "interventionsHash", "breedingSeed", "breedingPrngVersion"]) {
    assert.throws(() => verifyResumeCompatibility(record, { ...identity, [field]: "changed" }), new RegExp(field));
  }
});

test("restoration returns an independent resumable tournament state", () => {
  const record = checkpoint();
  const restored = restoreProgressCheckpoint(record, identity);
  assert.deepEqual(restored.schedule, record.schedule);
  assert.deepEqual(restored.partialLedger, record.partialLedger);
  assert.equal(restored.cursor, 1);
  restored.schedule[0].redId = "mutated";
  restored.childCandidate.population.push("child");
  assert.equal(record.schedule[0].redId, "red-0");
  assert.deepEqual(record.childCandidate.population, []);
});

test("legacy normalization refuses to invent active challenger history", () => {
  const active = checkpoint({
    phase: "challenger_running",
    schedule: [{ stage: "challenger", challengerIteration: 1, scheduleIndex: 2, redId: "red", blueId: "blue" }],
    partialLedger: [], cursor: 0
  });
  delete active.challengerHistory;
  assert.throws(() => normalizePersistedProgressRecord(active),
    /challengerHistory is missing for an active challenger schedule.*discard only the incomplete progress/);
});

test("legacy normalization reconstructs completed challenger iterations deterministically", () => {
  const completed = { ...checkpoint({ phase: "finalizing", schedule: [], partialLedger: [], cursor: 0 }),
    completedLedger: [{ stage: "challenger", challengerIteration: 1, scheduleIndex: 2, redId: "red", blueId: "blue" }] };
  delete completed.challengerHistory;
  const normalized = normalizePersistedProgressRecord(completed);
  assert.deepEqual(normalized.challengerHistory.map(item => ({
    iteration: item.iteration, completed: item.completed, resultCount: item.resultCount, recovered: item.recovered
  })), [{ iteration: 1, completed: true, resultCount: 1, recovered: true }]);
});
