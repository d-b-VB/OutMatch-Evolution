import { DATABASE_NAME, DATABASE_VERSION, STORE_NAMES } from "./schema.js";

function listen(target, type, handler) {
  if (typeof target.addEventListener === "function") target.addEventListener(type, handler, { once: true });
  else target[`on${type}`] = handler;
}

export function resolveIndexedDBFactory(factory = globalThis.indexedDB) {
  if (factory === undefined || factory === null || typeof factory.open !== "function") {
    throw new Error("IndexedDB is unavailable in this environment");
  }
  return factory;
}

/** Resolve an IndexedDB request's result or reject with its native error. */
export function requestResult(request) {
  return new Promise((resolve, reject) => {
    listen(request, "success", () => resolve(request.result));
    listen(request, "error", () => reject(request.error ?? new Error("IndexedDB request failed")));
  });
}

/** Resolve only after the entire transaction commits successfully. */
export function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    listen(transaction, "complete", () => resolve());
    listen(transaction, "abort", () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")));
    listen(transaction, "error", () => reject(transaction.error ?? new Error("IndexedDB transaction failed")));
  });
}

function createStore(database, name, options, indexes = []) {
  if (database.objectStoreNames.contains(name)) return;
  const store = database.createObjectStore(name, options);
  for (const index of indexes) store.createIndex(index.name, index.keyPath, index.options);
}

function upgradeFrom0To1(database) {
  createStore(database, STORE_NAMES.runs, { keyPath: "runId" }, [
    { name: "createdAt", keyPath: "createdAt", options: { unique: false } }
  ]);
  createStore(database, STORE_NAMES.generations, { keyPath: ["runId", "generation"] }, [
    { name: "runId", keyPath: "runId", options: { unique: false } },
    { name: "completedAt", keyPath: "completedAt", options: { unique: false } }
  ]);
  createStore(database, STORE_NAMES.ledgers, { keyPath: "ledgerId" }, [
    { name: "runId", keyPath: "runId", options: { unique: false } }
  ]);
  createStore(database, STORE_NAMES.progress, { keyPath: "runId" });
  createStore(database, STORE_NAMES.settings, { keyPath: "settingsId" });
  createStore(database, STORE_NAMES.replays, { keyPath: "replayId" }, [
    { name: "runId", keyPath: "runId", options: { unique: false } },
    { name: "runGeneration", keyPath: ["runId", "generation"], options: { unique: false } }
  ]);
}

function upgradeFrom1To2(database) {
  createStore(database, STORE_NAMES.combatCache, { keyPath: "cacheKey" });
}

const DATABASE_MIGRATIONS = Object.freeze([upgradeFrom0To1, upgradeFrom1To2]);

/** Apply every required schema migration in order inside the upgrade transaction. */
export function upgradeDatabase(database, transaction, oldVersion = 0, newVersion = DATABASE_VERSION) {
  if (!Number.isSafeInteger(oldVersion) || oldVersion < 0 || oldVersion > DATABASE_VERSION) {
    throw new Error(`Unsupported IndexedDB source version ${oldVersion}`);
  }
  if (newVersion !== null && newVersion !== DATABASE_VERSION) {
    throw new Error(`Unsupported IndexedDB target version ${newVersion}`);
  }
  for (let version = oldVersion; version < DATABASE_VERSION; version += 1) {
    DATABASE_MIGRATIONS[version](database, transaction);
  }
}

export class PersistenceDatabase {
  constructor(database) {
    this.database = database;
    this.closed = false;
    const closeForUpgrade = () => this.close();
    if (typeof database.addEventListener === "function") database.addEventListener("versionchange", closeForUpgrade);
    else database.onversionchange = closeForUpgrade;
  }

  transaction(storeNames, mode = "readonly") {
    if (this.closed) throw new Error("Persistence database connection is closed");
    return this.database.transaction(storeNames, mode);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}

/** Open the versioned persistence database with an injectable IndexedDB factory. */
export function openPersistenceDatabase({
  indexedDB,
  name = DATABASE_NAME,
  version = DATABASE_VERSION
} = {}) {
  let factory;
  try {
    factory = resolveIndexedDBFactory(indexedDB);
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    let settled = false;
    listen(request, "upgradeneeded", event => upgradeDatabase(
      request.result, request.transaction, event.oldVersion ?? 0, event.newVersion ?? version
    ));
    listen(request, "blocked", () => {
      if (settled) return;
      settled = true;
      reject(new Error(`Opening IndexedDB ${name} was blocked by another connection`));
    });
    listen(request, "error", () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error(`Opening IndexedDB ${name} failed`));
    });
    listen(request, "success", () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(new PersistenceDatabase(request.result));
    });
  });
}
