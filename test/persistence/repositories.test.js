import assert from "node:assert/strict";
import test from "node:test";
import {
  CompletedGenerationRepository,
  CombatCacheRepository,
  LedgerRepository,
  ProgressRepository,
  ReplayRepository,
  RunRepository,
  SettingsRepository,
  finalizeCompletedGeneration,
  deleteRunData,
  saveCompletedGenerationWithLedger,
  withTransaction
} from "../../src/persistence/repositories.js";
import { PERSISTENCE_SCHEMAS, STORE_NAMES } from "../../src/persistence/schema.js";
import { runDurableTournamentStages } from "../../src/persistence/durable-tournament.js";

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  emit(type) { for (const handler of this.listeners.get(type) ?? []) handler({ target: this }); }
}

class MemoryStore {
  constructor(keyPath, transaction) { this.keyPath = keyPath; this.transaction = transaction; this.records = new Map(); }
  key(record) { return Array.isArray(this.keyPath) ? this.keyPath.map(name => record[name]) : record[this.keyPath]; }
  token(key) { return JSON.stringify(key); }
  request(action) {
    const request = new Events();
    this.transaction.requestStarted();
    queueMicrotask(() => {
      try {
        request.result = action();
        request.emit("success");
        this.transaction.requestFinished();
      } catch (error) {
        request.error = error;
        request.emit("error");
        this.transaction.fail(error);
      }
    });
    return request;
  }
  put(record) { return this.request(() => { const key = this.key(record); this.records.set(this.token(key), structuredClone(record)); return key; }); }
  add(record) {
    return this.request(() => {
      const key = this.key(record);
      if (this.records.has(this.token(key))) {
        const error = new Error("Key already exists");
        error.name = "ConstraintError";
        throw error;
      }
      this.records.set(this.token(key), structuredClone(record));
      return key;
    });
  }
  get(key) { return this.request(() => structuredClone(this.records.get(this.token(key)))); }
  getAll() { return this.request(() => [...this.records.values()].map(record => structuredClone(record))); }
  delete(key) { return this.request(() => { this.records.delete(this.token(key)); }); }
  index(name) {
    return {
      getAll: value => this.request(() => [...this.records.values()]
        .filter(record => record[name] === value).map(record => structuredClone(record))),
      getAllKeys: value => this.request(() => [...this.records.values()]
        .filter(record => record[name] === value).map(record => structuredClone(this.key(record))))
    };
  }
}

class MemoryTransaction extends Events {
  constructor(database, names) {
    super();
    this.database = database;
    this.names = Array.isArray(names) ? names : [names];
    this.pending = 0;
    this.finishTimer = setTimeout(() => this.emit("complete"), 0);
  }
  objectStore(name) {
    if (!this.names.includes(name)) throw new Error(`Store ${name} is outside the transaction`);
    return new MemoryStore(this.database.keyPaths[name], this);
  }
  requestStarted() {
    this.pending += 1;
    clearTimeout(this.finishTimer);
  }
  requestFinished() {
    this.pending -= 1;
    if (this.pending === 0) this.finishTimer = setTimeout(() => this.emit("complete"), 0);
  }
  fail(error) { this.error = error; this.emit("error"); }
  abort() { clearTimeout(this.finishTimer); this.emit("abort"); }
}

class MemoryDatabase {
  constructor() {
    this.keyPaths = { [STORE_NAMES.runs]: "runId", [STORE_NAMES.settings]: "settingsId" };
    this.keyPaths[STORE_NAMES.generations] = ["runId", "generation"];
    this.keyPaths[STORE_NAMES.ledgers] = "ledgerId";
    this.keyPaths[STORE_NAMES.progress] = "runId";
    this.keyPaths[STORE_NAMES.replays] = "replayId";
    this.keyPaths[STORE_NAMES.combatCache] = "cacheKey";
    this.data = {
      [STORE_NAMES.runs]: new Map(),
      [STORE_NAMES.settings]: new Map(),
      [STORE_NAMES.generations]: new Map(),
      [STORE_NAMES.ledgers]: new Map(),
      [STORE_NAMES.progress]: new Map(),
      [STORE_NAMES.replays]: new Map(),
      [STORE_NAMES.combatCache]: new Map()
    };
  }
  transaction(names) {
    const transaction = new MemoryTransaction(this, names);
    transaction.objectStore = name => {
      if (!transaction.names.includes(name)) throw new Error(`Store ${name} is outside the transaction`);
      const store = new MemoryStore(this.keyPaths[name], transaction);
      store.records = this.data[name];
      return store;
    };
    return transaction;
  }
}

