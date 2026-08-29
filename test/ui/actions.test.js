import assert from "node:assert/strict";
import test from "node:test";
import {
  createLabRun, exportLabGeneration, inspectLabImport, loadLabStorage,
  omgenFilename, persistDraftControls, persistLabSelection, removeLabRun
} from "../../src/ui/actions.js";
import { DEFAULT_LAB_CONTROLS } from "../../src/ui/controls.js";
import { PERSISTENCE_SCHEMAS } from "../../src/persistence/schema.js";

test("create run validates, normalizes, and saves repository metadata", async () => {
  const saved = [];
  const record = await createLabRun({
    runRepository: { save: async value => saved.push(value) },
    runId: "  experiment-one ", title: " First branch ",
    now: () => "2026-02-01T00:00:00.000Z"
  });
  assert.deepEqual(record, {
    schema: PERSISTENCE_SCHEMAS.run, runId: "experiment-one", title: "First branch",
    createdAt: "2026-02-01T00:00:00.000Z", activeGeneration: "ReachR29", originatingGeneration: "ReachR29"
  });
  assert.deepEqual(saved, [record]);
  await assert.rejects(createLabRun({ runRepository: { save: async () => {} }, runId: "", title: "Title" }), /Run ID/);
});

test("selection persistence preserves worker preference", async () => {
  const saved = [];
  const settings = await persistLabSelection({ save: async value => saved.push(value) }, {
    selectedRunId: "run-one", selectedGeneration: "ReachR30"
  }, { workerCount: 7 });
  assert.equal(settings.workerCount, 7);
  assert.equal(settings.selectedRunId, "run-one");
  assert.deepEqual(saved, [settings]);
});

test("draft controls persist without discarding selected records", async () => {
  const saved = [];
  const settings = await persistDraftControls({ save: async value => saved.push(value) }, {
    selectedRunId: "run-one", selectedGeneration: "ReachR30"
  }, { ...DEFAULT_LAB_CONTROLS, workerCount: 6 }, { extraPreference: true });
  assert.equal(settings.workerCount, 6);
  assert.equal(settings.draftControls.workerCount, 6);
  assert.equal(settings.selectedGeneration, "ReachR30");
  assert.equal(settings.extraPreference, true);
});

test("file inspection rejects missing and non-OMGEN files before parsing", async () => {
  await assert.rejects(inspectLabImport(null), /Choose/);
  await assert.rejects(inspectLabImport({ name: "generation.zip", arrayBuffer: async () => new ArrayBuffer(0) }), /extension/);
});

test("generation export loads its ledger and creates a safe filename", async () => {
  const generation = { runId: "My run / unsafe", generation: "ReachR30", ledgerRef: "ledger-one" };
  const exported = await exportLabGeneration({
    generation,
    ledgerRepository: { get: async id => ({ ledgerId: id }) },
    exporter: async (record, ledger) => new TextEncoder().encode(`${record.generation}:${ledger.ledgerId}`)
  });
  assert.equal(exported.filename, "My-run-unsafe-ReachR30.omgen");
  assert.equal(new TextDecoder().decode(exported.bytes), "ReachR30:ledger-one");
  assert.equal(omgenFilename({ runId: "***", generation: "///" }), "outmatch-generation.omgen");
  await assert.rejects(exportLabGeneration({ generation, ledgerRepository: { get: async () => undefined } }), /missing/);
});

test("run removal delegates to atomic cleanup and storage inspection degrades safely", async () => {
  const transactions = [];
  const database = {
    transaction: names => {
      transactions.push(names);
      const listeners = {};
      const request = value => ({
        result: value,
        addEventListener(type, handler) { if (type === "success") queueMicrotask(handler); }
      });
      const transaction = {
        addEventListener(type, handler) { listeners[type] = handler; if (type === "complete") setTimeout(handler, 0); },
        objectStore(name) {
          return {
            index: () => ({ getAllKeys: () => request([]) }), delete: () => request(), get: () => request()
          };
        },
        abort() { listeners.abort?.(); }
      };
      return transaction;
    }
  };
  assert.equal(await removeLabRun(database, "run-one"), "run-one");
  assert.equal(transactions.length, 1);
  assert.equal(await loadLabStorage({ storage: null }), null);
  assert.deepEqual(await loadLabStorage({ storage: {
    estimate: async () => ({ usage: 10, quota: 100 }), persisted: async () => true
  } }), { usage: 10, quota: 100, available: 90, usageRatio: 0.1, persisted: true });
});
