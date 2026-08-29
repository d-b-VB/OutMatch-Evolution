import assert from "node:assert/strict";
import test from "node:test";
import { renderLabShell } from "../../src/ui/render.js";
import { createLabState, selectGeneration, selectRun, selectedLabRecords } from "../../src/ui/state.js";

const runs = [
  { runId: "run-a", title: "Alpha" }, { runId: "run-b", title: "Beta" }
];
const generations = [
  { runId: "run-a", generation: "ReachR30", fingerprint: "a30" },
  { runId: "run-a", generation: "ReachR29", fingerprint: "a29" },
  { runId: "run-b", generation: "ReachR31", fingerprint: "b31" }
];

test("lab state honors valid persisted selection and falls back safely", () => {
  const selected = createLabState({ runs, generations, settings: { selectedRunId: "run-b", selectedGeneration: "ReachR31" } });
  assert.deepEqual(selectedLabRecords(selected), { run: runs[1], generation: generations[2] });
  const fallback = createLabState({ runs, generations, settings: { selectedRunId: "missing", selectedGeneration: "none" } });
  assert.equal(fallback.selectedRunId, "run-a");
  assert.equal(fallback.selectedGeneration, "ReachR30");
});

test("run and generation selection remain scoped", () => {
  let state = createLabState({ runs, generations });
  state = selectRun(state, "run-b");
  assert.equal(state.selectedGeneration, "ReachR31");
  assert.throws(() => selectGeneration(state, "ReachR30"), /Unknown generation/);
  assert.throws(() => selectRun(state, "missing"), /Unknown run/);
});

test("shell renders repository summary and escapes stored labels", () => {
  const state = createLabState({ runs: [{ runId: "x", title: "<script>" }], generations: [] });
  const html = renderLabShell(state);
  assert.match(html, /Run ready/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Local runs/);
});

test("empty state renders disabled selectors and onboarding copy", () => {
  const html = renderLabShell(createLabState());
  assert.match(html, /No local runs/);
  assert.match(html, /No runs yet/);
  assert.match(html, /Start a new evolutionary branch/);
  assert.match(html, /new-run-dialog/);
  assert.match(html, /import-file/);
});

test("shell renders escaped success and error notices", () => {
  const html = renderLabShell(createLabState(), { notice: { kind: "error", message: "Bad <archive>" } });
  assert.match(html, /notice error/);
  assert.match(html, /Bad &lt;archive&gt;/);
});

test("selected generations expose export, delete, and storage status", () => {
  const state = createLabState({ runs, generations });
  const html = renderLabShell(state, { storage: { persisted: true, quota: 104857600, available: 52428800 } });
  assert.match(html, /export-button/);
  assert.match(html, /delete-run-dialog/);
  assert.match(html, /Durable/);
  assert.match(html, /50 MB available/);
});

test("ecology controls render explanations and deterministic review", () => {
  const state = createLabState({ runs, generations });
  const controls = {
    schema: "outmatch-lab-controls-v1", workerCount: 3, migrationEnabled: false,
    maximumMigrants: 0, wildcardProbability: 0.2, mutationProbability: 0.01, interventions: []
  };
  const html = renderLabShell(state, { draftControls: controls, controlReview: { controls, controlsHash: "sha256:abc" } });
  assert.match(html, /Generation controls/);
  assert.match(html, /Changes throughput only/);
  assert.match(html, /sha256:abc/);
  assert.match(html, /Migration<\/dt><dd>Off/);
});

test("intervention queue renders audited move and copy operations safely", () => {
  const state = createLabState({ runs, generations });
  const controls = {
    schema: "outmatch-lab-controls-v1", workerCount: 4, migrationEnabled: true,
    maximumMigrants: 4, wildcardProbability: 0.5, mutationProbability: 0.02,
    interventions: [
      { type: "manual-move", generalId: "PL-1", from: "pike_lords", to: "horse_hunters", note: "Move <review>" },
      { type: "copy-entrant", sourceGeneralId: "PL-2", to: "generalists", newId: "COPY-1", newName: "Copy", note: "Copy review" }
    ]
  };
  const html = renderLabShell(state, { draftControls: controls });
  assert.match(html, /PL-1: pike_lords → horse_hunters/);
  assert.match(html, /PL-2 → COPY-1 in generalists/);
  assert.match(html, /Move &lt;review&gt;/);
  assert.match(html, /remove-intervention/);
  assert.match(html, /intervention-dialog/);
});

test("durable progress renders phase, safe cursor, and checkpoint metadata", () => {
  const state = createLabState({ runs, generations });
  const html = renderLabShell(state, { progress: {
    phase: "challenger_running", cursor: 2, schedule: [{}, {}, {}, {}],
    completedLedger: [{}, {}, {}], challengerHistory: [{ completed: true }],
    targetGeneration: "ReachR30", updatedAt: "2026-08-29T12:30:00.000Z"
  } });
  assert.match(html, /Challenger cleanup/);
  assert.match(html, /2 \/ 4 current-stage games/);
  assert.match(html, /value="50"/);
  assert.match(html, /<dd>5<\/dd>/);
  assert.match(html, /2026-08-29 12:30:00 UTC/);
});

test("archived report matrices render with safe download controls", () => {
  const reportGeneration = {
    ...generations[0], reports: { elimination: { matrix: {
      alpha: { alpha: null, beta: 0.25 }, beta: { alpha: 0.75, beta: null }
    } } }, rankings: [], migration: {}, breeding: {}
  };
  const state = createLabState({ runs, generations: [reportGeneration] });
  const html = renderLabShell(state, { selectedReportId: "elimination" });
  assert.match(html, /Generation reports/);
  assert.match(html, /Elimination matrix/);
  assert.match(html, /<td>0.250<\/td>/);
  assert.match(html, /report-json/);
  assert.match(html, /report-csv/);
});
