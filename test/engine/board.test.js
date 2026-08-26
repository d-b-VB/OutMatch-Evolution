import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, createState, initialState, legalActions, legalMoves, unitById } from "../../src/engine/board.js";

const adjacentState = () => createState({ units: [
  { id: 1, side: "R", typ: "P", pos: [0, 0], active: true },
  { id: 2, side: "B", typ: "A", pos: [1, 0], active: true }
] });

test("canonical initial state has the radius-three opening formation", () => {
  const state = initialState();
  assert.equal(state.units.length, 6);
  assert.deepEqual(unitById(state, 1).pos, [-2, 0]);
  assert.deepEqual(unitById(state, 6).pos, [2, 1]);
});

test("an unactivated pikeman can poke an adjacent enemy", () => {
  const actions = legalActions(adjacentState(), 1);
  assert.ok(actions.some(action => action.kind === "poke" && action.targetId === 2));
});

test("poke removes the victim, leaves the pikeman stationary, and consumes activation", () => {
  const state = adjacentState();
  applyAction(state, { kind: "poke", unitId: 1, targetId: 2 });
  assert.equal(unitById(state, 2), undefined);
  assert.deepEqual(unitById(state, 1).pos, [0, 0]);
  assert.equal(unitById(state, 1).active, false);
});

test("pikeman retains ordinary movement and advance-capture", () => {
  const state = adjacentState();
  const actions = legalActions(state, 1);
  assert.ok(actions.some(action => action.kind === "move" && action.destination[0] === 1 && action.destination[1] === 0));
  assert.ok(actions.some(action => action.kind === "move" && action.destination[0] === 0 && action.destination[1] === 1));
  applyAction(state, { kind: "move", unitId: 1, destination: [1, 0] });
  assert.equal(unitById(state, 2), undefined);
  assert.deepEqual(unitById(state, 1).pos, [1, 0]);
});

test("pikeman cannot poke a non-adjacent enemy", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "P", pos: [0, 0], active: true },
    { id: 2, side: "B", typ: "A", pos: [2, 0], active: true }
  ] });
  assert.equal(legalActions(state, 1).some(action => action.kind === "poke"), false);
  assert.throws(() => applyAction(state, { kind: "poke", unitId: 1, targetId: 2 }), /Illegal action/);
});

test("pikeman cannot act twice in one side turn", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "P", pos: [0, 0], active: true },
    { id: 2, side: "B", typ: "A", pos: [1, 0], active: true },
    { id: 3, side: "B", typ: "C", pos: [0, 1], active: true }
  ] });
  applyAction(state, { kind: "poke", unitId: 1, targetId: 2 });
  assert.deepEqual(legalActions(state, 1), []);
  assert.throws(() => applyAction(state, { kind: "poke", unitId: 1, targetId: 3 }), /Illegal action/);
});

test("poke credits attacker, victim, material, poke, and trace instrumentation", () => {
  const state = adjacentState();
  applyAction(state, { kind: "poke", unitId: 1, targetId: 2 });
  assert.equal(state.captured.R, 105);
  assert.deepEqual(state.metrics.R, {
    pokeActions: 1,
    pokeKills: 1,
    killsByAttacker: { P: 1, A: 0, C: 0 },
    victimsByType: { P: 0, A: 1, C: 0 }
  });
  assert.deepEqual(state.trace, [{
    kind: "poke",
    side: "R",
    round: 1,
    attacker: { id: 1, type: "P", position: [0, 0] },
    victim: { id: 2, type: "A", position: [1, 0] }
  }]);
});

test("archer movement remains limited to empty adjacent cells", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "A", pos: [0, 0], active: true },
    { id: 2, side: "B", typ: "P", pos: [1, 0], active: true }
  ] });
  assert.equal(legalMoves(state, unitById(state, 1)).some(position => position[0] === 1 && position[1] === 0), false);
});

test("cavalry may enter but cannot move through an enemy pike zone", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "C", pos: [-2, 0], active: true },
    { id: 2, side: "B", typ: "P", pos: [0, 0], active: true }
  ] });
  const moves = legalMoves(state, unitById(state, 1));
  assert.ok(moves.some(position => position[0] === -1 && position[1] === 0));
  assert.equal(moves.some(position => position[0] === 0 && position[1] === 0), false);
});
