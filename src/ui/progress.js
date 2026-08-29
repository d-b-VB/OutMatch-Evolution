import { PROGRESS_PHASES } from "../persistence/schema.js";

const PHASE_LABELS = Object.freeze({
  initialized: "Initialized",
  breeding_migration: "Breeding & migration",
  stage1_running: "Tournament · Stage 1",
  stage1_ranking: "Ranking · Stage 1",
  stage2_running: "Tournament · Stage 2",
  stage2_ranking: "Ranking · Stage 2",
  challenger_running: "Challenger cleanup",
  finalizing: "Final audit & commit"
});

export function summarizeRunProgress(progress) {
  if (progress == null) return null;
  if (!PROGRESS_PHASES.includes(progress.phase)) throw new Error(`Unknown progress phase: ${progress.phase}`);
  const schedule = Array.isArray(progress.schedule) ? progress.schedule : [];
  const cursor = Number.isSafeInteger(progress.cursor) ? progress.cursor : 0;
  if (cursor < 0 || cursor > schedule.length) throw new Error("Progress cursor is outside the current schedule");
  const completedLedger = Array.isArray(progress.completedLedger) ? progress.completedLedger.length : 0;
  const currentCompleted = Math.min(cursor, schedule.length);
  const percent = schedule.length === 0 ? (progress.phase === "finalizing" ? 100 : 0)
    : Math.floor((currentCompleted / schedule.length) * 100);
  const challengerIterations = Array.isArray(progress.challengerHistory) ? progress.challengerHistory.length : 0;
  return {
    phase: progress.phase,
    phaseLabel: PHASE_LABELS[progress.phase],
    currentCompleted,
    currentTotal: schedule.length,
    completedGames: completedLedger + currentCompleted,
    percent,
    challengerIterations,
    updatedAt: progress.updatedAt ?? null,
    targetGeneration: progress.targetGeneration ?? null
  };
}

export function formatProgressTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "Not checkpointed";
  return new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC");
}
