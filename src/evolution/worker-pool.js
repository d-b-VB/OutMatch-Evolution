import { createGameRequest, createGenerationInitialization, createInitializedGameRequest,
  validateGameResult, WORKER_PROTOCOL_VERSION } from "./worker-protocol.js";

function defaultWorkerFactory() {
  return new Worker(new URL("./game-worker.js", import.meta.url), { type: "module" });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function matchupKey(game, genomes, engineOptions) {
  return canonical({ engineRulesVersion: "reach-v1", engineOptions,
    red: genomes.get(game.redId)?.genes, blue: genomes.get(game.blueId)?.genes });
}

function cacheCombatRow(row) {
  const copy = { ...row };
  for (const key of ["stage", "scheduleIndex", "redId", "blueId"]) delete copy[key];
  return copy;
}

function scheduledCachedRow(game, combat) {
  return { stage: game.stage, scheduleIndex: game.scheduleIndex, redId: game.redId,
    ...combat, blueId: game.blueId,
    ...(game.challengerIteration == null ? {} : { challengerIteration: game.challengerIteration }) };
}

/** Long-lived initialized Worker pool shared by all checkpoint batches in a stage. */
export class ReusableWorkerPoolSession {
  constructor({ genomes, workerCount = 1, createWorker = defaultWorkerFactory,
    engineOptions = { depth: 3 }, cache = new Map(), onProgress = () => {} }) {
    if (!(genomes instanceof Map) || !Number.isSafeInteger(workerCount) || workerCount < 1) {
      throw new Error("Reusable Worker pool requires indexed genomes and a positive Worker count");
    }
    this.genomes = genomes; this.workerCount = workerCount; this.createWorker = createWorker;
    this.engineOptions = engineOptions; this.cache = cache; this.onProgress = onProgress;
    this.workers = []; this.initialized = false; this.closed = false;
    this.stats = { workerPoolStartups: 0, newlySimulatedGames: 0, cacheHits: 0 };
  }

  async initialize() {
    if (this.initialized) return;
    if (this.closed) throw new Error("Reusable Worker pool is closed");
    const initialization = createGenerationInitialization({ genomes: this.genomes, engineOptions: this.engineOptions });
    this.stats.workerPoolStartups += 1;
    await Promise.all(Array.from({ length: this.workerCount }, (_, index) => new Promise((resolve, reject) => {
      const worker = this.createWorker(index);
      const state = { worker, request: null, ready: false };
      this.workers.push(state);
      worker.addEventListener("message", event => {
        if (!state.ready && event.data?.type === "generation_initialized") { state.ready = true; resolve(); return; }
        if (!state.ready && event.data?.type === "game_error") {
          reject(new Error(`${event.data.error?.name}: ${event.data.error?.message}`)); return;
        }
        state.receive?.(event.data);
      });
      worker.addEventListener("error", event => reject(event.error ?? new Error(event.message ?? "Worker crashed")));
      worker.postMessage(initialization);
    })));
    this.initialized = true;
  }

  async run(schedule) {
    if (!Array.isArray(schedule)) throw new Error("Worker schedule must be an array");
    await this.initialize();
    const results = new Array(schedule.length);
    const pending = [];
    for (let index = 0; index < schedule.length; index += 1) {
      if (!this.genomes.has(schedule[index].redId) || !this.genomes.has(schedule[index].blueId)) {
        throw new Error(`Unknown genome in ${schedule[index].redId} vs ${schedule[index].blueId}`);
      }
      const key = matchupKey(schedule[index], this.genomes, this.engineOptions);
      const cached = this.cache.get(key);
      if (cached) { results[index] = scheduledCachedRow(schedule[index], cached); this.stats.cacheHits += 1;
        this.onProgress({ ...schedule[index], completed: index + 1, total: schedule.length, cacheHit: true }); }
      else pending.push({ index, game: schedule[index], key });
    }
    if (pending.length === 0) return results;
    await new Promise((resolve, reject) => {
      let next = 0; let completed = 0; let settled = false;
      const fail = error => { if (!settled) { settled = true; reject(error); } };
      const dispatch = state => {
        if (next >= pending.length) return;
        const job = pending[next++];
        const request = createInitializedGameRequest({ jobId: `game-${job.game.scheduleIndex}`, game: job.game });
        state.request = { request, job };
        state.receive = message => {
          if (message?.type === "game_error") return fail(new Error(`${message.error?.name}: ${message.error?.message}`));
          try {
            const validated = validateGameResult(message, request);
            results[job.index] = validated.ledgerRow;
            this.cache.set(job.key, cacheCombatRow(validated.ledgerRow));
            this.stats.newlySimulatedGames += 1; completed += 1;
            this.onProgress({ ...job.game, completed: results.filter(Boolean).length, total: schedule.length, cacheHit: false });
            if (completed === pending.length) { settled = true; resolve(); } else dispatch(state);
          } catch (error) { fail(error); }
        };
        state.worker.postMessage(request);
      };
      for (const state of this.workers.slice(0, Math.min(this.workers.length, pending.length))) dispatch(state);
    });
    return results;
  }

  close() { if (this.closed) return; this.closed = true; for (const state of this.workers) state.worker.terminate(); }
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
          scheduleIndex: state.request.game.scheduleIndex,
          redId: state.request.game.redId,
          blueId: state.request.game.blueId,
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
