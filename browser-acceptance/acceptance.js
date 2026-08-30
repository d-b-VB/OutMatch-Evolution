import { openPersistenceDatabase } from "../src/persistence/database.js";
import { ProgressRepository, RunRepository } from "../src/persistence/repositories.js";
import { PERSISTENCE_SCHEMAS } from "../src/persistence/schema.js";
import { buildProgressCheckpoint } from "../src/persistence/resume.js";
import { runDurableTournamentStages } from "../src/persistence/durable-tournament.js";
import { createGameRequest, validateGameResult } from "../src/evolution/worker-protocol.js";
import { exportOmgen, importOmgen } from "../src/portable/archive.js";

const output = document.querySelector("#result");
const checks = JSON.parse(sessionStorage.getItem("outmatch-browser-checks") ?? "[]");
const check = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };

function workerMessage(worker, request) {
  return new Promise((resolve, reject) => {
    worker.addEventListener("message", event => resolve(event.data), { once: true });
    worker.addEventListener("error", event => reject(event.error ?? new Error(event.message)), { once: true });
    worker.postMessage(request);
  }).finally(() => worker.terminate());
}

async function waitFor(root, selector, timeout = 5000) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    const element = root.querySelector(selector);
    if (element) return element;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

try {
  const databaseName = "outmatch-browser-acceptance";
  let database = await openPersistenceDatabase({ name: databaseName });
  const run = {
    schema: PERSISTENCE_SCHEMAS.run, runId: "browser-run", title: "Browser run",
    createdAt: "2026-08-29T00:00:00.000Z", activeGeneration: "ReachR29", originatingGeneration: null
  };
  if (sessionStorage.getItem("outmatch-browser-reloaded") !== "yes") {
    await new RunRepository(database).save(run);
    database.close();
    database = await openPersistenceDatabase({ name: databaseName });
    check((await new RunRepository(database).get(run.runId)).title === run.title, "IndexedDB upgrade/reopen");

    const identity = {
      runId: run.runId, parentGeneration: "ReachR29", parentFingerprint: "parent",
      targetGeneration: "ReachR30", controlsHash: "controls", interventionsHash: "interventions",
      breedingSeed: "1", breedingPrngVersion: "splitmix64-v1"
    };
    const schedule = [0, 1].map(scheduleIndex => ({
      stage: "stage1_core", scheduleIndex, redId: `red-${scheduleIndex}`, blueId: `blue-${scheduleIndex}`
    }));
    const repository = new ProgressRepository(database);
    const checkpoint = buildProgressCheckpoint({ ...identity, phase: "stage1_running", schedule });
    await repository.save(checkpoint);
    let executed = 0;
    const paused = await runDurableTournamentStages({
      checkpoint, expected: identity, executeGame: async game => { executed += 1; return game; },
      saveCheckpoint: value => repository.save(value), shouldPause: () => executed === 1,
      rankStage1: rows => rows, buildStage2Schedule: () => [], rankStage2: rows => rows,
      planChallengerIteration: rows => ({ challengers: [], schedule: [], rankings: rows })
    });
    check(paused.status === "paused" && paused.checkpoint.cursor === 1, "durable pause checkpoint");
    database.close();
    sessionStorage.setItem("outmatch-browser-checks", JSON.stringify(checks));
    sessionStorage.setItem("outmatch-browser-reloaded", "yes");
    location.reload();
    await new Promise(() => {});
  }

  const repository = new ProgressRepository(database);
  const checkpoint = await repository.get(run.runId);
  const expected = Object.fromEntries([
    "runId", "parentGeneration", "parentFingerprint", "targetGeneration", "controlsHash",
    "interventionsHash", "breedingSeed", "breedingPrngVersion"
  ].map(key => [key, checkpoint[key]]));
  const resumed = await runDurableTournamentStages({
    checkpoint, expected, executeGame: async game => game, saveCheckpoint: value => repository.save(value),
    rankStage1: rows => rows, buildStage2Schedule: () => [], rankStage2: rows => rows,
    planChallengerIteration: rows => ({ challengers: [], schedule: [], rankings: rows })
  });
  check(resumed.status === "ready_to_finalize"
    && resumed.checkpoint.completedLedger.map(row => row.scheduleIndex).join(",") === "0,1", "reload/resume without replay");
  database.close();

  const seedCheckpoint = await fetch("../seed/r29/Reach_R29_Complete_Checkpoint.json").then(response => response.json());
  const [redGenome, blueGenome] = seedCheckpoint.population.slice(0, 2);
  const request = createGameRequest({
    jobId: "browser-worker", game: { stage: "stage1_core", scheduleIndex: 0, redId: redGenome.id, blueId: blueGenome.id },
    redGenome, blueGenome, engineOptions: { depth: 1 }
  });
  const worker = new Worker(new URL("../src/evolution/game-worker.js", import.meta.url), { type: "module" });
  const workerResult = validateGameResult(await workerMessage(worker, request), request);
  check(workerResult.ledgerRow.redId === redGenome.id, "module Worker execution");

  const frame = document.createElement("iframe");
  frame.style.width = "390px";
  frame.style.height = "844px";
  frame.src = "/";
  document.body.append(frame);
  await new Promise((resolve, reject) => {
    frame.addEventListener("load", resolve, { once: true });
    setTimeout(() => reject(new Error("Lab iframe did not load")), 5000);
  });
  const frameDocument = frame.contentDocument;
  const newRunButton = await waitFor(frameDocument, "#new-run-button");
  check(frameDocument.documentElement.scrollWidth <= frameDocument.documentElement.clientWidth, "phone viewport has no page overflow");
  const skipLink = frameDocument.querySelector(".skip-link");
  skipLink.focus();
  check(frameDocument.activeElement === skipLink, "keyboard skip navigation focus");
  newRunButton.click();
  const dialog = frameDocument.querySelector("#new-run-dialog");
  check(dialog.open && frameDocument.activeElement.closest("#new-run-dialog") === dialog, "dialog focus entry");
  dialog.close();
  await new Promise(resolve => setTimeout(resolve));
  check(frameDocument.activeElement === newRunButton, "dialog focus return");
  frame.remove();

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
  let downloadClicked = false;
  anchor.addEventListener("click", () => { downloadClicked = true; });
  anchor.download = "browser.omgen";
  anchor.href = URL.createObjectURL(new Blob([archive], { type: "application/zip" }));
  anchor.click();
  check(downloadClicked && anchor.download.endsWith(".omgen") && anchor.href.startsWith("blob:"), "browser download activation");
  URL.revokeObjectURL(anchor.href);

  output.dataset.status = "passed";
  output.textContent = JSON.stringify({ status: "passed", checks }, null, 2);
  sessionStorage.removeItem("outmatch-browser-checks");
  sessionStorage.removeItem("outmatch-browser-reloaded");
} catch (error) {
  output.dataset.status = "failed";
  output.textContent = `${error.stack ?? error}`;
}
