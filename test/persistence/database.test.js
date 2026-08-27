import assert from "node:assert/strict";
import test from "node:test";
import {
  openPersistenceDatabase,
  requestResult,
  resolveIndexedDBFactory,
  transactionDone
} from "../../src/persistence/database.js";
import { DATABASE_NAME, DATABASE_VERSION, STORE_NAMES } from "../../src/persistence/schema.js";

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  emit(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler({ target: this, ...event });
    this[`on${type}`]?.({ target: this, ...event });
  }
}

class FakeStore {
  constructor(name, options) { this.name = name; this.options = options; this.indexes = []; }
  createIndex(name, keyPath, options) { this.indexes.push({ name, keyPath, options }); }
}

class FakeDatabase extends Events {
  constructor() {
    super();
    this.stores = new Map();
    this.closeCount = 0;
    this.objectStoreNames = { contains: name => this.stores.has(name) };
  }
  createObjectStore(name, options) {
    const store = new FakeStore(name, options);
    this.stores.set(name, store);
    return store;
  }
  transaction(names, mode) { return { names, mode }; }
  close() { this.closeCount += 1; }
}

class FakeFactory {
  constructor(outcome = "success") { this.outcome = outcome; this.database = new FakeDatabase(); }
  open(name, version) {
    this.lastOpen = { name, version };
    const request = new Events();
    queueMicrotask(() => {
      if (this.outcome === "error") {
        request.error = new Error("open failed");
        request.emit("error");
        return;
      }
      if (this.outcome === "blocked") {
        request.emit("blocked");
        return;
      }
      request.result = this.database;
      request.emit("upgradeneeded");
      request.emit("success");
    });
    return request;
  }
}

test("injectable IndexedDB factory opens version one and creates every store and index", async () => {
  const factory = new FakeFactory();
  const connection = await openPersistenceDatabase({ indexedDB: factory });
  assert.deepEqual(factory.lastOpen, { name: DATABASE_NAME, version: DATABASE_VERSION });
  assert.deepEqual([...factory.database.stores.keys()], Object.values(STORE_NAMES));
  assert.deepEqual(factory.database.stores.get(STORE_NAMES.generations).indexes.map(index => index.name), ["runId", "completedAt"]);
  assert.deepEqual(connection.transaction([STORE_NAMES.runs], "readwrite"), {
    names: [STORE_NAMES.runs], mode: "readwrite"
  });
});

test("opening rejects unavailable, failed, and blocked IndexedDB factories", async () => {
  assert.throws(() => resolveIndexedDBFactory(null), /unavailable/);
  await assert.rejects(openPersistenceDatabase({ indexedDB: new FakeFactory("error") }), /open failed/);
  await assert.rejects(openPersistenceDatabase({ indexedDB: new FakeFactory("blocked") }), /blocked/);
});

test("request and transaction helpers wait for success or complete events", async () => {
  const request = new Events();
  const result = requestResult(request);
  request.result = { value: 4 };
  request.emit("success");
  assert.deepEqual(await result, { value: 4 });

  const transaction = new Events();
  const completed = transactionDone(transaction);
  let resolved = false;
  completed.then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false);
  transaction.emit("complete");
  await completed;
  assert.equal(resolved, true);
});

test("request and transaction helpers propagate native failures", async () => {
  const request = new Events();
  const failedRequest = requestResult(request);
  request.error = new Error("request failed");
  request.emit("error");
  await assert.rejects(failedRequest, /request failed/);

  const transaction = new Events();
  const aborted = transactionDone(transaction);
  transaction.error = new Error("transaction aborted");
  transaction.emit("abort");
  await assert.rejects(aborted, /transaction aborted/);
});

test("close and version changes close once and reject later transactions", async () => {
  const factory = new FakeFactory();
  const connection = await openPersistenceDatabase({ indexedDB: factory });
  factory.database.emit("versionchange");
  connection.close();
  assert.equal(factory.database.closeCount, 1);
  assert.throws(() => connection.transaction([STORE_NAMES.runs]), /closed/);
});
