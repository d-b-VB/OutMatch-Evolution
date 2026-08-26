import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAction,
  archerTargets,
  chooseDeployment,
  chooseRecruit,
  createState,
  deployPending,
  deploymentSpots,
  initialState,
  legalActions,
  legalMoves,
  recruitScores,
  unitById
} from "../../src/engine/board.js";

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

test("archer can shoot an adjacent enemy without moving", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "A", pos: [0, 0], active: true },
    { id: 2, side: "B", typ: "C", pos: [1, 0], active: true }
  ] });
  assert.deepEqual(archerTargets(state, unitById(state, 1)).map(unit => unit.id), [2]);
  assert.ok(legalActions(state, 1).some(action => action.kind === "shoot" && action.targetId === 2));
  applyAction(state, { kind: "shoot", unitId: 1, targetId: 2 });
  assert.equal(unitById(state, 2), undefined);
  assert.deepEqual(unitById(state, 1).pos, [0, 0]);
  assert.equal(state.metrics.R.killsByAttacker.A, 1);
});

test("archer can move and then shoot from its new position", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "A", pos: [-1, 0], active: true },
    { id: 2, side: "B", typ: "P", pos: [1, 0], active: true }
  ] });
  const action = { kind: "moveshoot", unitId: 1, destination: [0, 0], targetId: 2 };
  assert.ok(legalActions(state, 1).some(candidate =>
    candidate.kind === action.kind && candidate.targetId === action.targetId
      && candidate.destination[0] === 0 && candidate.destination[1] === 0
  ));
  applyAction(state, action);
  assert.deepEqual(unitById(state, 1).pos, [0, 0]);
  assert.equal(unitById(state, 2), undefined);
  assert.equal(unitById(state, 1).active, false);
});

test("archer can shoot first and move into the newly emptied cell", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "A", pos: [0, 0], active: true },
    { id: 2, side: "B", typ: "P", pos: [1, 0], active: true }
  ] });
  const action = { kind: "shootmove", unitId: 1, targetId: 2, destination: [1, 0] };
  assert.ok(legalActions(state, 1).some(candidate =>
    candidate.kind === action.kind && candidate.targetId === action.targetId
      && candidate.destination[0] === 1 && candidate.destination[1] === 0
  ));
  applyAction(state, action);
  assert.deepEqual(unitById(state, 1).pos, [1, 0]);
  assert.equal(unitById(state, 2), undefined);
});

test("archer cannot shoot a non-adjacent target", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "A", pos: [0, 0], active: true },
    { id: 2, side: "B", typ: "P", pos: [2, 0], active: true }
  ] });
  assert.equal(legalActions(state, 1).some(action => action.kind === "shoot"), false);
  assert.throws(() => applyAction(state, { kind: "shoot", unitId: 1, targetId: 2 }), /Illegal action/);
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

const evaluatorGenome = ({
  recruitBase = { P: 0, A: 0, C: 0 },
  recruitResponse = {},
  desiredRatio = {},
  deploy = { center: 0, enemyBase: 0, support: 0, exposure: 0 }
} = {}) => ({
  genes: {
    recruitBase,
    recruitResponse: Object.fromEntries(["P", "A", "C"].flatMap(type =>
      ["P", "A", "C"].map(enemy => [`${type}>${enemy}`, recruitResponse[`${type}>${enemy}`] ?? 0])
    )),
    desiredRatio: Object.fromEntries(["P", "A", "C"].flatMap(type =>
      ["P", "A", "C"].map(enemy => [`${type}>${enemy}`, desiredRatio[`${type}>${enemy}`] ?? 0])
    )),
    deploy
  }
});

test("recruit scoring preserves base, response, desired-ratio, and own-count terms", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "P", pos: [-1, 0], active: true },
    { id: 2, side: "B", typ: "A", pos: [1, 0], active: true }
  ] });
  const genome = evaluatorGenome({
    recruitBase: { P: 2, A: 1, C: 0 },
    recruitResponse: { "P>A": 3 },
    desiredRatio: { "P>A": 4 }
  });
  const scores = recruitScores(state, "R", genome);
  assert.ok(Math.abs(scores.P - 5.7) < 1e-12);
  assert.deepEqual({ A: scores.A, C: scores.C }, { A: 1, C: 0 });
  assert.equal(chooseRecruit(state, "R", genome), "P");
});

test("recruitment ties retain canonical P, A, C ordering", () => {
  assert.equal(chooseRecruit(initialState(), "R", evaluatorGenome()), "P");
});

test("deployment exposes only empty cells adjacent to the side base", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "P", pos: [-2, 0], active: true }
  ], pending: { R: "A", B: null } });
  assert.deepEqual(deploymentSpots(state, "R"), [[-2, -1], [-3, 1]]);
});

test("deployment choice uses genome scoring and deploys an inactive reinforcement", () => {
  const state = createState({ units: [
    { id: 7, side: "R", typ: "P", pos: [-2, 0], active: true }
  ], pending: { R: "C", B: null } });
  const genome = evaluatorGenome({
    deploy: { center: 1, enemyBase: 0, support: 10, exposure: 0 }
  });
  assert.deepEqual(chooseDeployment(state, "R", genome), [-2, -1]);
  const deployed = deployPending(state, "R", genome);
  assert.deepEqual(deployed, { id: 8, side: "R", typ: "C", pos: [-2, -1], active: false });
  assert.equal(state.pending.R, null);
  assert.equal(state.nextUnitId, 9);
});

test("deployment leaves a pending reinforcement intact when the base is blocked", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "P", pos: [-2, 0], active: true },
    { id: 2, side: "R", typ: "A", pos: [-2, -1], active: true },
    { id: 3, side: "R", typ: "C", pos: [-3, 1], active: true }
  ], pending: { R: "P", B: null } });
  assert.equal(deployPending(state, "R", evaluatorGenome()), null);
  assert.equal(state.pending.R, "P");
});
