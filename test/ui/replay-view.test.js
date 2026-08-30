import assert from "node:assert/strict";
import test from "node:test";
import { buildReplayFrameView } from "../../src/ui/replay-view.js";

const frames = [
  { round: 1, turn: "R", units: [{ id: "R1", side: "R", typ: "P", pos: [-3, 0], active: true }] },
  { round: 1, turn: "R", units: [{ id: "R1", side: "R", typ: "P", pos: [-2, 0], active: false }] }
];
const actions = [{ kind: "move", unitId: "R1", destination: [-2, 0] }];

test("replay frame view maps the fixed board and current action without mutating storage", () => {
  const view = buildReplayFrameView(frames, actions, 1);
  assert.equal(view.cells.length, 37);
  assert.equal(view.cells.filter(cell => cell.base).length, 2);
  assert.deepEqual(view.action, actions[0]);
  assert.deepEqual(view.units[0], { id: "R1", side: "R", type: "P", active: false, x: 28, y: 50 });
  view.action.kind = "changed";
  assert.equal(actions[0].kind, "move");
});

test("replay frame view clamps navigation and rejects incomplete traces", () => {
  assert.equal(buildReplayFrameView(frames, actions, 99).index, 1);
  assert.equal(buildReplayFrameView(frames, actions, -1).index, 0);
  assert.throws(() => buildReplayFrameView(frames, [], 0), /inconsistent/);
});
