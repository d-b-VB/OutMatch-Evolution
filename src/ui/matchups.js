import { createExhibitionRequest, validateExhibitionResult } from "../evolution/worker-protocol.js";
import { PERSISTENCE_SCHEMAS } from "../persistence/schema.js";

function workerResult(worker, request) {
  return new Promise((resolve, reject) => {
    const finish = callback => value => { worker.terminate(); callback(value); };
    worker.addEventListener("message", finish(event => {
      try { resolve(validateExhibitionResult(event.data, request)); } catch (error) { reject(error); }
    }));
    worker.addEventListener("error", finish(event => reject(event.error ?? new Error(event.message ?? "Worker crashed"))));
    worker.postMessage(request);
  });
}

export function historicalMatchup(rows, firstId, secondId) {
  const matching = (rows ?? []).filter(row => (row.redId === firstId && row.blueId === secondId)
    || (row.redId === secondId && row.blueId === firstId));
  const wins = { [firstId]: 0, [secondId]: 0, draws: 0 };
  for (const row of matching) {
    if (row.outcome === "draw" || !row.winner) wins.draws += 1;
    else {
      const winner = row.winner === "R" ? row.redId : row.blueId;
      if (Object.hasOwn(wins, winner)) wins[winner] += 1;
    }
  }
  return { label: "Historical evolutionary games", games: matching.length, wins, rows: structuredClone(matching) };
}

/** Run and separately persist one explicitly colored exhibition game. */
export async function runExhibition({
  runId, generation, redGenome, blueGenome, replayRepository,
  createWorker = () => new Worker(new URL("../evolution/game-worker.js", import.meta.url), { type: "module" }),
  replayId = `exhibition-${Date.now()}`, now = () => new Date().toISOString(), depth = 3
}) {
  if (typeof replayRepository?.save !== "function") throw new Error("Exhibition requires replay storage");
  const request = createExhibitionRequest({
    jobId: replayId, redGenome: structuredClone(redGenome), blueGenome: structuredClone(blueGenome),
    engineOptions: { depth }
  });
  const response = await workerResult(createWorker(), request);
  const record = {
    schema: PERSISTENCE_SCHEMAS.replay, runId, replayId, generation, createdAt: now(),
    game: { kind: "exhibition", label: "Exhibition game", ...response.game }
  };
  await replayRepository.save(record);
  return structuredClone(record);
}

/** Restore the exact stored board sequence; no engine or report is rerun. */
export function replayBoardSequence(record) {
  if (record?.game?.kind !== "exhibition" || !Array.isArray(record.game.replay?.frames)
    || !Array.isArray(record.game.replay?.actions)
    || record.game.replay.frames.length !== record.game.replay.actions.length + 1) {
    throw new Error("Stored exhibition replay is incomplete");
  }
  return structuredClone(record.game.replay.frames);
}
