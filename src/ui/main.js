import { openPersistenceDatabase } from "../persistence/database.js";
import { CompletedGenerationRepository, LedgerRepository, ProgressRepository, RunRepository, SettingsRepository } from "../persistence/repositories.js";
import {
  commitLabImport, createLabRun, exportLabGeneration, inspectLabImport, loadLabStorage,
  persistDraftControls, persistLabSelection, removeLabRun
} from "./actions.js";
import { controlsFromForm, DEFAULT_LAB_CONTROLS, reviewLabControls, validateLabControls } from "./controls.js";
import { interventionFromForm } from "./interventions.js";
import { buildReportView, reportDownload } from "./report-view.js";
import { renderLabShell } from "./render.js";
import { createLabState, selectGeneration, selectRun } from "./state.js";

const root = document.querySelector("#app");
let state;
let database;
let repositories;
let settings;
let notice;
let storage;
let draftControls = DEFAULT_LAB_CONTROLS;
let controlReview;
let progress;
let selectedReportId;

async function refresh(preferredRunId = null) {
  const runs = await repositories.runs.list();
  const generations = (await Promise.all(runs.map(run => repositories.generations.list(run.runId)))).flat();
  const selected = preferredRunId ? { ...settings, selectedRunId: preferredRunId, selectedGeneration: null } : settings;
  state = createLabState({ runs, generations, settings: selected });
  progress = state.selectedRunId ? await repositories.progress.get(state.selectedRunId) : null;
}

