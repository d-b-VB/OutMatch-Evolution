import assert from "node:assert/strict";
import test from "node:test";
import { inspectStorage } from "../../src/persistence/storage.js";

test("storage inspection reports quota, availability, ratio, and persistence", async () => {
  const result = await inspectStorage({ storage: {
    estimate: async () => ({ usage: 250, quota: 1000 }),
    persisted: async () => true
  } });
  assert.deepEqual(result, { usage: 250, quota: 1000, available: 750, usageRatio: 0.25, persisted: true });
});

test("storage inspection can request durable browser storage", async () => {
  let requests = 0;
  const result = await inspectStorage({
    storage: {
      estimate: async () => ({ usage: 0, quota: 0 }),
      persisted: async () => false,
      persist: async () => { requests += 1; return true; }
    },
    requestPersistence: true
  });
  assert.equal(result.persisted, true);
  assert.equal(result.usageRatio, null);
  assert.equal(requests, 1);
});

test("storage inspection rejects unavailable APIs", async () => {
  await assert.rejects(inspectStorage({ storage: null }), /unavailable/);
});
