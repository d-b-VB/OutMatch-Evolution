import assert from "node:assert/strict";
import test from "node:test";
import { handleGameRequest } from "../../src/evolution/worker-protocol.js";
import { PERSISTENCE_SCHEMAS, validateLedgerRecord } from "../../src/persistence/schema.js";
import { historicalMatchup, replayBoardSequence, runExhibition } from "../../src/ui/matchups.js";

const genomes = [{ id: "A", genes: {} }, { id: "B", genes: {} }];

class FakeWorker {
  listeners = {};
  addEventListener(name, callback) { this.listeners[name] = callback; }
  postMessage(request) { queueMicrotask(() => this.listeners.message({ data: handleGameRequest(request, fakeGame) })); }
  terminate() { this.terminated = true; }
}

function fakeGame(red, blue, options) {
  assert.equal(options.captureReplay, true);
  return {
    result: { outcome: "draw", winner: "", round: 1 }, ledger: { outcome: "draw", winner: "" },
    replay: { actions: [{ kind: "move", unitId: "R1" }], frames: [{ units: [] }, { units: [{ id: "R1" }] }] }
  };
}

test("historical statistics include only the selected evolutionary pairing", () => {
  const summary = historicalMatchup([
    { redId: "A", blueId: "B", outcome: "elimination", winner: "R" },
    { redId: "B", blueId: "A", outcome: "draw", winner: "" },
    { redId: "A", blueId: "C", outcome: "elimination", winner: "R" }
  ], "A", "B");
  assert.equal(summary.games, 2);
  assert.deepEqual(summary.wins, { A: 1, B: 0, draws: 1 });
  assert.equal(summary.label, "Historical evolutionary games");
});

test("exhibitions use explicit colors and persist outside generation ledgers", async () => {
  const saved = [];
  const record = await runExhibition({
    runId: "run", generation: "ReachR30", redGenome: genomes[1], blueGenome: genomes[0],
    replayRepository: { save: async value => saved.push(structuredClone(value)) },
    createWorker: () => new FakeWorker(), replayId: "replay-1", now: () => "2026-08-29T00:00:00.000Z"
  });
  assert.equal(record.game.redId, "B");
  assert.equal(record.game.blueId, "A");
  assert.equal(record.game.kind, "exhibition");
  assert.equal(saved.length, 1);
  assert.equal(record.game.stage, undefined);
  assert.equal(record.game.scheduleIndex, undefined);
  assert.throws(() => validateLedgerRecord({
    schema: PERSISTENCE_SCHEMAS.ledger, runId: "run", generation: "ReachR30",
    ledgerId: "invalid-exhibition-ledger", rows: [record.game]
  }), /stage|schedule index/);
});

test("replaying a stored trace returns the same independent board sequence", async () => {
  const record = await runExhibition({
    runId: "run", generation: "ReachR30", redGenome: genomes[0], blueGenome: genomes[1],
    replayRepository: { save: async () => {} }, createWorker: () => new FakeWorker(), replayId: "replay-2"
  });
  const first = replayBoardSequence(record);
  const second = replayBoardSequence(record);
  assert.deepEqual(first, second);
  first[0].units.push({ id: "changed" });
  assert.deepEqual(replayBoardSequence(record), second);
});
