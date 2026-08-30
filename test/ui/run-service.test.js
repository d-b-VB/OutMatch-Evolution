import assert from "node:assert/strict";
import test from "node:test";
import { PERSISTENCE_SCHEMAS } from "../../src/persistence/schema.js";
import { BrowserRunService, buildInitialRunProgress } from "../../src/ui/run-service.js";

const parent = { generation: "ReachR29", fingerprint: "parent-fingerprint" };
const controlReview = {
  controls: { workerCount: 2 },
  controlsHash: "controls-hash",
  interventionsHash: "interventions-hash",
  interventions: { parentGeneration: "ReachR29", operations: [] }
};
const games = [0, 1].map(scheduleIndex => ({
  stage: "stage1_core", scheduleIndex, redId: `red-${scheduleIndex}`, blueId: `blue-${scheduleIndex}`,
  challengerIteration: null
}));

class MemoryProgress {
  constructor(record = null) { this.record = record; this.saves = []; }
  async get() { return this.record && structuredClone(this.record); }
  async save(record) { this.record = structuredClone(record); this.saves.push(this.record); return record; }
}

function prepared(commits) {
  return {
    childCandidate: { population: [{ id: "child" }], fingerprint: "child-fingerprint" },
    stage1Schedule: games,
    genomes: games.flatMap(game => [game.redId, game.blueId]).map(id => ({ id, genes: {} })),
    workerCount: 2,
    tournamentHooks: {
      rankStage1: rows => rows,
      buildStage2Schedule: () => [],
      rankStage2: rows => rows,
      planChallengerIteration: rows => ({ challengers: [], schedule: [], rankings: rows })
    },
    finalizationHooks: {
      rankFinal: rows => rows,
      buildReports: ({ ledger }) => ({ games: ledger.length }),
      buildLedgerRecord: ({ checkpoint, ledger }) => ({
        schema: PERSISTENCE_SCHEMAS.ledger, runId: checkpoint.runId,
        generation: checkpoint.targetGeneration, ledgerId: `${checkpoint.runId}:ledger`, rows: ledger
      }),
      buildGenerationRecord: ({ checkpoint, rankings, reports, ledgerRecord }) => ({
        schema: PERSISTENCE_SCHEMAS.generation, runId: checkpoint.runId,
        generation: checkpoint.targetGeneration, parentGeneration: checkpoint.parentGeneration,
        completedAt: "2026-08-29T00:00:00.000Z", fingerprint: checkpoint.childCandidate.fingerprint,
        ledgerRef: ledgerRecord.ledgerId, checkpoint: checkpoint.childCandidate, rankings,
        interventions: [], manifest: {}, controls: {}, migration: {}, breeding: {}, reports
      }),
      commitCompletedGeneration: async (database, generation, ledger) => {
        commits.push({ database, generation, ledger });
        return { generation, ledger };
      }
    }
  };
}

function workerSchedule({ schedule }) {
  return Promise.resolve(schedule.map(game => ({ ...game, outcome: "draw" })));
}

function service(progress, context, overrides = {}) {
  return new BrowserRunService({
    database: { name: "test" }, progressRepository: progress,
    prepareGeneration: async () => context, workerSchedule,
    now: () => "2026-08-29T00:00:00.000Z", ...overrides
  });
}

test("initial progress binds reviewed controls, intervention document, seed, and PRNG", () => {
  const progress = buildInitialRunProgress({
    runId: "run-one", parent, controlReview, breedingSeed: "seed-one",
    childCandidate: { population: [] }, stage1Schedule: games,
    now: () => "2026-08-29T00:00:00.000Z"
  });
  assert.equal(progress.targetGeneration, "ReachR30");
  assert.equal(progress.controlsHash, "controls-hash");
  assert.equal(progress.interventionsHash, "interventions-hash");
  assert.equal(progress.breedingSeed, "seed-one");
  assert.equal(progress.breedingPrngVersion, "splitmix64-v1");
  assert.throws(() => buildInitialRunProgress({
    runId: "run-one", parent, controlReview: { ...controlReview, interventions: { parentGeneration: "ReachR28" } },
    breedingSeed: "seed", childCandidate: {}, stage1Schedule: []
  }), /not bound/);
});

