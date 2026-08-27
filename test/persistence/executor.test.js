import assert from "node:assert/strict";
import test from "node:test";
import { executeResumableSchedule, ResumableExecutionError } from "../../src/persistence/executor.js";
import { buildProgressCheckpoint } from "../../src/persistence/resume.js";

const schedule = Array.from({ length: 5 }, (_, scheduleIndex) => ({
  stage: "stage1",
  scheduleIndex,
  redId: `red-${scheduleIndex}`,
  blueId: `blue-${scheduleIndex}`
}));

function checkpoint(cursor = 0) {
  return buildProgressCheckpoint({
    runId: "run-one",
    parentGeneration: "ReachR29",
    parentFingerprint: "parent-fingerprint",
    targetGeneration: "ReachR30",
    controlsHash: "controls-hash",
    interventionsHash: "interventions-hash",
    breedingSeed: "seed",
    breedingPrngVersion: "splitmix64-v1",
    phase: "stage1_running",
    schedule,
    partialLedger: schedule.slice(0, cursor),
    updatedAt: "2026-03-01T00:00:00.000Z"
  });
}

test("resumed execution skips completed games and preserves canonical order", async () => {
  const executed = [];
  const result = await executeResumableSchedule({
    checkpoint: checkpoint(2),
    executeGame: async game => { executed.push(game.scheduleIndex); return game; },
    saveCheckpoint: async () => {},
    checkpointInterval: 2
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(executed, [2, 3, 4]);
  assert.deepEqual(result.checkpoint.partialLedger.map(row => row.scheduleIndex), [0, 1, 2, 3, 4]);
});

test("configurable intervals persist committed schedule prefixes", async () => {
  const saved = [];
  await executeResumableSchedule({
    checkpoint: checkpoint(),
    executeGame: async game => game,
    saveCheckpoint: async state => saved.push(state),
    checkpointInterval: 2,
    now: () => "2026-03-02T00:00:00.000Z"
  });
  assert.deepEqual(saved.map(state => state.cursor), [2, 4, 5]);
  assert.ok(saved.every(state => state.partialLedger.length === state.cursor));
  assert.ok(saved.every(state => state.updatedAt === "2026-03-02T00:00:00.000Z"));
});

test("pause requests persist immediately without starting another game", async () => {
  const saved = [];
  let completed = 0;
  const result = await executeResumableSchedule({
    checkpoint: checkpoint(),
    executeGame: async game => { completed += 1; return game; },
    saveCheckpoint: async state => saved.push(state.cursor),
    checkpointInterval: 5,
    shouldPause: () => completed === 2
  });
  assert.equal(result.status, "paused");
  assert.equal(result.checkpoint.cursor, 2);
  assert.deepEqual(saved, [2]);
});

test("an already-requested pause checkpoints without replaying work", async () => {
  let executions = 0;
  const saved = [];
  const result = await executeResumableSchedule({
    checkpoint: checkpoint(3),
    executeGame: async game => { executions += 1; return game; },
    saveCheckpoint: async state => saved.push(state.cursor),
    shouldPause: () => true
  });
  assert.equal(result.status, "paused");
  assert.equal(executions, 0);
  assert.deepEqual(saved, [3]);
});

test("mismatched results never advance or persist the checkpoint", async () => {
  const original = checkpoint(1);
  let saves = 0;
  await assert.rejects(executeResumableSchedule({
    checkpoint: original,
    executeGame: async game => ({ ...game, blueId: "wrong-blue" }),
    saveCheckpoint: async () => { saves += 1; }
  }), /does not match/);
  assert.equal(original.cursor, 1);
  assert.equal(original.partialLedger.length, 1);
  assert.equal(saves, 0);
});

test("transient checkpoint failures retry within a strict bound", async () => {
  let attempts = 0;
  const result = await executeResumableSchedule({
    checkpoint: checkpoint(4),
    executeGame: async game => game,
    saveCheckpoint: async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("temporarily unavailable");
        error.name = "AbortError";
        throw error;
      }
    },
    checkpointRetries: 2
  });
  assert.equal(result.status, "complete");
  assert.equal(attempts, 3);
});

test("checkpoint failures expose the last safely committed cursor", async () => {
  let attempts = 0;
  await assert.rejects(executeResumableSchedule({
    checkpoint: checkpoint(1),
    executeGame: async game => game,
    saveCheckpoint: async () => {
      attempts += 1;
      const error = new Error("database aborted");
      error.name = "AbortError";
      throw error;
    },
    checkpointRetries: 1
  }), error => {
    assert.ok(error instanceof ResumableExecutionError);
    assert.equal(error.kind, "checkpoint");
    assert.equal(error.safeCursor, 1);
    assert.equal(error.cause.name, "AbortError");
    return true;
  });
  assert.equal(attempts, 2);
});

test("execution failures are distinct and retain the durable cursor", async () => {
  await assert.rejects(executeResumableSchedule({
    checkpoint: checkpoint(2),
    executeGame: async () => { throw new Error("worker crashed"); },
    saveCheckpoint: async () => {}
  }), error => {
    assert.equal(error.kind, "execution");
    assert.equal(error.safeCursor, 2);
    assert.match(error.cause.message, /worker crashed/);
    return true;
  });
});

test("a fresh executor recovers from the last durable checkpoint", async () => {
  let durable;
  let firstCompleted = 0;
  const first = await executeResumableSchedule({
    checkpoint: checkpoint(),
    executeGame: async game => { firstCompleted += 1; return game; },
    saveCheckpoint: async state => { durable = structuredClone(state); },
    checkpointInterval: 5,
    shouldPause: () => firstCompleted === 2
  });
  assert.equal(first.status, "paused");

  const reopenedExecutions = [];
  const reopened = await executeResumableSchedule({
    checkpoint: structuredClone(durable),
    executeGame: async game => { reopenedExecutions.push(game.scheduleIndex); return game; },
    saveCheckpoint: async state => { durable = structuredClone(state); },
    checkpointInterval: 2
  });
  assert.equal(reopened.status, "complete");
  assert.deepEqual(reopenedExecutions, [2, 3, 4]);
  assert.equal(durable.cursor, 5);
});
