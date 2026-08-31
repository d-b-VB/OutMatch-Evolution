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
  assert.match(html, /Replace with uploaded genome/);
  assert.match(html, /name="genomeFile" type="file" accept="\.json,application\/json"/);
  assert.match(html, /maximum 1 MB/);
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
  assert.match(html, /<dd id="progress-durable">5<\/dd>/);
  assert.match(html, /2026-08-29 12:30:00 UTC/);
});

test("running progress renders live worker fight diagnostics", () => {
  const state = createLabState({ runs, generations });
  const html = renderLabShell(state, {
    progress: { phase: "stage1_running", cursor: 4, schedule: Array(10).fill({}), completedLedger: [] },
    liveProgress: { completed: 6, total: 10, scheduleIndex: 5, redId: "RED-1", blueId: "BLUE-2",
      underway: [{ redId: "RED-3", blueId: "BLUE-4", scheduleIndex: 6 }],
      firstFightActivity: ["Unit 2 moved to (-3, 0)", "Unit 1 held position"],
      observedAt: "2026-08-30T13:00:00.000Z" }
  });
  assert.match(html, /Worker activity/);
  assert.match(html, /Fight 6 of 10 observed/);
  assert.match(html, /RED-3 vs BLUE-4/);
  assert.match(html, /1 game underway/);
  assert.match(html, /Schedule 5/);
  assert.match(html, /Unit 2 moved to \(-3, 0\)/);
});

test("active execution renders a visible animated battle indicator", () => {
  const state = createLabState({ runs, generations });
  const html = renderLabShell(state, {
    progress: { phase: "stage1_running", cursor: 4, schedule: Array(10).fill({}), completedLedger: [] },
    runOperation: { status: "running", errorKind: null, errorMessage: null, safeCursor: null, stopRequested: false }
  });
  assert.match(html, /battle-orbit/);
  assert.match(html, /Tournament simulation active/);
  assert.match(html, /🐎/);
  assert.match(html, /🏹/);
  assert.match(html, /🛡️/);
});

test("stored progress clearly says when no fights are running", () => {
  const state = createLabState({ runs, generations });
  const html = renderLabShell(state, {
    progress: { phase: "stage1_running", cursor: 371, schedule: Array(400).fill({}), completedLedger: [] }
  });
  assert.match(html, /Execution is paused/);
  assert.match(html, /No fights are running/);
  assert.match(html, /Press Resume/);
});

test("run controls render phase-aware actions and escaped failure details", () => {
  const html = renderLabShell(createLabState({ runs, generations }), {
    controlReview: { controls: { workerCount: 1, migrationEnabled: false, wildcardProbability: 0, mutationProbability: 0 }, controlsHash: "hash" },
    runOperation: {
      status: "failed", errorKind: "persistence", errorMessage: "write <failed>",
      safeCursor: 12, stopRequested: false
    }
  });
  assert.match(html, /Run next generation/);
  assert.match(html, /Run N generations/);
  assert.match(html, /Pause after current game/);
  assert.match(html, /Persistence failure/);
  assert.match(html, /Last safe cursor: 12/);
  assert.doesNotMatch(html, /write <failed>/);
  assert.match(html, /write &lt;failed&gt;/);
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

test("population browser escapes archived lineage and renders independent detail", () => {
  const populationGeneration = {
    ...generations[0],
    checkpoint: {
      population: [{ id: "G<1>", name: "<General>", population: "generalists", genes: { value: "<gene>" } }],
      provenance: { "G<1>": { origin: "cross", fatherId: "F<1>", motherId: "M&2" } }
    },
    rankings: [{ id: "G<1>", rank: 1, fitness: 12, kills: 3 }]
  };
  const html = renderLabShell(createLabState({ runs, generations: [populationGeneration] }), {
    populationOptions: { selectedId: "G<1>" }
  });
  assert.match(html, /Populations/);
  assert.match(html, /&lt;General&gt;/);
  assert.match(html, /F&lt;1&gt; × M&amp;2/);
  assert.match(html, /Fitness & unit behavior/);
  assert.match(html, /&lt;gene&gt;/);
  assert.doesNotMatch(html, /<General>/);
});

test("matchups label historical and exhibition data and render stored replay frames", () => {
  const matchupGeneration = {
    ...generations[0], checkpoint: { population: [
      { id: "A<1>", population: "generalists", genes: {} },
      { id: "B&2", population: "pike_lords", genes: {} }
    ] }
  };
  const selectedReplay = {
    replayId: "replay<1>", game: {
      kind: "exhibition", redId: "A<1>", blueId: "B&2",
      replay: { actions: [{ kind: "move", unitId: "R1" }], frames: [
        { round: 1, turn: "R", units: [{ id: "R1", side: "R", typ: "P", pos: [-3, 0] }] },
        { round: 1, turn: "R", units: [{ id: "R1", side: "R", typ: "P", pos: [-2, 0] }] }
      ] }
    }
  };
  const html = renderLabShell(createLabState({ runs, generations: [matchupGeneration] }), {
    matchup: {
      redId: "A<1>", blueId: "B&2", replays: [selectedReplay], selectedReplay,
      history: { games: 2, wins: { "A<1>": 1, "B&2": 0, draws: 1 } }
    }
  });
  assert.match(html, /Historical · evolutionary ledger/);
  assert.match(html, /Exhibition · separate replay store/);
  assert.match(html, /Frame 1 of 2/);
  assert.match(html, /aria-label="Reach board at replay frame 1"/);
  assert.match(html, /Initial board state/);
  assert.match(html, /A&lt;1&gt; vs B&amp;2/);
  assert.doesNotMatch(html, /A<1>/);
});
