import { selectedLabRecords } from "./state.js";
import { CONTROL_EXPLANATIONS, DEFAULT_LAB_CONTROLS } from "./controls.js";
import { R29_POPULATIONS } from "../baseline/checkpoint.js";
import { formatProgressTimestamp, summarizeRunProgress } from "./progress.js";
import { buildReportView } from "./report-view.js";

const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);

function options(items, value, label) {
  return items.map(item => `<option value="${escapeHtml(value(item))}">${escapeHtml(label(item))}</option>`).join("");
}

function interventionLabel(operation) {
  return operation.type === "manual-move"
    ? `${operation.generalId}: ${operation.from} → ${operation.to}`
    : `${operation.sourceGeneralId} → ${operation.newId} in ${operation.to}`;
}

export function renderLabShell(state, {
  notice = null, storage = null, draftControls = DEFAULT_LAB_CONTROLS, controlReview = null, progress = null,
  selectedReportId = null
} = {}) {
  const { run, generation } = selectedLabRecords(state);
  const runGenerations = state.generations.filter(item => item.runId === state.selectedRunId);
  const status = generation ? "Generation archived" : run ? "Run ready" : "No local runs";
  const progressSummary = summarizeRunProgress(progress);
  const reportView = buildReportView(generation, selectedReportId);
  return `
    <div class="lab-shell">
      ${notice ? `<div class="notice ${escapeHtml(notice.kind)}" role="status">${escapeHtml(notice.message)}</div>` : ""}
      <header class="masthead">
        <a class="brand" href="#overview" aria-label="OutMatch Evolution Lab home">
          <span class="brand-mark">OM</span><span><strong>OutMatch</strong><small>Evolution Lab</small></span>
        </a>
        <nav aria-label="Lab sections">
          <a class="active" href="#overview">Overview</a><a href="#ecology">Ecology</a><a href="#reports">Reports</a><a href="#replays">Replays</a>
        </nav>
        <span class="system-status"><i></i> Local-first</span>
      </header>
      <main>
        <section class="hero" id="overview">
          <div><p class="eyebrow">Deterministic evolution workspace</p><h1>Shape the ecology.<br><em>Audit every generation.</em></h1>
            <p class="intro">Run reproducible Reach tournaments, inspect population pressure, and preserve every decision in a portable lineage.</p></div>
          <div class="selectors" aria-label="Current selection">
            <label>Run<select id="run-select" ${state.runs.length ? "" : "disabled"}>${state.runs.length
              ? options(state.runs, item => item.runId, item => item.title) : '<option>No runs yet</option>'}</select></label>
            <label>Generation<select id="generation-select" ${runGenerations.length ? "" : "disabled"}>${runGenerations.length
              ? options(runGenerations, item => item.generation, item => item.generation) : '<option>No generations</option>'}</select></label>
          </div>
        </section>
        <section class="status-grid">
          <article class="primary-card"><p class="eyebrow">Workspace status</p><div class="status-line"><span>${escapeHtml(status)}</span><b>${generation ? "Immutable" : "Idle"}</b></div>
            <h2>${escapeHtml(run?.title ?? "Start a new evolutionary branch")}</h2>
            <p>${generation ? `Viewing ${escapeHtml(generation.generation)} · fingerprint ${escapeHtml(generation.fingerprint)}`
              : "Your runs stay in this browser. Create or import a generation to begin."}</p>
            <div class="card-actions"><button id="new-run-button" type="button">New run</button><button id="import-button" class="ghost" type="button">Import .omgen</button>
              ${generation ? '<button id="export-button" class="ghost" type="button">Export</button>' : ""}
              ${run ? '<button id="delete-run-button" class="danger" type="button">Delete</button>' : ""}</div>
          </article>
          <article><span class="metric-label">Local runs</span><strong class="metric">${state.runs.length}</strong><small>Durable workspaces</small></article>
          <article><span class="metric-label">Generations</span><strong class="metric">${state.generations.length}</strong><small>Immutable checkpoints</small></article>
          <article><span class="metric-label">Storage</span><strong class="metric text">${storage?.persisted === true ? "Durable" : "Local"}</strong><small>${storage?.quota
            ? `${Math.round(storage.available / 1048576)} MB available` : "Browser managed"}</small></article>
        </section>
        <section class="lower-grid"><div><p class="eyebrow">Lab workflow</p><h2>One clear chain of custody</h2></div>
          <ol><li><b>01</b><span>Configure<br><small>Ecology & interventions</small></span></li><li><b>02</b><span>Compete<br><small>Worker-run tournaments</small></span></li><li><b>03</b><span>Audit<br><small>Reports & lineage</small></span></li></ol>
        </section>
        <section class="progress-panel" id="run-progress"><div><p class="eyebrow">Durable execution</p><h2>${progressSummary ? escapeHtml(progressSummary.phaseLabel) : "No generation in progress"}</h2>
          <p class="intro">${progressSummary ? `Working toward ${escapeHtml(progressSummary.targetGeneration ?? "the next generation")}. Every displayed result is already represented by a safe local checkpoint.` : "A started generation will report its last safely committed tournament boundary here."}</p></div>
          ${progressSummary ? `<div class="progress-card"><div class="progress-heading"><span>${progressSummary.currentTotal ? `${progressSummary.currentCompleted} / ${progressSummary.currentTotal} current-stage games` : "Between deterministic stages"}</span><b>${progressSummary.percent}%</b></div>
            <progress max="100" value="${progressSummary.percent}">${progressSummary.percent}%</progress><dl><dt>Durable games</dt><dd>${progressSummary.completedGames}</dd><dt>Challenger rounds</dt><dd>${progressSummary.challengerIterations}</dd><dt>Last checkpoint</dt><dd>${escapeHtml(formatProgressTimestamp(progressSummary.updatedAt))}</dd></dl></div>`
            : '<div class="progress-card empty-progress"><b>Ready for configuration</b><span>Review controls and interventions before starting the next generation.</span></div>'}
        </section>
        <section class="control-panel" id="ecology"><div><p class="eyebrow">Ecology draft</p><h2>Generation controls</h2>
          <p class="intro">Drafts are mutable. Starting a generation will freeze these values and their hash into its audit trail.</p></div>
          <form id="controls-form">
            <label>Worker count<input name="workerCount" type="number" min="1" max="16" value="${draftControls.workerCount}"><small>${CONTROL_EXPLANATIONS.workerCount}</small></label>
            <label class="check"><input name="migrationEnabled" type="checkbox" ${draftControls.migrationEnabled ? "checked" : ""}> Enable migration<small>${CONTROL_EXPLANATIONS.migration}</small></label>
            <label>Maximum migrants<input name="maximumMigrants" type="number" min="0" max="49" value="${draftControls.maximumMigrants}"></label>
            <label>Wildcard probability<input name="wildcardProbability" type="number" min="0" max="1" step="0.01" value="${draftControls.wildcardProbability}"><small>${CONTROL_EXPLANATIONS.wildcard}</small></label>
            <label>Mutation probability<input name="mutationProbability" type="number" min="0" max="1" step="0.001" value="${draftControls.mutationProbability}"><small>${CONTROL_EXPLANATIONS.mutation}</small></label>
            <div class="review-box"><span>Interventions</span><b>${draftControls.interventions.length}</b><small>Audited manual population changes</small></div>
            <div class="control-actions"><button value="review" ${run ? "" : "disabled"}>Review & save draft</button></div>
          </form>
          <div class="intervention-queue"><div><p class="eyebrow">Manual interventions</p><h3>Queued population changes</h3></div>
            <button id="add-intervention-button" class="ghost" type="button" ${run ? "" : "disabled"}>Queue intervention</button>
            ${draftControls.interventions.length ? `<ol>${draftControls.interventions.map((operation, index) => `<li><span><b>${escapeHtml(interventionLabel(operation))}</b><small>${escapeHtml(operation.note)}</small></span><button class="ghost remove-intervention" data-index="${index}" type="button">Undo</button></li>`).join("")}</ol>`
              : '<p class="empty-queue">No manual changes queued. Automatic migration remains separate.</p>'}
          </div>
          ${controlReview ? `<div class="control-review" role="status"><p class="eyebrow">Deterministic review</p><h3>Draft locked for review</h3>
            <code>${escapeHtml(controlReview.controlsHash)}</code>${controlReview.interventionsHash ? `<small>Interventions ${escapeHtml(controlReview.interventionsHash)}</small>` : ""}<dl><dt>Workers</dt><dd>${controlReview.controls.workerCount}</dd><dt>Migration</dt><dd>${controlReview.controls.migrationEnabled ? `Up to ${controlReview.controls.maximumMigrants}` : "Off"}</dd><dt>Wildcard</dt><dd>${controlReview.controls.wildcardProbability}</dd><dt>Mutation</dt><dd>${controlReview.controls.mutationProbability}</dd></dl></div>` : ""}
        </section>
        <section class="reports-panel" id="reports"><div><p class="eyebrow">Immutable analytics</p><h2>Generation reports</h2>
          <p class="intro">Reports are read directly from the selected completed generation. Downloads never alter its evolutionary ledger.</p></div>
          ${reportView.selected ? `<div class="report-card"><div class="report-toolbar"><label>Report<select id="report-select">${options(reportView.reports, report => report.id, report => report.label)}</select></label>
            <div><button id="report-json" class="ghost" type="button">JSON</button><button id="report-csv" class="ghost" type="button" ${reportView.matrix ? "" : "disabled"}>CSV</button></div></div>
            <h3>${escapeHtml(reportView.selected.label)}</h3>${reportView.matrix ? `<div class="matrix-scroll"><table><thead><tr><th>Population</th>${reportView.matrix.columns.map(column => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${reportView.matrix.rows.map(row => `<tr><th>${escapeHtml(row.row)}</th>${row.values.map(value => `<td>${value == null ? "—" : escapeHtml(Number(value).toFixed(3))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
              : `<pre>${escapeHtml(JSON.stringify(reportView.selected.value, null, 2))}</pre>`}</div>`
            : '<div class="report-card empty-progress"><b>No archived reports selected</b><span>Choose a completed generation to inspect its immutable analytics.</span></div>'}
        </section>
      </main>
      <footer><span>OutMatch Reach · deterministic by design</span><span>Data stays on this device</span></footer>
      <dialog id="new-run-dialog"><form id="new-run-form" method="dialog"><p class="eyebrow">New workspace</p><h2>Create a run</h2>
        <label>Run ID<input name="runId" required pattern="[A-Za-z0-9._-]+" placeholder="reach-experiment"></label>
        <label>Title<input name="title" required placeholder="My evolution branch"></label>
        <div class="dialog-actions"><button value="cancel" formnovalidate>Cancel</button><button value="create">Create run</button></div></form></dialog>
      <dialog id="import-dialog"><form id="import-form" method="dialog"><p class="eyebrow">Portable generation</p><h2>Import .omgen</h2>
        <label>Archive<input id="import-file" name="file" type="file" accept=".omgen" required></label>
        <label>Target run ID<input id="import-run-id" name="runId" required></label>
        <label>Title<input id="import-title" name="title" required></label>
        <p id="import-summary" class="dialog-summary">Choose an archive to validate it before import.</p>
        <div class="dialog-actions"><button value="cancel" formnovalidate>Cancel</button><button id="import-submit" value="import" disabled>Import generation</button></div></form></dialog>
      <dialog id="delete-run-dialog"><form id="delete-run-form" method="dialog"><p class="eyebrow">Permanent cleanup</p><h2>Delete ${escapeHtml(run?.title ?? "run")}?</h2>
        <p class="dialog-summary">This removes the run, every completed generation, ledger, progress checkpoint, and replay stored under it.</p>
        <div class="dialog-actions"><button value="cancel">Cancel</button><button class="danger" value="delete">Delete permanently</button></div></form></dialog>
      <dialog id="intervention-dialog"><form id="intervention-form" method="dialog"><p class="eyebrow">Audited change</p><h2>Queue intervention</h2>
        <label>Operation<select name="type"><option value="manual-move">Move / manual migrant</option><option value="copy-entrant">Copy entrant</option></select></label>
        <label>Source general ID<input name="generalId" required></label>
        <label>Source population<select name="from">${options(R29_POPULATIONS, value => value, value => value)}</select></label>
        <label>Destination population<select name="to">${options(R29_POPULATIONS, value => value, value => value)}</select></label>
        <label>New ID (copy only)<input name="newId"></label><label>New name (copy only)<input name="newName"></label>
        <label>Audit note<textarea name="note" required placeholder="Why is this population change being made?"></textarea></label>
        <div class="dialog-actions"><button value="cancel" formnovalidate>Cancel</button><button value="queue">Queue change</button></div></form></dialog>
    </div>`;
}