function run(runId, createdAt) {
  return {
    schema: PERSISTENCE_SCHEMAS.run, runId, title: `Run ${runId}`, createdAt,
    activeGeneration: "ReachR29", originatingGeneration: null
  };
}

function settings(selectedRunId = null) {
  return {
    schema: PERSISTENCE_SCHEMAS.settings, settingsId: "application", selectedRunId,
    selectedGeneration: selectedRunId === null ? null : "ReachR29", workerCount: 4
  };
}

function generation(runId, name, completedAt) {
  return {
    schema: PERSISTENCE_SCHEMAS.generation,
    runId,
    generation: name,
    parentGeneration: "ReachR29",
    completedAt,
    fingerprint: `fingerprint-${name}`,
    ledgerRef: `ledger-${name}`,
    checkpoint: { population: [] },
    rankings: [],
    interventions: [],
    manifest: {},
    controls: {},
    migration: {},
    breeding: {},
    reports: {}
  };
}

function ledger(runId, name, ledgerId = `ledger-${name}`) {
  return {
    schema: PERSISTENCE_SCHEMAS.ledger,
    runId,
    generation: name,
    ledgerId,
    rows: []
  };
}

function progress(runId, cursor = 1) {
  const schedule = [
    { stage: "stage1", scheduleIndex: 0, redId: "red-0", blueId: "blue-0" },
    { stage: "stage1", scheduleIndex: 1, redId: "red-1", blueId: "blue-1" }
  ];
  return {
    schema: PERSISTENCE_SCHEMAS.progress,
    runId,
    parentGeneration: "ReachR29",
    parentFingerprint: "parent-fingerprint",
    targetGeneration: "ReachR30",
    controlsHash: "controls-hash",
    interventionsHash: "interventions-hash",
    breedingSeed: "seed",
    breedingPrngVersion: "splitmix64-v1",
    updatedAt: "2026-03-01T00:00:00.000Z",
    phase: "stage1_running",
    schedule,
    partialLedger: schedule.slice(0, cursor),
    completedLedger: [],
    cursor,
    tentativeElites: [],
    challengerHistory: [],
    childCandidate: null
  };
}

function replay(runId, replayId, createdAt = "2026-03-01T00:00:00.000Z") {
  return {
    schema: PERSISTENCE_SCHEMAS.replay,
    runId,
    replayId,
    generation: "ReachR30",
    createdAt,
    game: { redId: "red", blueId: "blue", trace: [] }
  };
}

test("run records save, replace, load, list newest-first, and delete", async () => {
  const repository = new RunRepository(new MemoryDatabase());
  await repository.save(run("older", "2026-01-01T00:00:00.000Z"));
  await repository.save(run("newer", "2026-02-01T00:00:00.000Z"));
  await repository.save({ ...run("older", "2026-01-01T00:00:00.000Z"), title: "Renamed" });
  assert.equal((await repository.get("older")).title, "Renamed");
  assert.deepEqual((await repository.list()).map(record => record.runId), ["newer", "older"]);
  await repository.delete("older");
  assert.equal(await repository.get("older"), undefined);
});

test("run repository validates writes and identifiers", async () => {
  const repository = new RunRepository(new MemoryDatabase());
  await assert.rejects(repository.save({}), /unsupported schema/);
  await assert.rejects(repository.get(""), /non-empty string/);
  await assert.rejects(repository.delete(null), /non-empty string/);
});

