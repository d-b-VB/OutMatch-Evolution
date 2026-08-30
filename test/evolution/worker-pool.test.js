import assert from "node:assert/strict";
import test from "node:test";
import { processWorkerMessage } from "../../src/evolution/game-worker.js";
import { createScheduledGame } from "../../src/evolution/schedule.js";
import { createGameRequest, WORKER_PROTOCOL_VERSION } from "../../src/evolution/worker-protocol.js";
import { runWorkerSchedule } from "../../src/evolution/worker-pool.js";

const genomes = new Map(["a", "b", "c"].map(id => [id, { id, genes: {} }]));
const schedule = [
  createScheduledGame({ stage: "stage1_core", scheduleIndex: 2, redId: "a", blueId: "b" }),
  createScheduledGame({ stage: "stage1_core", scheduleIndex: 0, redId: "b", blueId: "c" }),
  createScheduledGame({ stage: "stage1_core", scheduleIndex: 1, redId: "c", blueId: "a" })
];

function resultFor(request) {
  return {
    protocol: WORKER_PROTOCOL_VERSION,
    type: "game_result",
    jobId: request.jobId,
    scheduleIndex: request.game.scheduleIndex,
    ledgerRow: { ...request.game, outcome: "draw", winner: "", round: 20 }
  };
}

class FakeWorker {
  constructor(delays = {}, failIndex = null) {
    this.delays = delays;
    this.failIndex = failIndex;
    this.listeners = { message: [], error: [] };
    this.terminated = false;
  }

  addEventListener(type, listener) { this.listeners[type].push(listener); }
  postMessage(request) {
    setTimeout(() => {
      if (request.game.scheduleIndex === this.failIndex) {
        for (const listener of this.listeners.message) listener({ data: {
          protocol: WORKER_PROTOCOL_VERSION, type: "game_error", jobId: request.jobId,
          scheduleIndex: request.game.scheduleIndex, error: { name: "GameError", message: "boom" }
        } });
      } else {
        for (const listener of this.listeners.message) listener({ data: resultFor(request) });
      }
    }, this.delays[request.game.scheduleIndex] ?? 0);
  }
  terminate() { this.terminated = true; }
}

test("Worker entry point posts successful results and structured failures", () => {
  const request = createGameRequest({ jobId: "job", game: schedule[0], redGenome: genomes.get("a"), blueGenome: genomes.get("b"), engineOptions: { depth: 1 } });
  const messages = [];
  processWorkerMessage(request, message => messages.push(message), resultFor);
  assert.equal(messages[0].type, "game_result");
  processWorkerMessage(request, message => messages.push(message), () => { throw new TypeError("broken"); });
  assert.deepEqual(messages[1].error, { name: "TypeError", message: "broken" });
});

test("bounded pool restores schedule order and reports progress despite out-of-order completion", async () => {
  const workers = [];
  const progress = [];
  const rows = await runWorkerSchedule({
    schedule,
    genomes,
    workerCount: 2,
    engineOptions: { depth: 1 },
    createWorker: () => {
      const worker = new FakeWorker({ 2: 20, 0: 1, 1: 1 });
      workers.push(worker);
      return worker;
    },
    onProgress: event => progress.push(event)
  });
  assert.deepEqual(rows.map(row => row.scheduleIndex), [0, 1, 2]);
  assert.deepEqual(progress.map(event => event.completed), [1, 2, 3]);
  assert.ok(progress.every(event => event.total === 3 && event.stage === "stage1_core"));
  assert.ok(progress.every(event => Number.isSafeInteger(event.scheduleIndex) && event.redId && event.blueId));
  assert.ok(workers.every(worker => worker.terminated));
});

test("pool propagates correlated Worker failures and terminates every Worker", async () => {
  const workers = [];
  await assert.rejects(runWorkerSchedule({
    schedule,
    genomes,
    workerCount: 2,
    engineOptions: { depth: 1 },
    createWorker: () => {
      const worker = new FakeWorker({}, 0);
      workers.push(worker);
      return worker;
    }
  }), /schedule index 0.*GameError: boom/);
  assert.ok(workers.every(worker => worker.terminated));
});

test("Worker counts 1, 2, and 4 produce byte-equivalent ordered ledgers", async () => {
  const outputs = [];
  for (const workerCount of [1, 2, 4]) {
    const rows = await runWorkerSchedule({
      schedule,
      genomes,
      workerCount,
      engineOptions: { depth: 1 },
      createWorker: index => new FakeWorker({ 2: 5 + index, 0: 2, 1: index })
    });
    outputs.push(JSON.stringify(rows));
  }
  assert.equal(outputs[1], outputs[0]);
  assert.equal(outputs[2], outputs[0]);
});
