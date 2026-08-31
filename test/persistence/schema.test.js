import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDurableData,
  DATABASE_NAME,
  DATABASE_VERSION,
  PERSISTENCE_SCHEMAS,
  STORE_NAMES,
  validateCompletedGenerationRecord,
  validateCombatCacheRecord,
  validateLedgerRecord,
  validateIncrementalRunProgressRecord,
  validateRunProgressRecord,
  validateRunRecord,
  validateSettingsRecord
} from "../../src/persistence/schema.js";

const timestamp = "2026-08-27T12:00:00.000Z";

test("persistence constants freeze the version-two database layout", () => {
  assert.equal(DATABASE_NAME, "outmatch-reach");
  assert.equal(DATABASE_VERSION, 2);
  assert.deepEqual(Object.values(STORE_NAMES), ["runs", "generations", "ledgers", "run_progress", "settings", "replays", "combat_cache"]);
  assert.ok(Object.isFrozen(STORE_NAMES));
});

test("completed generations require checkpoint, rankings, controls, summaries, and ledger reference", () => {
  const record = {
    schema: PERSISTENCE_SCHEMAS.generation,
    runId: "run-1", generation: "ReachR30", parentGeneration: "ReachR29", completedAt: timestamp,
    fingerprint: "fnv1a64:abc", ledgerRef: "run-1:ReachR30", manifest: {},
    checkpoint: { population: [] }, rankings: [], controls: {}, interventions: [],
    migration: {}, breeding: {}, reports: {}
  };
  assert.deepEqual(validateCompletedGenerationRecord(structuredClone(record)), record);
  assert.throws(() => validateCompletedGenerationRecord({ ...record, ledgerRef: "" }), /ledgerRef/);
  assert.throws(() => validateCompletedGenerationRecord({ ...record, rankings: null }), /missing required/);
});

test("ledger records reject duplicate scheduled games while allowing stage-local indexes", () => {
  const row = { stage: "stage1_core", scheduleIndex: 0, redId: "a", blueId: "b" };
  const record = {
    schema: PERSISTENCE_SCHEMAS.ledger, runId: "run-1", generation: "ReachR30",
    ledgerId: "run-1:ReachR30", rows: [row, { ...row, stage: "stage2_elite" }]
  };
  assert.doesNotThrow(() => validateLedgerRecord(record));
  assert.throws(() => validateLedgerRecord({ ...record, rows: [row, { ...row }] }), /duplicate scheduled game/);
});

test("progress records preserve deterministic resume inputs and bounded cursor", () => {
  const schedule = [{ stage: "stage1_core", scheduleIndex: 0, redId: "a", blueId: "b" }];
  const record = {
    schema: PERSISTENCE_SCHEMAS.progress,
    runId: "run-1", parentGeneration: "ReachR29", parentFingerprint: "parent-fingerprint",
    targetGeneration: "ReachR30", controlsHash: "controls", interventionsHash: "interventions",
    breedingSeed: "202608231656", breedingPrngVersion: "splitmix64-v1", updatedAt: timestamp,
    phase: "stage1_running", schedule, cursor: 1, partialLedger: schedule,
    completedLedger: [],
    tentativeElites: [], challengerHistory: [], childCandidate: null
  };
  assert.doesNotThrow(() => validateRunProgressRecord(structuredClone(record)));
  assert.throws(() => validateRunProgressRecord({ ...record, cursor: 2 }), /outside its schedule/);
  assert.throws(() => validateRunProgressRecord({ ...record, phase: "unknown" }), /unknown phase/);
  for (const field of ["completedLedger", "tentativeElites", "challengerHistory", "childCandidate"]) {
    const incomplete = structuredClone(record); delete incomplete[field];
    assert.throws(() => validateRunProgressRecord(incomplete), new RegExp(`field: ${field}`));
  }
});

test("incremental progress validation accepts only an appended matching schedule prefix", () => {
  const schedule = [0, 1].map(scheduleIndex => ({ stage: "stage1_core", scheduleIndex,
    redId: `red-${scheduleIndex}`, blueId: `blue-${scheduleIndex}` }));
  const base = { schema: PERSISTENCE_SCHEMAS.progress, runId: "run-1", parentGeneration: "ReachR29",
    parentFingerprint: "fingerprint", targetGeneration: "ReachR30", controlsHash: "controls",
    interventionsHash: "interventions", breedingSeed: "1", breedingPrngVersion: "splitmix64-v1",
    updatedAt: timestamp, phase: "stage1_running", schedule, cursor: 0, partialLedger: [],
    completedLedger: [],
    tentativeElites: [], challengerHistory: [], childCandidate: null };
  const next = { ...base, cursor: 2, partialLedger: schedule, updatedAt: "2026-08-27T12:01:00.000Z" };
  assert.equal(validateIncrementalRunProgressRecord(next, base), next);
  const missing = { ...next }; delete missing.challengerHistory;
  assert.throws(() => validateIncrementalRunProgressRecord(missing, base), /field: challengerHistory/);
  assert.throws(() => validateIncrementalRunProgressRecord({ ...next, controlsHash: "changed" }, base), /changed controlsHash/);
  assert.throws(() => validateIncrementalRunProgressRecord({ ...next,
    partialLedger: [schedule[0], { ...schedule[1], blueId: "wrong" }] }, base), /does not match/);
});

test("combat cache requires complete canonical combat metrics", () => {
  const combat = { outcome: "draw", winner: "", round: 20, redScore: 0, blueScore: 0,
    engineRulesVersion: "reach-v1" };
  for (const color of ["red", "blue"]) {
    for (const field of ["P", "A", "C", "Pokes", "KillByP", "KillByA", "KillByC", "VictimP", "VictimA", "VictimC"]) {
      combat[`${color}${field}`] = 0;
    }
  }
  const record = { schema: PERSISTENCE_SCHEMAS.combatCache, cacheKey: "exact-key", combat };
  assert.equal(validateCombatCacheRecord(record), record);
  const incomplete = structuredClone(record); delete incomplete.combat.redPokes;
  assert.throws(() => validateCombatCacheRecord(incomplete), /missing redPokes/);
});

test("run and settings records validate independently and all records round-trip", () => {
  const run = {
    schema: PERSISTENCE_SCHEMAS.run, runId: "run-1", title: "Primary run", createdAt: timestamp,
    activeGeneration: "ReachR29", originatingGeneration: null
  };
  const settings = {
    schema: PERSISTENCE_SCHEMAS.settings, settingsId: "local", selectedRunId: "run-1",
    selectedGeneration: "ReachR29", workerCount: 4, preferences: {}
  };
  assert.deepEqual(validateRunRecord(structuredClone(run)), run);
  assert.deepEqual(validateSettingsRecord(structuredClone(settings)), settings);
  assert.throws(() => validateRunRecord({ ...run, createdAt: "yesterday" }), /ISO date/);
  assert.throws(() => validateSettingsRecord({ ...settings, workerCount: 0 }), /positive/);
});

test("durable data rejects unsupported and lossy values", () => {
  assert.throws(() => assertDurableData({ value: Infinity }), /non-finite/);
  assert.throws(() => assertDurableData({ value: 1n }), /unsupported/);
  assert.throws(() => assertDurableData({ value: new Map() }), /unsupported/);
  assert.throws(() => assertDurableData({ value: new Date() }), /unsupported/);
  assert.throws(() => assertDurableData({ value: undefined }), /undefined/);
});
