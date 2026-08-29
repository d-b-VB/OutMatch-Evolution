import { openPersistenceDatabase } from "../persistence/database.js";
import { CompletedGenerationRepository, LedgerRepository, ProgressRepository, ReplayRepository, RunRepository, SettingsRepository } from "../persistence/repositories.js";
import {
  commitLabImport, createLabRun, exportLabGeneration, inspectLabImport, loadLabStorage,
  persistDraftControls, persistLabSelection, removeLabRun
} from "./actions.js";
import { controlsFromForm, DEFAULT_LAB_CONTROLS, reviewLabControls, validateLabControls } from "./controls.js";
import { interventionFromForm } from "./interventions.js";
import { buildReportView, reportDownload } from "./report-view.js";
import { renderLabShell } from "./render.js";
import { createLabState, selectGeneration, selectRun } from "./state.js";
import { historicalMatchup, runExhibition } from "./matchups.js";
import { openModalWithFocusReturn } from "./accessibility.js";

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
let populationOptions = { population: "all", query: "", sort: "rank", direction: "asc", selectedId: null };
let matchup = { redId: null, blueId: null, history: null, replays: [], selectedReplay: null };

function selectedReportView() {
  const generation = state.generations.find(item => item.runId === state.selectedRunId
    && item.generation === state.selectedGeneration);
  const number = value => Number(/^ReachR(\d+)$/.exec(value ?? "")?.[1] ?? -1);
  const previous = state.generations.filter(item => item.runId === state.selectedRunId
    && number(item.generation) < number(generation?.generation))
    .sort((left, right) => number(right.generation) - number(left.generation))[0] ?? null;
  return buildReportView(generation, selectedReportId, previous);
}

async function refresh(preferredRunId = null) {
  const runs = await repositories.runs.list();
  const generations = (await Promise.all(runs.map(run => repositories.generations.list(run.runId)))).flat();
  const selected = preferredRunId ? { ...settings, selectedRunId: preferredRunId, selectedGeneration: null } : settings;
  state = createLabState({ runs, generations, settings: selected });
  progress = state.selectedRunId ? await repositories.progress.get(state.selectedRunId) : null;
  const storedReplays = state.selectedRunId ? await repositories.replays.list(state.selectedRunId) : [];
  matchup = { ...matchup, replays: storedReplays.filter(record => record.game?.kind === "exhibition") };
}