test("settings use one replaceable application record and can be cleared", async () => {
  const repository = new SettingsRepository(new MemoryDatabase());
  assert.equal(await repository.get(), undefined);
  await repository.save(settings("run-one"));
  await repository.save({ ...settings("run-two"), workerCount: 2 });
  assert.deepEqual(await repository.get(), { ...settings("run-two"), workerCount: 2 });
  await repository.clear();
  assert.equal(await repository.get(), undefined);
});

test("settings repository rejects invalid and mismatched records", async () => {
  const repository = new SettingsRepository(new MemoryDatabase());
  await assert.rejects(repository.save({ ...settings(), workerCount: 0 }), /positive/);
  await assert.rejects(repository.save({ ...settings(), settingsId: "other" }), /must use ID/);
});

test("transaction helper waits for commit and aborts after operation failure", async () => {
  const database = new MemoryDatabase();
  let committed = false;
  const result = withTransaction(database, STORE_NAMES.runs, "readonly", async () => {
    await Promise.resolve();
    return 7;
  });
  result.then(() => { committed = true; });
  await Promise.resolve();
  assert.equal(committed, false);
  assert.equal(await result, 7);

  await assert.rejects(withTransaction(database, STORE_NAMES.runs, "readwrite", () => {
    throw new Error("operation failed");
  }), /operation failed/);
});

test("completed generations save and load by compound identity", async () => {
  const repository = new CompletedGenerationRepository(new MemoryDatabase());
  const record = generation("run-one", "ReachR30", "2026-03-01T00:00:00.000Z");
  assert.deepEqual(await repository.save(record), record);
  assert.deepEqual(await repository.get("run-one", "ReachR30"), record);
  assert.equal(await repository.get("run-one", "ReachR31"), undefined);
});

test("completed generation listing is run-scoped and newest-first", async () => {
  const repository = new CompletedGenerationRepository(new MemoryDatabase());
  await repository.save(generation("run-one", "ReachR30", "2026-03-01T00:00:00.000Z"));
  await repository.save(generation("run-two", "ReachR30", "2026-03-02T00:00:00.000Z"));
  await repository.save(generation("run-one", "ReachR31", "2026-04-01T00:00:00.000Z"));
  assert.deepEqual((await repository.list("run-one")).map(record => record.generation), ["ReachR31", "ReachR30"]);
});

test("completed generation writes reject incomplete records before database I/O", async () => {
  const database = new MemoryDatabase();
  const repository = new CompletedGenerationRepository(database);
  await assert.rejects(repository.save({ ...generation("run-one", "ReachR30", "2026-03-01T00:00:00.000Z"), reports: null }), /missing required/);
  assert.equal(database.data[STORE_NAMES.generations].size, 0);
  await assert.rejects(repository.get("", "ReachR30"), /non-empty string/);
});

test("completed generations are immutable once stored", async () => {
  const repository = new CompletedGenerationRepository(new MemoryDatabase());
  const record = generation("run-one", "ReachR30", "2026-03-01T00:00:00.000Z");
  await repository.save(record);
  await assert.rejects(repository.save({ ...record, fingerprint: "replacement" }), /already exists/);
  assert.equal((await repository.get("run-one", "ReachR30")).fingerprint, record.fingerprint);
});

test("ledgers save and load by immutable ledger identity", async () => {
  const repository = new LedgerRepository(new MemoryDatabase());
  const record = ledger("run-one", "ReachR30");
  assert.deepEqual(await repository.save(record), record);
  assert.deepEqual(await repository.get(record.ledgerId), record);
  await assert.rejects(repository.save({ ...record, rows: [] }), /already exists/);
  assert.deepEqual(await repository.get(record.ledgerId), record);
});

test("ledger listing is run-scoped and deterministically ordered", async () => {
  const repository = new LedgerRepository(new MemoryDatabase());
  await repository.save(ledger("run-one", "ReachR31"));
  await repository.save(ledger("run-two", "ReachR29"));
  await repository.save(ledger("run-one", "ReachR30"));
  assert.deepEqual((await repository.list("run-one")).map(record => record.generation), ["ReachR30", "ReachR31"]);
  await assert.rejects(repository.list(""), /non-empty string/);
});

