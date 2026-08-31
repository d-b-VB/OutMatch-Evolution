import { selectedLabRecords } from "./state.js";
import { CONTROL_EXPLANATIONS, DEFAULT_LAB_CONTROLS } from "./controls.js";
import { R29_POPULATIONS } from "../baseline/checkpoint.js";
import { formatProgressTimestamp, summarizeRunProgress } from "./progress.js";
import { buildReportView } from "./report-view.js";
import { createRunOperation, runControlState } from "./run-operation.js";
import { buildPopulationView } from "./populations.js";
import { replayBoardSequence } from "./matchups.js";
import { buildReplayFrameView } from "./replay-view.js";

const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[character]);

function options(items, value, label) {
  return items.map(item => `<option value="${escapeHtml(value(item))}">${escapeHtml(label(item))}</option>`).join("");
}

function interventionLabel(operation) {
  return operation.type === "manual-move"
    ? `${operation.generalId}: ${operation.from} → ${operation.to}`
    : operation.type === "copy-entrant" ? `${operation.sourceGeneralId} → ${operation.newId} in ${operation.to}`
      : `${operation.replacesGeneralId} → ${operation.genome.id} replacement in ${operation.to}`;
}

function unitRateText(row, field, fallback) {
  const values = row.unitRates?.[field];
  if (!values) return fallback ?? "—";
  return ["P", "A", "C"].map(unit => `${unit} ${values[unit].toFixed(2)}`).join(" · ");
}

