import { renderLabShell } from "../src/ui/render.js";
import { createLabState } from "../src/ui/state.js";

const genomes = [
  { id: "GL-01", name: "North Star", population: "generalists", genes: { action: { progress: 1 } } },
  { id: "PL-01", name: "Pike Line", population: "pike_lords", genes: { action: { progress: 2 } } }
];
const replay = {
  replayId: "visual-replay", game: {
    kind: "exhibition", redId: "GL-01", blueId: "PL-01",
    replay: { actions: [{ kind: "move", unitId: "R1", destination: [-2, 0] }], frames: [
      { round: 1, turn: "R", units: [{ id: "R1", side: "R", typ: "P", pos: [-3, 0], active: true }, { id: "B1", side: "B", typ: "C", pos: [3, 0], active: true }] },
      { round: 1, turn: "R", units: [{ id: "R1", side: "R", typ: "P", pos: [-2, 0], active: false }, { id: "B1", side: "B", typ: "C", pos: [3, 0], active: true }] }
    ] }
  }
};
const generation = {
  runId: "visual-run", generation: "ReachR30", parentGeneration: "ReachR29",
  completedAt: "2026-08-29T00:00:00.000Z", fingerprint: "fnv1a64:visual", ledgerRef: "visual-ledger",
  checkpoint: { population: genomes, provenance: { "GL-01": { origin: "survivor" }, "PL-01": { origin: "cross", fatherId: "PL-10", motherId: "PL-11" } } },
  rankings: [{ id: "GL-01", rank: 1, fitness: 9.5 }, { id: "PL-01", rank: 1, fitness: 8.75 }],
  reports: { elimination: { matrix: { generalists: { generalists: null, pike_lords: 0.6 }, pike_lords: { generalists: 0.4, pike_lords: null } } } },
  migration: { selected: [] }, breeding: { births: 245 }, interventions: [], manifest: {}, controls: {}
};
const run = { runId: "visual-run", title: "Visual acceptance branch", activeGeneration: "ReachR30" };
const state = createLabState({ runs: [run], generations: [generation] });
const progress = {
  phase: "stage1_running", cursor: 37,
  schedule: Array.from({ length: 100 }, (_, scheduleIndex) => ({ stage: "stage1_core", scheduleIndex })),
  partialLedger: Array.from({ length: 37 }, (_, scheduleIndex) => ({ stage: "stage1_core", scheduleIndex })),
  completedLedger: [], challengerHistory: [], targetGeneration: "ReachR31", updatedAt: "2026-08-29T12:30:00.000Z"
};
document.querySelector("#scenario").innerHTML = renderLabShell(state, {
  storage: { persisted: true, quota: 1_000_000_000, available: 750_000_000 },
  progress,
  runOperation: { status: "running", errorKind: null, errorMessage: null, safeCursor: 37, stopRequested: false },
  populationOptions: { selectedId: "PL-01" }, selectedReportId: "elimination",
  matchup: { redId: "GL-01", blueId: "PL-01", history: { games: 2, wins: { "GL-01": 1, "PL-01": 0, draws: 1 } }, replays: [replay], selectedReplay: replay }
});