function paint() {
  root.innerHTML = renderLabShell(state, { notice, storage, draftControls, controlReview, progress, selectedReportId });
  const runSelect = root.querySelector("#run-select");
  const generationSelect = root.querySelector("#generation-select");
  if (runSelect && state.selectedRunId) runSelect.value = state.selectedRunId;
  if (generationSelect && state.selectedGeneration) generationSelect.value = state.selectedGeneration;
  const reportSelect = root.querySelector("#report-select");
  if (reportSelect && selectedReportId) reportSelect.value = selectedReportId;
  runSelect?.addEventListener("change", async event => {
    state = selectRun(state, event.target.value); selectedReportId = null;
    settings = await persistLabSelection(repositories.settings, state, settings); paint();
  });
  generationSelect?.addEventListener("change", async event => {
    state = selectGeneration(state, event.target.value); selectedReportId = null;
    settings = await persistLabSelection(repositories.settings, state, settings); paint();
  });
  reportSelect?.addEventListener("change", event => { selectedReportId = event.target.value; paint(); });
  for (const [selector, format] of [["#report-json", "json"], ["#report-csv", "csv"]]) {
    root.querySelector(selector)?.addEventListener("click", () => {
      try {
        const generation = state.generations.find(item => item.runId === state.selectedRunId && item.generation === state.selectedGeneration);
        const view = buildReportView(generation, selectedReportId);
        const download = reportDownload(view, format);
        const url = URL.createObjectURL(new Blob([download.text], { type: download.type }));
        const anchor = document.createElement("a"); anchor.href = url;
        anchor.download = `${state.selectedRunId}-${state.selectedGeneration}-${view.selected.id}.${download.extension}`;
        anchor.click(); URL.revokeObjectURL(url);
      } catch (error) { notice = { kind: "error", message: error.message }; paint(); }
    });
  }

  const newDialog = root.querySelector("#new-run-dialog");
  const importDialog = root.querySelector("#import-dialog");
  const deleteDialog = root.querySelector("#delete-run-dialog");
  const interventionDialog = root.querySelector("#intervention-dialog");
  root.querySelector("#new-run-button")?.addEventListener("click", () => newDialog.showModal());
  root.querySelector("#import-button")?.addEventListener("click", () => importDialog.showModal());
  root.querySelector("#delete-run-button")?.addEventListener("click", () => deleteDialog.showModal());
  root.querySelector("#add-intervention-button")?.addEventListener("click", () => interventionDialog.showModal());
  root.querySelector("#export-button")?.addEventListener("click", async () => {
    try {
      const generation = state.generations.find(item => item.runId === state.selectedRunId
        && item.generation === state.selectedGeneration);
      const exported = await exportLabGeneration({ generation, ledgerRepository: repositories.ledgers });
      const url = URL.createObjectURL(new Blob([exported.bytes], { type: "application/zip" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = exported.filename; anchor.click();
      URL.revokeObjectURL(url); notice = { kind: "success", message: `Exported ${exported.filename}.` }; paint();
    } catch (error) { notice = { kind: "error", message: error.message }; paint(); }
  });
  root.querySelector("#new-run-form")?.addEventListener("submit", async event => {
    if (event.submitter?.value !== "create") return;
    event.preventDefault();
    try {
      const data = new FormData(event.currentTarget);
      const run = await createLabRun({ runRepository: repositories.runs, runId: data.get("runId"), title: data.get("title") });
      await refresh(run.runId); settings = await persistLabSelection(repositories.settings, state, settings);
      notice = { kind: "success", message: `Created ${run.title}.` }; newDialog.close(); paint();
    } catch (error) { notice = { kind: "error", message: error.message }; newDialog.close(); paint(); }
  });

  let inspected;
  root.querySelector("#import-file")?.addEventListener("change", async event => {
    const summary = root.querySelector("#import-summary");
    const submit = root.querySelector("#import-submit");
    try {
      inspected = await inspectLabImport(event.target.files[0]);
      root.querySelector("#import-run-id").value = `${inspected.generation.runId}-imported`;
      root.querySelector("#import-title").value = `Imported ${inspected.generation.generation}`;
      summary.textContent = `${inspected.generation.generation} · ${inspected.generation.fingerprint}`; submit.disabled = false;
    } catch (error) { inspected = null; summary.textContent = error.message; submit.disabled = true; }
  });
  root.querySelector("#import-form")?.addEventListener("submit", async event => {
    if (event.submitter?.value !== "import") return;
    event.preventDefault();
    try {
      const data = new FormData(event.currentTarget);
      const plan = await commitLabImport({ database, inspected, targetRunId: data.get("runId"), title: data.get("title") });
      await refresh(plan.run.runId); settings = await persistLabSelection(repositories.settings, state, settings);
      notice = { kind: "success", message: `Imported ${plan.generation.generation}.` }; importDialog.close(); paint();
    } catch (error) { notice = { kind: "error", message: error.message }; importDialog.close(); paint(); }
  });
  root.querySelector("#delete-run-form")?.addEventListener("submit", async event => {
    if (event.submitter?.value !== "delete") return;
    event.preventDefault();
    try {
      const deleted = state.selectedRunId; await removeLabRun(database, deleted); settings = null; await refresh();
      if (state.selectedRunId) settings = await persistLabSelection(repositories.settings, state, settings);
      notice = { kind: "success", message: `Deleted ${deleted}.` }; deleteDialog.close(); paint();
    } catch (error) { notice = { kind: "error", message: error.message }; deleteDialog.close(); paint(); }
  });
  root.querySelector("#controls-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const data = new FormData(event.currentTarget);
      draftControls = controlsFromForm({
        workerCount: data.get("workerCount"), migrationEnabled: data.get("migrationEnabled"),
        maximumMigrants: data.get("maximumMigrants"), wildcardProbability: data.get("wildcardProbability"),
        mutationProbability: data.get("mutationProbability"), interventions: draftControls.interventions
      });
      const selectedRun = state.runs.find(run => run.runId === state.selectedRunId);
      controlReview = await reviewLabControls(draftControls, {
        parentGeneration: state.selectedGeneration ?? selectedRun?.activeGeneration
      });
      settings = await persistDraftControls(repositories.settings, state, draftControls, settings);
      notice = { kind: "success", message: "Saved deterministic control draft." }; paint();
    } catch (error) { notice = { kind: "error", message: error.message }; paint(); }
  });
  root.querySelector("#intervention-form")?.addEventListener("submit", async event => {
    if (event.submitter?.value !== "queue") return;
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      draftControls = { ...draftControls, interventions: [...draftControls.interventions, interventionFromForm(data)] };
      controlReview = null;
      settings = await persistDraftControls(repositories.settings, state, draftControls, settings);
      notice = { kind: "success", message: "Queued audited population intervention." };
      interventionDialog.close(); paint();
    } catch (error) { notice = { kind: "error", message: error.message }; paint(); }
  });
  root.querySelectorAll(".remove-intervention").forEach(button => button.addEventListener("click", async () => {
    try {
      draftControls = { ...draftControls, interventions: draftControls.interventions.filter((_, index) => index !== Number(button.dataset.index)) };
      controlReview = null;
      settings = await persistDraftControls(repositories.settings, state, draftControls, settings);
      notice = { kind: "success", message: "Removed queued intervention." }; paint();
    } catch (error) { notice = { kind: "error", message: error.message }; paint(); }
  }));
}

async function bootstrap() {
  try {
    database = await openPersistenceDatabase();
    repositories = {
      runs: new RunRepository(database), generations: new CompletedGenerationRepository(database),
      ledgers: new LedgerRepository(database),
      progress: new ProgressRepository(database),
      settings: new SettingsRepository(database)
    };
    settings = await repositories.settings.get();
    if (settings?.draftControls) {
      try { draftControls = validateLabControls(settings.draftControls); }
      catch { draftControls = DEFAULT_LAB_CONTROLS; notice = { kind: "error", message: "Stored control draft was invalid and has been reset." }; }
    }
    storage = await loadLabStorage();
    await refresh();
  } catch (error) {
    console.warn("Opening local lab data failed; rendering an empty workspace.", error);
    state = createLabState();
  }
  paint();
}

bootstrap();
