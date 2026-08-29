import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeDurableTournament,
  runDurableTournamentStages
} from "../../src/persistence/durable-tournament.js";
import { buildProgressCheckpoint } from "../../src/persistence/resume.js";
import { PERSISTENCE_SCHEMAS } from "../../src/persistence/schema.js";

const identity = {
  runId: "run-one", parentGeneration: "ReachR29", parentFingerprint: "parent",
  targetGeneration: "ReachR30", controlsHash: "controls", interventionsHash: "interventions",
  breedingSeed: "seed", breedingPrngVersion: "splitmix64-v1"
};

const stage1 = [0, 1].map(scheduleIndex => ({
  stage: "stage1", scheduleIndex, redId: `s1-red-${scheduleIndex}`, blueId: `s1-blue-${scheduleIndex}`
}));
const stage2 = [2, 3].map(scheduleIndex => ({
  stage: "stage2", scheduleIndex, redId: `s2-red-${scheduleIndex}`, blueId: `s2-blue-${scheduleIndex}`
}));
const challenger = [4, 5].map(scheduleIndex => ({
  stage: "challenger", challengerIteration: 1, scheduleIndex,
  redId: `c-red-${scheduleIndex}`, blueId: `c-blue-${scheduleIndex}`
}));

function initial(overrides = {}) {
  return buildProgressCheckpoint({
    ...identity, phase: "stage1_running", schedule: stage1,
    updatedAt: "2026-01-01T00:00:00.000Z", ...overrides
  });
}

function hooks(saved, executed) {
  return {
    expected: identity,
    executeGame: async game => { executed.push(game.scheduleIndex); return game; },
    saveCheckpoint: async checkpoint => saved.push(structuredClone(checkpoint)),
    rankStage1: async rows => rows.map(row => `elite-${row.scheduleIndex}`),
    buildStage2Schedule: async elites => { assert.deepEqual(elites, ["elite-0", "elite-1"]); return stage2; },
    rankStage2: async rows => rows.map(row => row.scheduleIndex),
    planChallengerIteration: async (rows, iteration) => iteration === 1
      ? { challengers: [{ id: "challenger-one" }], schedule: challenger }
      : { challengers: [], schedule: [], rankings: rows.map(row => row.scheduleIndex) },
    checkpointInterval: 1,
    now: () => "2026-01-02T00:00:00.000Z"
  };
}

