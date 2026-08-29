import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { exportOmgen } from "../../src/portable/archive.js";
import {
  commitOmgenImport,
  createOmgenImportPlan,
  detectOmgenImportConflicts,
  inspectOmgenImport
} from "../../src/portable/import.js";
import { PERSISTENCE_SCHEMAS, STORE_NAMES } from "../../src/persistence/schema.js";

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  emit(type) { for (const handler of this.listeners.get(type) ?? []) handler({ target: this }); }
}

const token = key => JSON.stringify(key);

class Database {
  constructor() {
    this.data = Object.fromEntries([STORE_NAMES.runs, STORE_NAMES.generations, STORE_NAMES.ledgers]
      .map(name => [name, new Map()]));
    this.transactions = [];
  }
  transaction(names, mode) {
    this.transactions.push({ names, mode });
    const transaction = new Events();
    let pending = 0;
    let timer = setTimeout(() => transaction.emit("complete"), 0);
    const request = action => {
      clearTimeout(timer);
      pending += 1;
      const result = new Events();
      queueMicrotask(() => {
        try { result.result = action(); result.emit("success"); }
        catch (error) { result.error = error; transaction.error = error; result.emit("error"); transaction.emit("error"); }
        pending -= 1;
        if (pending === 0) timer = setTimeout(() => transaction.emit("complete"), 0);
      });
      return result;
    };
    transaction.objectStore = name => {
      const records = this.data[name];
      const keyOf = record => name === STORE_NAMES.generations
        ? [record.runId, record.generation]
        : name === STORE_NAMES.runs ? record.runId : record.ledgerId;
      return {
        get: key => request(() => structuredClone(records.get(token(key)))),
        add: record => request(() => {
          const key = token(keyOf(record));
          if (records.has(key)) { const error = new Error("exists"); error.name = "ConstraintError"; throw error; }
          records.set(key, structuredClone(record));
          return keyOf(record);
        })
      };
    };
    transaction.abort = () => { clearTimeout(timer); transaction.emit("abort"); };
    return transaction;
  }
}

function records() {
  const ledger = { schema: PERSISTENCE_SCHEMAS.ledger, runId: "source", generation: "ReachR30", ledgerId: "ledger", rows: [] };
  const generation = {
    schema: PERSISTENCE_SCHEMAS.generation, runId: "source", generation: "ReachR30",
    parentGeneration: "ReachR29", completedAt: "2026-01-03T00:00:00.000Z",
    fingerprint: "fingerprint", ledgerRef: "ledger", checkpoint: { population: [] },
    rankings: [], interventions: [], manifest: {}, controls: {}, migration: {}, breeding: {}, reports: {}
  };
  return { generation, ledger };
}

const cryptoOptions = { subtle: webcrypto.subtle, createdAt: "2026-01-04T00:00:00.000Z" };

test("archive inspection validates without touching a database", async () => {
  const expected = records();
  const bytes = await exportOmgen(expected.generation, expected.ledger, cryptoOptions);
  const inspected = await inspectOmgenImport(bytes, cryptoOptions);
  assert.deepEqual(inspected.generation, expected.generation);
  assert.deepEqual(inspected.ledger, expected.ledger);
});

test("import planning can preserve or consistently rewrite linked identities", async () => {
  const expected = records();
  const bytes = await exportOmgen(expected.generation, expected.ledger, cryptoOptions);
  const inspected = await inspectOmgenImport(bytes, cryptoOptions);
  const original = createOmgenImportPlan(inspected);
  assert.equal(original.run.runId, "source");
  assert.equal(original.generation.ledgerRef, "ledger");

  const renamed = createOmgenImportPlan(inspected, { targetRunId: "imported", title: "Imported run" });
  assert.equal(renamed.run.runId, "imported");
  assert.equal(renamed.generation.runId, "imported");
  assert.equal(renamed.ledger.runId, "imported");
  assert.equal(renamed.generation.ledgerRef, "imported:ledger");
  assert.equal(renamed.ledger.ledgerId, "imported:ledger");
  assert.equal(renamed.generation.fingerprint, expected.generation.fingerprint);
});

test("conflict detection reports run, generation, and ledger independently", async () => {
  const database = new Database();
  const inspected = { manifest: { generation: {}, createdAt: "2026-01-04T00:00:00.000Z" }, ...records() };
  const plan = createOmgenImportPlan(inspected);
  await commitOmgenImport(database, plan);
  assert.deepEqual(await detectOmgenImportConflicts(database, plan), ["run", "generation", "ledger"]);
  await assert.rejects(commitOmgenImport(database, plan), /existing run, generation, ledger/);
});

test("renamed imports atomically insert run, generation, and ledger", async () => {
  const database = new Database();
  const inspected = { manifest: { generation: {}, createdAt: "2026-01-04T00:00:00.000Z" }, ...records() };
  const plan = createOmgenImportPlan(inspected, { targetRunId: "new-run" });
  const committed = await commitOmgenImport(database, plan);
  assert.equal(committed, plan);
  assert.equal(database.data[STORE_NAMES.runs].size, 1);
  assert.equal(database.data[STORE_NAMES.generations].size, 1);
  assert.equal(database.data[STORE_NAMES.ledgers].size, 1);
  assert.deepEqual(database.transactions.at(-1), {
    names: [STORE_NAMES.runs, STORE_NAMES.generations, STORE_NAMES.ledgers], mode: "readwrite"
  });
});

test("invalid plans fail before opening a write transaction", async () => {
  const database = new Database();
  const inspected = { manifest: { generation: {}, createdAt: "2026-01-04T00:00:00.000Z" }, ...records() };
  const plan = createOmgenImportPlan(inspected);
  plan.generation.ledgerRef = "wrong";
  await assert.rejects(commitOmgenImport(database, plan), /ledger/);
  assert.equal(database.transactions.length, 0);
});