test("browser run service completes a reduced generation through one final commit", async () => {
  const commits = [];
  const checkpoints = [];
  const progress = new MemoryProgress();
  const result = await service(progress, prepared(commits), {
    onCheckpoint: checkpoint => checkpoints.push(checkpoint)
  }).start({
    runId: "run-one", parent, controlReview, breedingSeed: "seed-one"
  });
  assert.equal(result.status, "complete");
  assert.equal(commits.length, 1);
  assert.deepEqual(result.ledger.rows.map(row => row.scheduleIndex), [0, 1]);
  assert.equal(result.generation.fingerprint, "child-fingerprint");
  assert.ok(progress.saves.some(record => record.phase === "finalizing"));
  assert.ok(checkpoints.length > 1);
  assert.equal(checkpoints.at(-1).phase, "finalizing");
});

test("pause, reopen, and resume preserves ledger and child fingerprint", async () => {
  const commits = [];
  const progress = new MemoryProgress();
  const context = prepared(commits);
  let calls = 0;
  let firstService;
  const pausingWorker = async options => {
    const rows = await workerSchedule(options);
    calls += 1;
    if (calls === 1) firstService.requestPause();
    return rows;
  };
  firstService = service(progress, context, { workerSchedule: pausingWorker });
  const paused = await firstService.start({ runId: "run-one", parent, controlReview, breedingSeed: "seed-one" });
  assert.equal(paused.status, "paused");
  assert.equal(progress.record.cursor, 1);

  const reopened = service(progress, context);
  const resumed = await reopened.resume({ runId: "run-one", prepared: context });
  assert.deepEqual(resumed.ledger.rows.map(row => row.scheduleIndex), [0, 1]);
  assert.equal(resumed.generation.fingerprint, "child-fingerprint");
  assert.equal(commits.length, 1);
});

test("a fresh service restores deterministic hooks from the durable checkpoint", async () => {
  const commits = [];
  const progress = new MemoryProgress();
  const context = prepared(commits);
  let firstService;
  let calls = 0;
  firstService = service(progress, context, { workerSchedule: async options => {
    const rows = await workerSchedule(options);
    calls += 1;
    if (calls === 1) firstService.requestPause();
    return rows;
  } });
  await firstService.start({ runId: "run-one", parent, controlReview, breedingSeed: "seed-one" });

  const restored = [];
  const reopened = service(progress, null, {
    prepareGeneration: async () => { throw new Error("start preparer must not run during resume"); },
    restoreGeneration: async checkpoint => { restored.push(checkpoint); return context; }
  });
  const result = await reopened.resume({ runId: "run-one" });
  assert.equal(result.status, "complete");
  assert.equal(restored.length, 1);
  assert.equal(restored[0].cursor, 1);
  assert.equal(commits.length, 1);
});

test("reload restoration rejects a different child candidate", async () => {
  const progress = new MemoryProgress(buildInitialRunProgress({
    runId: "run-one", parent, controlReview, breedingSeed: "seed-one",
    childCandidate: { population: [], fingerprint: "expected" }, stage1Schedule: games,
    now: () => "2026-08-29T00:00:00.000Z"
  }));
  const reopened = service(progress, null, {
    restoreGeneration: async () => ({ ...prepared([]), childCandidate: { population: [], fingerprint: "different" } })
  });
  await assert.rejects(reopened.resume({ runId: "run-one" }), /does not match durable progress/);
});

test("start guards reviewed inputs and existing progress", async () => {
  const context = prepared([]);
  await assert.rejects(service(new MemoryProgress({ runId: "existing" }), context).start({
    runId: "run-one", parent, controlReview, breedingSeed: "seed"
  }), /already has durable progress/);
  await assert.rejects(service(new MemoryProgress(), context).start({
    runId: "run-one", parent, controlReview: null, breedingSeed: "seed"
  }), /reviewed/);
});