function paint() {
  root.innerHTML = renderLabShell(state, {
    notice, storage, draftControls, controlReview, progress, selectedReportId, populationOptions, matchup
  });
  const runSelect = root.querySelector("#run-select");
  const generationSelect = root.querySelector("#generation-select");
  if (runSelect && state.selectedRunId) runSelect.value = state.selectedRunId;
  if (generationSelect && state.selectedGeneration) generationSelect.value = state.selectedGeneration;
  const reportSelect = root.querySelector("#report-select");
  if (reportSelect && selectedReportId) reportSelect.value = selectedReportId;
  const populationSelect = root.querySelector("#population-select");
  const populationSort = root.querySelector("#population-sort");
  if (populationSelect) populationSelect.value = populationOptions.population;
  if (populationSort) populationSort.value = populationOptions.sort;
  if (root.querySelector("#matchup-red") && matchup.redId) root.querySelector("#matchup-red").value = matchup.redId;
  if (root.querySelector("#matchup-blue") && matchup.blueId) root.querySelector("#matchup-blue").value = matchup.blueId;
  runSelect?.addEventListener("change", async event => {
    state = selectRun(state, event.target.value); selectedReportId = null;
    settings = await persistLabSelection(repositories.settings, state, settings); paint();
  });
  generationSelect?.addEventListener("change", async event => {
    state = selectGeneration(state, event.target.value); selectedReportId = null;
    settings = await persistLabSelection(repositories.settings, state, settings); paint();
  });
  reportSelect?.addEventListener("change", event => { selectedReportId = event.target.value; paint(); });
  const updateMatchup = async color => {
    const generation = state.generations.find(item => item.runId === state.selectedRunId && item.generation === state.selectedGeneration);
    matchup = { ...matchup, [`${color}Id`]: root.querySelector(`#matchup-${color}`).value };
    if (matchup.redId && matchup.blueId && matchup.redId !== matchup.blueId && generation?.ledgerRef) {
      const ledger = await repositories.ledgers.get(generation.ledgerRef);
      matchup = { ...matchup, history: historicalMatchup(ledger?.rows, matchup.redId, matchup.blueId) };
    } else matchup = { ...matchup, history: null };
    paint();
  };
  root.querySelector("#matchup-red")?.addEventListener("change", () => updateMatchup("red"));
  root.querySelector("#matchup-blue")?.addEventListener("change", () => updateMatchup("blue"));
  root.querySelector("#run-exhibition")?.addEventListener("click", async () => {
    try {
      const generation = state.generations.find(item => item.runId === state.selectedRunId && item.generation === state.selectedGeneration);
      const genomes = generation?.checkpoint?.population ?? [];
      const record = await runExhibition({
        runId: state.selectedRunId, generation: state.selectedGeneration,
        redGenome: genomes.find(genome => genome.id === matchup.redId),
        blueGenome: genomes.find(genome => genome.id === matchup.blueId), replayRepository: repositories.replays
      });
      matchup = { ...matchup, replays: [record, ...matchup.replays], selectedReplay: record };
      notice = { kind: "success", message: "Saved deterministic exhibition replay." }; paint();
    } catch (error) { notice = { kind: "error", message: error.message }; paint(); }
  });
  root.querySelectorAll(".replay-select").forEach(button => button.addEventListener("click", () => {
    matchup = { ...matchup, selectedReplay: matchup.replays.find(record => record.replayId === button.dataset.replayId) }; paint();
  }));
  populationSelect?.addEventListener("change", event => {
    populationOptions = { ...populationOptions, population: event.target.value, selectedId: null }; paint();
  });
  populationSort?.addEventListener("change", event => {
    populationOptions = { ...populationOptions, sort: event.target.value }; paint();
  });
  root.querySelector("#population-filter")?.addEventListener("change", event => {
    populationOptions = { ...populationOptions, query: event.target.value, selectedId: null }; paint();
  });
  root.querySelectorAll(".population-summary").forEach(button => button.addEventListener("click", () => {
    populationOptions = { ...populationOptions, population: button.dataset.population, selectedId: null }; paint();
  }));
  root.querySelectorAll(".general-detail-link").forEach(button => button.addEventListener("click", () => {
    populationOptions = { ...populationOptions, selectedId: button.dataset.generalId }; paint();
  }));
  root.querySelector("#intervene-from-general")?.addEventListener("click", event => {
    const selectedGeneration = state.generations.find(item => item.runId === state.selectedRunId
      && item.generation === state.selectedGeneration);
    const source = selectedGeneration?.checkpoint?.population?.find(genome => genome.id === event.currentTarget.dataset.generalId);
    if (source) {
      interventionDialog.querySelector('[name="generalId"]').value = source.id;
      interventionDialog.querySelector('[name="from"]').value = source.population;
      interventionDialog.showModal();
    }
  });
  for (const [selector, format] of [["#report-json", "json"], ["#report-csv", "csv"]]) {
    root.querySelector(selector)?.addEventListener("click", () => {
      try {
        const view = selectedReportView();
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
  root.querySelector("#new-run-button")?.addEventListener("click", event => openModalWithFocusReturn(newDialog, event.currentTarget));
  root.querySelector("#import-button")?.addEventListener("click", event => openModalWithFocusReturn(importDialog, event.currentTarget));
  root.querySelector("#delete-run-button")?.addEventListener("click", event => openModalWithFocusReturn(deleteDialog, event.currentTarget));
  root.querySelector("#add-intervention-button")?.addEventListener("click", event => openModalWithFocusReturn(interventionDialog, event.currentTarget));
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
      replays: new ReplayRepository(database),
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