test("ledger writes validate complete records before database I/O", async () => {
  const database = new MemoryDatabase();
  const repository = new LedgerRepository(database);
  await assert.rejects(repository.save({ ...ledger("run-one", "ReachR30"), rows: null }), /rows must be an array/);
  assert.equal(database.data[STORE_NAMES.ledgers].size, 0);
});

test("completed generation and ledger commit through one transaction", async () => {
  const database = new MemoryDatabase();
  const transactions = [];
  const originalTransaction = database.transaction.bind(database);
  database.transaction = (names, mode) => {
    transactions.push({ names, mode });
    return originalTransaction(names, mode);
  };
  const generationRecord = generation("run-one", "ReachR30", "2026-03-01T00:00:00.000Z");
  const ledgerRecord = ledger("run-one", "ReachR30");
  assert.deepEqual(await saveCompletedGenerationWithLedger(database, generationRecord, ledgerRecord), {
    generation: generationRecord, ledger: ledgerRecord
  });
  assert.deepEqual(transactions, [{
    names: [STORE_NAMES.generations, STORE_NAMES.ledgers], mode: "readwrite"
  }]);
  assert.equal(database.data[STORE_NAMES.generations].size, 1);
  assert.equal(database.data[STORE_NAMES.ledgers].size, 1);
});

test("atomic generation commit rejects mismatched references before writing", async () => {
  const database = new MemoryDatabase();
  const generationRecord = generation("run-one", "ReachR30", "2026-03-01T00:00:00.000Z");
  await assert.rejects(saveCompletedGenerationWithLedger(
    database, generationRecord, ledger("run-one", "ReachR30", "wrong-ledger")
  ), /identities do not match/);
  assert.equal(database.data[STORE_NAMES.generations].size, 0);
  assert.equal(database.data[STORE_NAMES.ledgers].size, 0);
});

test("progress checkpoints save, replace, load, and clear by run", async () => {
  const repository = new ProgressRepository(new MemoryDatabase());
  await repository.save(progress("run-one", 1));
  await repository.save({ ...progress("run-one", 2), phase: "stage1_ranking" });
  const restored = await repository.get("run-one");
  assert.equal(restored.cursor, 2);
  assert.equal(restored.partialLedger.length, 2);
  assert.equal(restored.phase, "stage1_ranking");
  await repository.clear("run-one");
  assert.equal(await repository.get("run-one"), undefined);
});

test("pre-v2 incomplete progress is normalized on load and resumes from its durable prefix", async () => {
  const database = new MemoryDatabase();
  const legacy = { ...progress("run-one", 1), childCandidate: { generation: "ReachR30", fingerprint: "child" } };
  delete legacy.completedLedger;
  delete legacy.tentativeElites;
  delete legacy.challengerHistory;
  database.data[STORE_NAMES.progress].set(JSON.stringify("run-one"), structuredClone(legacy));

  const loaded = await new ProgressRepository(database).get("run-one");
  assert.deepEqual(loaded.completedLedger, []);
  assert.deepEqual(loaded.tentativeElites, []);
  assert.deepEqual(loaded.challengerHistory, []);
  assert.deepEqual(loaded.childCandidate, legacy.childCandidate);
  const executed = [];
  const result = await runDurableTournamentStages({
    checkpoint: loaded,
    expected: Object.fromEntries(["runId", "parentGeneration", "parentFingerprint", "targetGeneration",
      "controlsHash", "interventionsHash", "breedingSeed", "breedingPrngVersion"].map(key => [key, loaded[key]])),
    executeGame: async game => { executed.push(game.scheduleIndex); return game; },
    saveCheckpoint: async () => {}, rankStage1: async () => [], buildStage2Schedule: async () => [],
    rankStage2: async () => [], planChallengerIteration: async () => ({ challengers: [], schedule: [], rankings: [] })
  });
  assert.deepEqual(executed, [1]);
  assert.equal(result.status, "ready_to_finalize");
});

