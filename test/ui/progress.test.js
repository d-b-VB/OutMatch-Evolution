import assert from "node:assert/strict";
import test from "node:test";
import { formatProgressTimestamp, summarizeRunProgress } from "../../src/ui/progress.js";

test("running progress reports the durable ledger and current schedule separately", () => {
  const summary = summarizeRunProgress({
    phase: "stage2_running", cursor: 3,
    schedule: [{}, {}, {}, {}, {}, {}, {}, {}], completedLedger: [{}, {}],
    challengerHistory: [], targetGeneration: "ReachR30", updatedAt: "2026-08-29T12:30:00.000Z"
  });
  assert.deepEqual(summary, {
    phase: "stage2_running", phaseLabel: "Tournament · Stage 2", currentCompleted: 3,
    currentTotal: 8, completedGames: 5, percent: 37, challengerIterations: 0,
    updatedAt: "2026-08-29T12:30:00.000Z", targetGeneration: "ReachR30"
  });
});

test("between-stage and finalization checkpoints never invent game progress", () => {
  const ranking = summarizeRunProgress({ phase: "stage1_ranking", cursor: 0, schedule: [], completedLedger: [] });
  assert.equal(ranking.percent, 0);
  assert.equal(ranking.phaseLabel, "Ranking · Stage 1");
  assert.equal(summarizeRunProgress({ phase: "finalizing", cursor: 0, schedule: [] }).percent, 100);
  assert.equal(summarizeRunProgress(null), null);
});

test("progress validation rejects corrupt cursors and formats durable timestamps", () => {
  assert.throws(() => summarizeRunProgress({ phase: "unknown", cursor: 0, schedule: [] }), /Unknown/);
  assert.throws(() => summarizeRunProgress({ phase: "stage1_running", cursor: 2, schedule: [{}] }), /cursor/);
  assert.equal(formatProgressTimestamp("2026-08-29T12:30:00.000Z"), "2026-08-29 12:30:00 UTC");
  assert.equal(formatProgressTimestamp("invalid"), "Not checkpointed");
});