export function renderLabShell(state, {
  notice = null, storage = null, draftControls = DEFAULT_LAB_CONTROLS, controlReview = null, progress = null,
  liveProgress = null, selectedReportId = null, runOperation = createRunOperation(), populationOptions = {}, matchup = {}
} = {}) {
  const { run, generation } = selectedLabRecords(state);
  const runGenerations = state.generations.filter(item => item.runId === state.selectedRunId);
  const status = generation ? "Generation archived" : run ? "Run ready" : "No local runs";
  const progressSummary = summarizeRunProgress(progress);
  const generationNumber = value => Number(/^ReachR(\d+)$/.exec(value ?? "")?.[1] ?? -1);
  const previousGeneration = runGenerations.filter(item => generationNumber(item.generation) < generationNumber(generation?.generation))
    .sort((left, right) => generationNumber(right.generation) - generationNumber(left.generation))[0] ?? null;
  const reportView = buildReportView(generation, selectedReportId, previousGeneration);
  const runControls = runControlState({ run, generation, reviewed: controlReview, progress, operation: runOperation });
  const populationView = buildPopulationView(generation, populationOptions);
  const matchupGenomes = generation?.checkpoint?.population ?? [];
  const replayFrames = matchup.selectedReplay ? replayBoardSequence(matchup.selectedReplay) : [];
  const replayView = matchup.selectedReplay
    ? buildReplayFrameView(replayFrames, matchup.selectedReplay.game.replay.actions, matchup.frameIndex) : null;
  return `
    <div class="lab-shell">
      <a class="skip-link" href="#main-content">Skip to lab content</a>
      ${notice ? `<div class="notice ${escapeHtml(notice.kind)}" role="status">${escapeHtml(notice.message)}</div>` : ""}
      <header class="masthead">
        <a class="brand" href="#overview" aria-label="OutMatch Evolution Lab home">
          <span class="brand-mark">OM</span><span><strong>OutMatch</strong><small>Evolution Lab</small></span>
        </a>
        <nav aria-label="Lab sections">
          <a class="active" href="#overview">Overview</a><a href="#ecology">Ecology</a><a href="#populations">Populations</a><a href="#reports">Reports</a><a href="#replays">Replays</a>
        </nav>
        <span class="system-status"><i></i> Local-first</span>
      </header>
      <main id="main-content">
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
        <section class="progress-panel" id="run-progress" aria-live="polite" aria-busy="${runControls.active}"><div><p class="eyebrow">Durable execution</p><h2>${progressSummary ? escapeHtml(progressSummary.phaseLabel) : "No generation in progress"}</h2>
          <p class="intro">${progressSummary ? `Working toward ${escapeHtml(progressSummary.targetGeneration ?? "the next generation")}. Every displayed result is already represented by a safe local checkpoint.` : "A started generation will report its last safely committed tournament boundary here."}</p></div>
          ${progressSummary ? `<div class="progress-card"><div class="progress-heading"><span id="progress-count">${progressSummary.currentTotal ? `${progressSummary.currentCompleted} / ${progressSummary.currentTotal} current-stage games` : "Between deterministic stages"}</span><b id="progress-percent">${progressSummary.percent}%</b></div>
            <progress id="progress-meter" max="100" value="${progressSummary.percent}">${progressSummary.percent}%</progress><dl><dt>Durable games</dt><dd id="progress-durable">${progressSummary.completedGames}</dd><dt>Challenger rounds</dt><dd>${progressSummary.challengerIterations}</dd><dt>Last checkpoint</dt><dd id="progress-checkpoint">${escapeHtml(formatProgressTimestamp(progressSummary.updatedAt))}</dd></dl>
            <div id="worker-activity" class="operation-status" role="status">${liveProgress ? `<b>Worker activity</b><br>Fight ${liveProgress.completed} of ${liveProgress.total} observed · ${escapeHtml(liveProgress.redId)} vs ${escapeHtml(liveProgress.blueId)}<br><small>Schedule ${liveProgress.scheduleIndex} · ${escapeHtml(formatProgressTimestamp(liveProgress.observedAt))}</small>` : ""}</div></div>`
            : '<div class="progress-card empty-progress"><b>Ready for configuration</b><span>Review controls and interventions before starting the next generation.</span></div>'}
          <div class="run-actions" aria-label="Generation execution controls">
            <button id="run-next-button" type="button" ${runControls.runNextDisabled ? "disabled" : ""}>Run next generation</button>
            <label>Generations<input id="run-count" type="number" min="2" max="100" value="2" ${runControls.countDisabled ? "disabled" : ""}></label>
            <button id="run-many-button" type="button" ${runControls.runManyDisabled ? "disabled" : ""}>Run N generations</button>
            <button id="pause-run-button" class="ghost" type="button" ${runControls.pauseDisabled ? "disabled" : ""}>Pause after current game</button>
            <button id="resume-run-button" class="ghost" type="button" ${runControls.resumeDisabled ? "disabled" : ""}>Resume</button>
            <button id="stop-run-button" class="ghost" type="button" ${runControls.stopDisabled ? "disabled" : ""}>Stop at generation boundary</button>
          </div>
          ${runOperation.status === "pause_requested" ? '<p class="operation-status" role="status">Pause requested; finishing the current game and saving its checkpoint.</p>' : ""}
          ${runControls.paused && runOperation.status !== "pause_requested" ? '<p class="operation-status" role="status"><b>Execution is paused.</b> No fights are running. Press Resume to continue from the durable checkpoint.</p>' : ""}
          ${runOperation.status === "failed" ? `<div class="operation-error" role="alert"><b>${runOperation.errorKind === "persistence" ? "Persistence failure" : runOperation.errorKind === "execution" ? "Execution failure" : "Run failure"}</b><span>${escapeHtml(runOperation.errorMessage)}</span>${Number.isSafeInteger(runOperation.safeCursor) ? `<small>Last safe cursor: ${runOperation.safeCursor}</small>` : ""}</div>` : ""}
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
        <section class="populations-panel" id="populations"><div><p class="eyebrow">Immutable lineage</p><h2>Populations</h2>
          <p class="intro">Browse the selected checkpoint without changing archived genomes, rankings, or provenance.</p></div>
          ${generation?.checkpoint?.population?.length ? `<div class="population-browser"><div class="population-summaries">${populationView.summaries.map(summary => `<button class="population-summary ghost" type="button" data-population="${escapeHtml(summary.population)}"><b>${escapeHtml(summary.population)}</b><span>${summary.count}</span></button>`).join("")}</div>
            <div class="population-toolbar"><label>Filter<input id="population-filter" value="${escapeHtml(populationOptions.query ?? "")}" placeholder="ID, name, origin, parent"></label><label>Population<select id="population-select"><option value="all">All populations</option>${options(R29_POPULATIONS, value => value, value => value)}</select></label><label>Sort<select id="population-sort">${options(["rank", "id", "name", "origin", "fitness", "training", "kills", "pokes", "parentage"], value => value, value => value)}</select></label></div>
            <div class="population-table" tabindex="0"><table><caption>Generals in the selected immutable generation</caption><thead><tr><th>Rank</th><th>General</th><th>Population</th><th>Origin</th><th>Fitness</th><th>Training / game (P · A · C)</th><th>Kills / game (P · A · C)</th><th>Pokes / game</th><th>Parentage</th></tr></thead><tbody>${populationView.rows.map(row => `<tr><td>${row.rank ?? "—"}</td><td><button class="general-detail-link" type="button" data-general-id="${escapeHtml(row.id)}">${escapeHtml(row.name)}</button><small>${escapeHtml(row.id)}</small></td><td>${escapeHtml(row.population)}</td><td>${escapeHtml(row.origin)}</td><td>${row.fitness ?? "—"}</td><td>${unitRateText(row, "trainedPerGame", row.training)}</td><td>${unitRateText(row, "killsPerGame", row.kills)}</td><td>${row.pokes ?? "—"}</td><td>${escapeHtml(row.parentage)}</td></tr>`).join("")}</tbody></table></div>
            ${populationView.detail ? `<aside class="general-detail"><p class="eyebrow">General detail</p><h3>${escapeHtml(populationView.detail.row.name)}</h3><dl><dt>ID</dt><dd>${escapeHtml(populationView.detail.row.id)}</dd><dt>Origin</dt><dd>${escapeHtml(populationView.detail.row.origin)}</dd><dt>Parents</dt><dd>${escapeHtml(populationView.detail.row.parentage)}</dd><dt>Fitness</dt><dd>${populationView.detail.row.fitness ?? "—"}</dd></dl><details><summary>Fitness & unit behavior</summary><pre>${escapeHtml(JSON.stringify({ fitness: populationView.detail.fitness, unitRates: populationView.detail.unitRates }, null, 2))}</pre></details><details><summary>Genome</summary><pre>${escapeHtml(JSON.stringify(populationView.detail.genome, null, 2))}</pre></details><details><summary>Provenance</summary><pre>${escapeHtml(JSON.stringify(populationView.detail.provenance, null, 2))}</pre></details><button id="intervene-from-general" class="ghost" type="button" data-general-id="${escapeHtml(populationView.detail.row.id)}">Queue intervention</button></aside>` : ""}</div>`
            : '<div class="population-browser empty-progress"><b>No complete population selected</b><span>Select an immutable generation to browse its lineage.</span></div>'}
        </section>
        <section class="matchups-panel" id="replays"><div><p class="eyebrow">Deterministic laboratory</p><h2>Matchups & replay</h2><p class="intro">Exhibitions use explicit colors and are stored separately from the evolutionary ledger.</p></div>
          ${matchupGenomes.length ? `<div class="matchup-card"><div class="matchup-selectors"><label>Red general<select id="matchup-red"><option value="">Choose red</option>${options(matchupGenomes, genome => genome.id, genome => genome.name ?? genome.id)}</select></label><label>Blue general<select id="matchup-blue"><option value="">Choose blue</option>${options(matchupGenomes, genome => genome.id, genome => genome.name ?? genome.id)}</select></label><button id="run-exhibition" type="button" ${!matchup.redId || !matchup.blueId || matchup.redId === matchup.blueId ? "disabled" : ""}>Run exhibition</button></div>
            <div class="matchup-labels"><span>Historical · evolutionary ledger</span><span>Exhibition · separate replay store</span></div>${matchup.history ? `<p>${matchup.history.games} historical games · ${matchup.history.wins[matchup.redId]} red wins · ${matchup.history.wins[matchup.blueId]} blue wins · ${matchup.history.wins.draws} draws</p>` : ""}
            <div class="replay-list">${(matchup.replays ?? []).map(record => `<button class="replay-select ghost" type="button" data-replay-id="${escapeHtml(record.replayId)}"><b>Exhibition</b> ${escapeHtml(record.game.redId)} vs ${escapeHtml(record.game.blueId)}</button>`).join("") || "No exhibition replays saved."}</div>
            ${matchup.selectedReplay ? `<div class="replay-view"><h3>Stored board replay</h3><p>Frame ${replayView.index + 1} of ${replayView.total}${replayView.round == null ? "" : ` · Round ${escapeHtml(replayView.round)}`}${replayView.turn ? ` · ${escapeHtml(replayView.turn)} turn` : ""}</p>
              <svg class="reach-board" viewBox="0 0 100 100" role="img" aria-label="Reach board at replay frame ${replayView.index + 1}">${replayView.cells.map(cell => `<circle class="board-cell${cell.base ? ` base-${cell.base}` : ""}" cx="${cell.x}" cy="${cell.y}" r="5"></circle>`).join("")}${replayView.units.map(unit => `<g class="board-unit side-${escapeHtml(unit.side)}${unit.active ? "" : " inactive"}" transform="translate(${unit.x} ${unit.y})"><circle r="4"></circle><text text-anchor="middle" dominant-baseline="central">${escapeHtml(unit.type ?? "?")}</text><title>${escapeHtml(unit.id)}</title></g>`).join("")}</svg>
              <div class="replay-controls"><button id="replay-previous" type="button"${replayView.index === 0 ? " disabled" : ""}>Previous</button><input id="replay-frame" type="range" min="0" max="${replayView.total - 1}" value="${replayView.index}" aria-label="Replay frame"><button id="replay-next" type="button"${replayView.index === replayView.total - 1 ? " disabled" : ""}>Next</button></div>
              <p class="replay-action">${replayView.action ? `Action: ${escapeHtml(replayView.action.kind)} · unit ${escapeHtml(replayView.action.unitId)}` : "Initial board state"}</p><details><summary>Raw stored frame</summary><pre>${escapeHtml(JSON.stringify(replayFrames[replayView.index], null, 2))}</pre></details></div>` : ""}</div>` : '<div class="matchup-card empty-progress"><b>No population available</b><span>Select a completed generation to launch an exhibition.</span></div>'}
        </section>
        <section class="reports-panel" id="reports"><div><p class="eyebrow">Immutable analytics</p><h2>Generation reports</h2>
          <p class="intro">Reports are read directly from the selected completed generation. Downloads never alter its evolutionary ledger.</p></div>
          ${reportView.selected ? `<div class="report-card"><div class="report-toolbar"><label>Report<select id="report-select">${options(reportView.reports, report => report.id, report => report.label)}</select></label>
            <div><button id="report-json" class="ghost" type="button">JSON</button><button id="report-csv" class="ghost" type="button" ${reportView.table ? "" : "disabled"}>CSV</button></div></div>
            <h3>${escapeHtml(reportView.selected.label)}</h3>${reportView.table ? `<div class="matrix-scroll"><table><thead><tr>${reportView.table.columns.map(column => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${reportView.table.rows.map(row => `<tr>${row.map((value, index) => `<td>${value == null ? "—" : escapeHtml(reportView.matrix && index > 0 && Number.isFinite(value) ? value.toFixed(3) : value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
              : `<pre>${escapeHtml(JSON.stringify(reportView.selected.value, null, 2))}</pre>`}</div>`
            : '<div class="report-card empty-progress"><b>No archived reports selected</b><span>Choose a completed generation to inspect its immutable analytics.</span></div>'}
        </section>
      </main>
      <footer><span>OutMatch Reach · deterministic by design</span><span>Data stays on this device</span></footer>
      <dialog id="new-run-dialog" aria-labelledby="new-run-title"><form id="new-run-form" method="dialog"><p class="eyebrow">New workspace</p><h2 id="new-run-title">Create a run</h2>
        <label>Run ID<input name="runId" required pattern="[A-Za-z0-9._-]+" placeholder="reach-experiment"></label>
        <label>Title<input name="title" required placeholder="My evolution branch"></label>
        <div class="dialog-actions"><button value="cancel" formnovalidate>Cancel</button><button value="create">Create run</button></div></form></dialog>
      <dialog id="import-dialog" aria-labelledby="import-dialog-title"><form id="import-form" method="dialog"><p class="eyebrow">Portable generation</p><h2 id="import-dialog-title">Import .omgen</h2>
        <label>Archive<input id="import-file" name="file" type="file" accept=".omgen" required></label>
        <label>Target run ID<input id="import-run-id" name="runId" required></label>
        <label>Title<input id="import-title" name="title" required></label>
        <p id="import-summary" class="dialog-summary">Choose an archive to validate it before import.</p>
        <div class="dialog-actions"><button value="cancel" formnovalidate>Cancel</button><button id="import-submit" value="import" disabled>Import generation</button></div></form></dialog>
      <dialog id="delete-run-dialog" aria-labelledby="delete-run-title"><form id="delete-run-form" method="dialog"><p class="eyebrow">Permanent cleanup</p><h2 id="delete-run-title">Delete ${escapeHtml(run?.title ?? "run")}?</h2>
        <p class="dialog-summary">This removes the run, every completed generation, ledger, progress checkpoint, and replay stored under it.</p>
        <div class="dialog-actions"><button value="cancel">Cancel</button><button class="danger" value="delete">Delete permanently</button></div></form></dialog>
      <dialog id="intervention-dialog" aria-labelledby="intervention-title"><form id="intervention-form" method="dialog"><p class="eyebrow">Audited change</p><h2 id="intervention-title">Queue intervention</h2>
        <label>Operation<select name="type"><option value="manual-move">Move / manual migrant</option><option value="copy-entrant">Copy entrant</option><option value="replacement-upload">Replace with uploaded genome</option></select></label>
        <label>Source general ID<input name="generalId" required></label>
        <label>Source population<select name="from">${options(R29_POPULATIONS, value => value, value => value)}</select></label>
        <label>Destination population<select name="to">${options(R29_POPULATIONS, value => value, value => value)}</select></label>
        <label>New ID (copy only)<input name="newId"></label><label>New name (copy only)<input name="newName"></label>
        <label>Replacement genome file<input name="genomeFile" type="file" accept=".json,application/json"><small>JSON only, maximum 1 MB.</small></label>
        <label>Or paste replacement JSON<textarea name="genomeJson" placeholder='{"id":"MANUAL_R30_001","name":"Uploaded General","genes":{...}}'></textarea></label>
        <label>Audit note<textarea name="note" required placeholder="Why is this population change being made?"></textarea></label>
        <div class="dialog-actions"><button value="cancel" formnovalidate>Cancel</button><button value="queue">Queue change</button></div></form></dialog>
    </div>`;
}
