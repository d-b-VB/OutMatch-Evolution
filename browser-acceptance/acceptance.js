import { openPersistenceDatabase } from "../src/persistence/database.js";
import { RunRepository } from "../src/persistence/repositories.js";
import { PERSISTENCE_SCHEMAS } from "../src/persistence/schema.js";
import { createGameRequest, validateGameResult } from "../src/evolution/worker-protocol.js";
import { exportOmgen, importOmgen } from "../src/portable/archive.js";

const output = document.querySelector("#result");
const checks = [];
const check = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };

function workerMessage(worker, request) {
  return new Promise((resolve, reject) => {
    worker.addEventListener("message", event => resolve(event.data), { once: true });
    worker.addEventListener("error", event => reject(event.error ?? new Error(event.message)), { once: true });
    worker.postMessage(request);
  }).finally(() => worker.terminate());
}

try {
  const databaseName = `outmatch-browser-${Date.now()}`;
  let database = await openPersistenceDatabase({ name: databaseName });
  const run = {
    schema: PERSISTENCE_SCHEMAS.run, runId: "browser-run", title: "Browser run",
    createdAt: "2026-08-29T00:00:00.000Z", activeGeneration: "ReachR29", originatingGeneration: null
  };
  await new RunRepository(database).save(run);
  database.close();
  database = await openPersistenceDatabase({ name: databaseName });
  check((await new RunRepository(database).get(run.runId)).title === run.title, "IndexedDB upgrade/reopen");
  database.close();

  const checkpoint = await fetch("../seed/r29/Reach_R29_Complete_Checkpoint.json").then(response => response.json());
  const [redGenome, blueGenome] = checkpoint.population.slice(0, 2);
  const request = createGameRequest({
    jobId: "browser-worker", game: { stage: "stage1_core", scheduleIndex: 0, redId: redGenome.id, blueId: blueGenome.id },
    redGenome, blueGenome, engineOptions: { depth: 1 }
  });
  const worker = new Worker(new URL("../src/evolution/game-worker.js", import.meta.url), { type: "module" });
  const workerResult = validateGameResult(await workerMessage(worker, request), request);
  check(workerResult.ledgerRow.redId === redGenome.id, "module Worker execution");

  const generation = {
    schema: PERSISTENCE_SCHEMAS.generation, runId: "portable", generation: "ReachR30",
    parentGeneration: "ReachR29", completedAt: "2026-08-29T00:00:00.000Z", fingerprint: "browser-fingerprint",
    ledgerRef: "browser-ledger", checkpoint: { population: [] }, rankings: [], interventions: [],
    manifest: {}, controls: {}, migration: {}, breeding: {}, reports: {}
  };
  const ledger = {
    schema: PERSISTENCE_SCHEMAS.ledger, runId: "portable", generation: "ReachR30",
    ledgerId: "browser-ledger", rows: []
  };
  const archive = await exportOmgen(generation, ledger);
  const imported = await importOmgen(archive);
  check(imported.generation.fingerprint === generation.fingerprint, ".omgen export/import");

  const anchor = document.createElement("a");
  anchor.download = "browser.omgen";
  anchor.href = URL.createObjectURL(new Blob([archive], { type: "application/zip" }));
  check(anchor.download.endsWith(".omgen") && anchor.href.startsWith("blob:"), "browser download construction");
  URL.revokeObjectURL(anchor.href);

  output.dataset.status = "passed";
  output.textContent = JSON.stringify({ status: "passed", checks }, null, 2);
} catch (error) {
  output.dataset.status = "failed";
  output.textContent = `${error.stack ?? error}`;
}
