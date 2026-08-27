import { createGameRequest, validateGameResult, WORKER_PROTOCOL_VERSION } from "./worker-protocol.js";

function defaultWorkerFactory() {
  return new Worker(new URL("./game-worker.js", import.meta.url), { type: "module" });
}

/** Execute a schedule on a bounded Worker pool and restore deterministic schedule-index order. */
export function runWorkerSchedule({
  schedule,
  genomes,
  workerCount = 1,
  createWorker = defaultWorkerFactory,
  engineOptions = { depth: 3 },
  onProgress = () => {}
}) {
  if (!Array.isArray(schedule)) return Promise.reject(new Error("Worker schedule must be an array"));
  if (!(genomes instanceof Map)) return Promise.reject(new Error("Worker genomes must be indexed by ID"));
  if (!Number.isSafeInteger(workerCount) || workerCount < 1) return Promise.reject(new Error("Worker count must be positive"));
  if (typeof createWorker !== "function" || typeof onProgress !== "function") {
    return Promise.reject(new Error("Invalid Worker pool callback"));
  }
  if (schedule.length === 0) return Promise.resolve([]);

  return new Promise((resolve, reject) => {
    const workers = [];
    const results = [];
    let nextJob = 0;
    let completed = 0;
    let settled = false;

    const terminateAll = () => {
      for (const state of workers) state.worker.terminate();
    };
    const fail = (state, error) => {
      if (settled) return;
      settled = true;
      terminateAll();
      const game = state?.request?.game;
      const detail = game ? ` at schedule index ${game.scheduleIndex} (${game.redId} vs ${game.blueId})` : "";
      reject(new Error(`Worker tournament failed${detail}: ${error?.message ?? error}`));
    };
    const dispatch = state => {
      if (settled || nextJob >= schedule.length) return;
      const game = schedule[nextJob];
      nextJob += 1;
      const redGenome = genomes.get(game.redId);
      const blueGenome = genomes.get(game.blueId);
      try {
        state.request = createGameRequest({
          jobId: `game-${game.scheduleIndex}`,
          game,
          redGenome,
          blueGenome,
          engineOptions
        });
        state.worker.postMessage(state.request);
      } catch (error) {
        fail(state, error);
      }
    };
    const receive = (state, message) => {
      if (settled) return;
      if (message?.type === "game_error" && message.protocol === WORKER_PROTOCOL_VERSION) {
        fail(state, new Error(`${message.error?.name ?? "Error"}: ${message.error?.message ?? "unknown Worker error"}`));
        return;
      }
      try {
        const result = validateGameResult(message, state.request);
        results.push(result.ledgerRow);
        completed += 1;
        onProgress({
          stage: state.request.game.stage,
          challengerIteration: state.request.game.challengerIteration,
          completed,
          total: schedule.length
        });
        if (completed === schedule.length) {
          settled = true;
          terminateAll();
          results.sort((first, second) => first.scheduleIndex - second.scheduleIndex);
          resolve(results);
        } else {
          dispatch(state);
        }
      } catch (error) {
        fail(state, error);
      }
    };

    const size = Math.min(workerCount, schedule.length);
    for (let index = 0; index < size; index += 1) {
      const worker = createWorker(index);
      const state = { worker, request: null };
      workers.push(state);
      worker.addEventListener("message", event => receive(state, event.data));
      worker.addEventListener("error", event => fail(state, event.error ?? new Error(event.message ?? "Worker crashed")));
    }
    for (const state of workers) dispatch(state);
  });
}