test("progress writes reject invalid resumable state before database I/O", async () => {
  const database = new MemoryDatabase();
  const repository = new ProgressRepository(database);
  await assert.rejects(repository.save({ ...progress("run-one"), cursor: 3 }), /outside its schedule/);
  assert.equal(database.data[STORE_NAMES.progress].size, 0);
  await assert.rejects(repository.get(""), /non-empty string/);
});

test("generation finalization stores artifacts and clears progress atomically", async () => {
  const database = new MemoryDatabase();
  const progressRepository = new ProgressRepository(database);
  await progressRepository.save(progress("run-one"));
  const transactions = [];
  const originalTransaction = database.transaction.bind(database);
  database.transaction = (names, mode) => {
    transactions.push({ names, mode });
    return originalTransaction(names, mode);
  };
  const generationRecord = generation("run-one", "ReachR30", "2026-03-01T00:00:00.000Z");
  const ledgerRecord = ledger("run-one", "ReachR30");
  await finalizeCompletedGeneration(database, generationRecord, ledgerRecord);
  assert.deepEqual(transactions, [{
    names: [STORE_NAMES.generations, STORE_NAMES.ledgers, STORE_NAMES.progress], mode: "readwrite"
  }]);
  assert.equal(database.data[STORE_NAMES.generations].size, 1);
  assert.equal(database.data[STORE_NAMES.ledgers].size, 1);
  assert.equal(database.data[STORE_NAMES.progress].size, 0);
});

test("replays persist immutably and list newest-first by run", async () => {
  const repository = new ReplayRepository(new MemoryDatabase());
  await repository.save(replay("run-one", "older"));
  await repository.save(replay("run-two", "other"));
  await repository.save(replay("run-one", "newer", "2026-04-01T00:00:00.000Z"));
  assert.equal((await repository.get("older")).replayId, "older");
  assert.deepEqual((await repository.list("run-one")).map(item => item.replayId), ["newer", "older"]);
  await assert.rejects(repository.save(replay("run-one", "older")), /already exists/);
});

test("complete exact combat results persist across repository instances", async () => {
  const database = new MemoryDatabase();
  const combat = { outcome: "draw", winner: "", round: 20, redScore: 0, blueScore: 0,
    engineRulesVersion: "reach-v1" };
  for (const color of ["red", "blue"]) for (const field of [
    "P", "A", "C", "Pokes", "KillByP", "KillByA", "KillByC", "VictimP", "VictimA", "VictimC"
  ]) combat[`${color}${field}`] = 0;
  await new CombatCacheRepository(database).save(new Map([["key", combat]]));
  const loaded = await new CombatCacheRepository(database).load();
  assert.deepEqual(loaded.get("key"), combat);
});

test("run cleanup removes owned artifacts without affecting another run", async () => {
  const database = new MemoryDatabase();
  await new RunRepository(database).save(run("run-one", "2026-01-01T00:00:00.000Z"));
  await new RunRepository(database).save(run("run-two", "2026-01-02T00:00:00.000Z"));
  await new CompletedGenerationRepository(database).save(generation("run-one", "ReachR30", "2026-03-01T00:00:00.000Z"));
  await new LedgerRepository(database).save(ledger("run-one", "ReachR30"));
  await new ProgressRepository(database).save(progress("run-one"));
  await new ReplayRepository(database).save(replay("run-one", "replay-one"));
  await new ReplayRepository(database).save(replay("run-two", "replay-two"));
  await new SettingsRepository(database).save(settings("run-one"));
  await deleteRunData(database, "run-one");
  assert.equal(await new RunRepository(database).get("run-one"), undefined);
  assert.equal((await new RunRepository(database).list()).length, 1);
  assert.deepEqual((await new ReplayRepository(database).list("run-two")).map(item => item.replayId), ["replay-two"]);
  assert.equal(database.data[STORE_NAMES.generations].size, 0);
  assert.equal(database.data[STORE_NAMES.ledgers].size, 0);
  assert.equal(database.data[STORE_NAMES.progress].size, 0);
  assert.equal((await new SettingsRepository(database).get()).selectedRunId, null);
  assert.equal((await new SettingsRepository(database).get()).selectedGeneration, null);
});