test("durable coordinator executes and persists Stage 1 and Stage 2 transitions", async () => {
  const saved = [];
  const executed = [];
  const result = await runDurableTournamentStages({ checkpoint: initial(), ...hooks(saved, executed) });
  assert.equal(result.status, "ready_to_finalize");
  assert.deepEqual(executed, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(result.rankings, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(result.checkpoint.completedLedger.map(row => row.scheduleIndex), [0, 1, 2, 3, 4, 5]);
  assert.equal(result.checkpoint.phase, "finalizing");
  assert.ok(saved.some(state => state.phase === "stage1_ranking"));
  assert.ok(saved.some(state => state.phase === "stage2_running"));
  assert.ok(saved.some(state => state.phase === "stage2_ranking"));
});

test("reopening at Stage 1 ranking does not replay Stage 1 games", async () => {
  const saved = [];
  const executed = [];
  const checkpoint = initial({ phase: "stage1_ranking", partialLedger: stage1, cursor: 2 });
  const result = await runDurableTournamentStages({ checkpoint, ...hooks(saved, executed) });
  assert.equal(result.status, "ready_to_finalize");
  assert.deepEqual(executed, [2, 3, 4, 5]);
});

test("pause returns the safely persisted running phase", async () => {
  const saved = [];
  const executed = [];
  const result = await runDurableTournamentStages({
    checkpoint: initial(), ...hooks(saved, executed), shouldPause: () => executed.length === 1
  });
  assert.equal(result.status, "paused");
  assert.equal(result.checkpoint.phase, "stage1_running");
  assert.equal(result.checkpoint.cursor, 1);
  assert.deepEqual(executed, [0]);
});

test("reopening a partially completed Stage 2 skips durable work", async () => {
  const saved = [];
  const executed = [];
  const checkpoint = initial({
    phase: "stage2_running", schedule: stage2, partialLedger: stage2.slice(0, 1), cursor: 1,
    completedLedger: stage1, tentativeElites: ["elite-0", "elite-1"]
  });
  const result = await runDurableTournamentStages({ checkpoint, ...hooks(saved, executed) });
  assert.deepEqual(executed, [3, 4, 5]);
  assert.deepEqual(result.rankings, [0, 1, 2, 3, 4, 5]);
});

test("pause and reopen during a challenger iteration skips durable games", async () => {
  const saved = [];
  const firstExecuted = [];
  const first = await runDurableTournamentStages({
    checkpoint: initial({
      phase: "challenger_running", schedule: [], completedLedger: [...stage1, ...stage2]
    }),
    ...hooks(saved, firstExecuted),
    shouldPause: () => firstExecuted.length === 1
  });
  assert.equal(first.status, "paused");
  assert.deepEqual(firstExecuted, [4]);
  assert.equal(first.checkpoint.cursor, 1);
  assert.equal(first.checkpoint.challengerHistory[0].completed, false);

  const reopenedExecuted = [];
  const reopened = await runDurableTournamentStages({
    checkpoint: first.checkpoint, ...hooks(saved, reopenedExecuted)
  });
  assert.equal(reopened.status, "ready_to_finalize");
  assert.deepEqual(reopenedExecuted, [5]);
  assert.equal(reopened.checkpoint.challengerHistory[0].completed, true);
  assert.equal(reopened.checkpoint.challengerHistory[0].resultCount, 2);
});

test("challenger cleanup rejects a non-progressing plan", async () => {
  const saved = [];
  const executed = [];
  await assert.rejects(runDurableTournamentStages({
    checkpoint: initial({
      phase: "challenger_running", schedule: [], completedLedger: [...stage1, ...stage2]
    }),
    ...hooks(saved, executed),
    planChallengerIteration: async () => ({ challengers: [{ id: "stuck" }], schedule: [] })
  }), /made no progress/);
});

test("coordinator rejects incompatible checkpoints before execution", async () => {
  const saved = [];
  const executed = [];
  await assert.rejects(runDurableTournamentStages({
    checkpoint: initial(), ...hooks(saved, executed), expected: { ...identity, controlsHash: "changed" }
  }), /controlsHash/);
  assert.deepEqual(executed, []);
  assert.deepEqual(saved, []);
});

function finalizationHooks(commits) {
  return {
    rankFinal: async rows => rows.map(row => ({ id: row.redId, fitness: row.scheduleIndex })),
    buildReports: async ({ ledger, rankings }) => ({ games: ledger.length, ranked: rankings.length }),
    buildLedgerRecord: async ({ checkpoint, ledger }) => ({
      schema: PERSISTENCE_SCHEMAS.ledger,
      runId: checkpoint.runId,
      generation: checkpoint.targetGeneration,
      ledgerId: "ledger-r30",
      rows: ledger
    }),
    buildGenerationRecord: async ({ checkpoint, rankings, reports, ledgerRecord }) => ({
      schema: PERSISTENCE_SCHEMAS.generation,
      runId: checkpoint.runId,
      generation: checkpoint.targetGeneration,
      parentGeneration: checkpoint.parentGeneration,
      completedAt: "2026-01-03T00:00:00.000Z",
      fingerprint: "fingerprint-r30",
      ledgerRef: ledgerRecord.ledgerId,
      checkpoint: checkpoint.childCandidate ?? { population: [] },
      rankings,
      interventions: [],
      manifest: {}, controls: {}, migration: {}, breeding: {}, reports
    }),
    commitCompletedGeneration: async (database, generation, ledger) => {
      commits.push({ database, generation: structuredClone(generation), ledger: structuredClone(ledger) });
      return { generation, ledger };
    }
  };
}

test("finalization rebuilds rankings and reports before one atomic commit", async () => {
  const commits = [];
  const checkpoint = initial({
    phase: "finalizing", schedule: [], completedLedger: [...stage1, ...stage2, ...challenger]
  });
  const database = { name: "database" };
  const result = await finalizeDurableTournament({
    database, checkpoint, expected: identity, ...finalizationHooks(commits)
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.reports, { games: 6, ranked: 6 });
  assert.equal(result.generation.ledgerRef, "ledger-r30");
  assert.equal(result.ledger.rows.length, 6);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].database, database);
});

test("finalization rejects the wrong phase and altered ledger records", async () => {
  const commits = [];
  await assert.rejects(finalizeDurableTournament({
    database: {}, checkpoint: initial(), expected: identity, ...finalizationHooks(commits)
  }), /not ready/);

  const checkpoint = initial({ phase: "finalizing", schedule: [], completedLedger: stage1 });
  await assert.rejects(finalizeDurableTournament({
    database: {}, checkpoint, expected: identity, ...finalizationHooks(commits),
    buildLedgerRecord: async () => ({
      schema: PERSISTENCE_SCHEMAS.ledger, runId: "run-one", generation: "ReachR30",
      ledgerId: "ledger-r30", rows: []
    })
  }), /does not preserve/);
  assert.equal(commits.length, 0);
});

test("pause, reopen, resume, challenge, and finalize preserve one canonical ledger", async () => {
  const saved = [];
  const firstExecuted = [];
  const paused = await runDurableTournamentStages({
    checkpoint: initial(), ...hooks(saved, firstExecuted), shouldPause: () => firstExecuted.length === 1
  });
  assert.equal(paused.status, "paused");

  const reopenedExecuted = [];
  const resumed = await runDurableTournamentStages({
    checkpoint: structuredClone(saved.at(-1)), ...hooks(saved, reopenedExecuted)
  });
  assert.equal(resumed.status, "ready_to_finalize");
  assert.deepEqual([...firstExecuted, ...reopenedExecuted], [0, 1, 2, 3, 4, 5]);

  const commits = [];
  const finalized = await finalizeDurableTournament({
    database: { name: "reopened-database" }, checkpoint: resumed.checkpoint,
    expected: identity, ...finalizationHooks(commits)
  });
  assert.equal(finalized.status, "complete");
  assert.deepEqual(finalized.ledger.rows.map(row => row.scheduleIndex), [0, 1, 2, 3, 4, 5]);
  assert.equal(commits.length, 1);
});
