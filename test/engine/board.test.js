import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAction,
  actionIncrement,
  archerTargets,
  beginSideTurn,
  chooseDeployment,
  chooseAction,
  chooseRecruit,
  commitRecruitment,
  createState,
  deployPending,
  deploymentSpots,
  endSideTurn,
  featureScore,
  gameResult,
  immediateCaptures,
  initialState,
  legalActions,
  legalMoves,
  lookahead,
  orderedCandidateActions,
  playSideTurn,
  planTurn,
  recruitScores,
  runGame,
  stateHash,
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
    trained: { P: 0, A: 0, C: 0 },
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

test("beginning a side turn activates existing units before deploying an inactive reinforcement", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "P", pos: [-2, 0], active: false },
    { id: 2, side: "B", typ: "A", pos: [2, 0], active: false }
  ], pending: { R: "C", B: null } });
  const deployed = beginSideTurn(state, "R", evaluatorGenome());
  assert.equal(unitById(state, 1).active, true);
  assert.equal(unitById(state, 2).active, false);
  assert.equal(deployed.active, false);
  assert.equal(state.turn, "R");
});

test("odd-round recruitment commits the genome choice and prevents replacement", () => {
  const state = initialState();
  const genome = evaluatorGenome({ recruitBase: { P: 0, A: 4, C: 0 } });
  assert.equal(commitRecruitment(state, "R", genome), "A");
  assert.equal(state.pending.R, "A");
  assert.throws(() => commitRecruitment(state, "R", genome, "C"), /already pending/);
  state.pending.R = null;
  assert.throws(() => commitRecruitment(state, "R", genome, "X"), /Unknown unit type/);
  state.round = 2;
  assert.throws(() => commitRecruitment(state, "R", genome), /odd rounds/);
});

test("side-turn completion requires every existing unit to activate", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "P", pos: [-2, 0], active: true },
    { id: 2, side: "B", typ: "P", pos: [2, 0], active: false }
  ] });
  assert.throws(() => endSideTurn(state, "R"), /All units must activate/);
  applyAction(state, { kind: "hold", unitId: 1 });
  assert.deepEqual(endSideTurn(state, "R"), { round: 1, turn: "B" });
  assert.deepEqual(endSideTurn(state, "B"), { round: 2, turn: "R" });
});

test("natural elimination produces Reach raw scores", () => {
  const early = createState({
    units: [{ id: 1, side: "R", typ: "P", pos: [0, 0], active: false }],
    round: 1
  });
  assert.deepEqual(gameResult(early), {
    status: "complete",
    outcome: "elimination",
    winner: "R",
    round: 1,
    rawScore: { R: 1.5, B: -0.5 }
  });
  early.round = 20;
  assert.deepEqual(gameResult(early).rawScore, { R: 1, B: 0 });
});

test("round cap is a draw without natural elimination", () => {
  const state = createState({
    units: [
      { id: 1, side: "R", typ: "P", pos: [-1, 0], active: false },
      { id: 2, side: "B", typ: "P", pos: [1, 0], active: false }
    ],
    round: 21
  });
  assert.deepEqual(gameResult(state), {
    status: "complete",
    outcome: "draw",
    winner: null,
    round: 20,
    rawScore: { R: 0, B: 0 }
  });
});

test("immediate capture pressure preserves the canonical movement-based calculation", () => {
  const state = adjacentState();
  assert.equal(immediateCaptures(state, "R"), 1);
  assert.equal(immediateCaptures(state, "B"), 1);
});

test("candidate ordering treats poke as a tactical capture", () => {
  const state = adjacentState();
  const genome = { genes: { search: { breadth: 8, exploration: 0, ordering: 1 } } };
  const candidates = orderedCandidateActions(state, "R", genome);
  const pokeIndex = candidates.findIndex(action => action.kind === "poke");
  const holdIndex = candidates.findIndex(action => action.kind === "hold");
  assert.ok(pokeIndex >= 0);
  assert.ok(holdIndex === -1 || pokeIndex < holdIndex);
});

test("candidate breadth is clamped to eight", () => {
  const state = initialState();
  const genome = { genes: { search: { breadth: 100, exploration: 0, ordering: 1 } } };
  assert.equal(orderedCandidateActions(state, "R", genome).length, 8);
});

test("candidate exploration replaces tail slots with low-ranked actions", () => {
  const state = adjacentState();
  const baseline = { genes: { search: { breadth: 3, exploration: 0, ordering: 1 } } };
  const exploring = { genes: { search: { breadth: 3, exploration: 1 / 3, ordering: 1 } } };
  assert.equal(orderedCandidateActions(state, "R", baseline).some(action => action.kind === "hold"), false);
  assert.equal(orderedCandidateActions(state, "R", exploring).at(-1).kind, "hold");
});

test("state hashing is stable across unit array order and sensitive to activation", () => {
  const first = adjacentState();
  const second = structuredClone(first);
  second.units.reverse();
  assert.equal(stateHash(first), stateHash(second));
  second.units.find(unit => unit.id === 1).active = false;
  assert.notEqual(stateHash(first), stateHash(second));
});

function tacticalGenome(overrides = {}) {
  const cell = {};
  for (const relationship of ["friend", "enemy"]) {
    for (const radius of [1, 2]) {
      for (let count = 0; count <= 6; count += 1) cell[`${relationship}${radius}_${count}`] = 0;
    }
  }
  return { genes: {
    captureTarget: { P: 0, A: 0, C: 0 },
    attacker: { P: 0, A: 0, C: 0 },
    action: {
      progress: 0,
      support: 0,
      dispersion: 0,
      force: 0,
      exposure: 0,
      center: 0,
      mobility: 0,
      enemyBase: 0,
      hold: 0
    },
    cell,
    pos36: {},
    sequence: {
      secondAction: 0,
      sameUnitCombo: 0,
      coordinatedCombo: 0,
      doubleCapture: 0
    },
    search: { breadth: 8, exploration: 0, ordering: 1 },
    ...overrides
  } };
}

test("poke receives capture-target and pikeman-attacker evaluation", () => {
  const before = adjacentState();
  const after = structuredClone(before);
  const action = { kind: "poke", unitId: 1, targetId: 2 };
  applyAction(after, action);
  const genome = tacticalGenome({
    captureTarget: { P: 0, A: 11, C: 0 },
    attacker: { P: 7, A: 0, C: 0 }
  });
  assert.equal(featureScore(before, after, "R", genome, action), 18);
});

test("feature evaluation preserves movement progress, center, and hold genes", () => {
  const before = createState({ units: [
    { id: 1, side: "R", typ: "P", pos: [-2, 0], active: true },
    { id: 2, side: "B", typ: "P", pos: [2, 0], active: true }
  ] });
  const moved = structuredClone(before);
  const moveAction = { kind: "move", unitId: 1, destination: [-1, 0] };
  applyAction(moved, moveAction);
  const genome = tacticalGenome({
    action: {
      progress: 2,
      support: 0,
      dispersion: 0,
      force: 0,
      exposure: 0,
      center: 3,
      mobility: 0,
      enemyBase: 5,
      hold: 13
    }
  });
  assert.equal(featureScore(before, moved, "R", genome, moveAction), 10);

  const held = structuredClone(before);
  const holdAction = { kind: "hold", unitId: 1 };
  applyAction(held, holdAction);
  assert.equal(featureScore(before, held, "R", genome, holdAction), 13);
});

test("action increments apply same-unit and coordinated sequence genes", () => {
  const before = adjacentState();
  const after = structuredClone(before);
  const action = { kind: "poke", unitId: 1, targetId: 2 };
  applyAction(after, action);
  const genome = tacticalGenome({
    sequence: {
      secondAction: 2,
      sameUnitCombo: 3,
      coordinatedCombo: 5,
      doubleCapture: 7
    }
  });
  assert.equal(actionIncrement(before, after, "R", genome, action, [{ kind: "hold", unitId: 1 }]), 12);
  assert.equal(actionIncrement(before, after, "R", genome, action, [{ kind: "hold", unitId: 99 }]), 14);
});

test("depth-three lookahead selects a capture-valued Reach poke", () => {
  const state = adjacentState();
  const genome = tacticalGenome({
    captureTarget: { P: 0, A: 100, C: 0 },
    attacker: { P: 10, A: 0, C: 0 },
    action: {
      progress: -100,
      support: 0,
      dispersion: 0,
      force: 0,
      exposure: 0,
      center: 0,
      mobility: 0,
      enemyBase: 0,
      hold: 0
    }
  });
  const result = lookahead(state, "R", genome, 3);
  assert.equal(result.score, 110);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].kind, "poke");
  assert.equal(result.state.units.some(unit => unit.id === 2), false);
});

test("action selection is deterministic and does not mutate its input", () => {
  const state = adjacentState();
  const original = structuredClone(state);
  const genome = tacticalGenome({ captureTarget: { P: 0, A: 50, C: 0 } });
  assert.deepEqual(
    chooseAction(state, "R", genome, 3),
    chooseAction(state, "R", genome, 3)
  );
  assert.deepEqual(state, original);
});

test("turn planning replans until every friendly unit has activated", () => {
  const state = createState({ units: [
    { id: 1, side: "R", typ: "P", pos: [-2, 0], active: true },
    { id: 2, side: "R", typ: "A", pos: [-3, 1], active: true },
    { id: 3, side: "B", typ: "P", pos: [2, 0], active: true }
  ] });
  const result = planTurn(state, "R", tacticalGenome(), 3);
  assert.equal(result.actions.length, 2);
  assert.equal(result.state.units.some(unit => unit.side === "R" && unit.active), false);
  assert.equal(state.units.every(unit => unit.active), true);
});

test("action selection returns null when a side has no active units", () => {
  const state = adjacentState();
  unitById(state, 1).active = false;
  assert.equal(chooseAction(state, "R", tacticalGenome()), null);
});

function completeGenome(tacticalOverrides = {}) {
  const tactical = tacticalGenome(tacticalOverrides);
  const evaluator = evaluatorGenome();
  return { genes: { ...tactical.genes, ...evaluator.genes } };
}

test("side runner recruits, executes actions, and stops immediately on elimination", () => {
  const state = adjacentState();
  const genome = completeGenome({
    captureTarget: { P: 0, A: 100, C: 0 },
    attacker: { P: 10, A: 0, C: 0 }
  });
  const turn = playSideTurn(state, "R", genome, 1);
  assert.equal(turn.recruited, "A");
  assert.equal(turn.actions.length, 1);
  assert.equal(turn.result.status, "complete");
  assert.equal(turn.result.winner, "R");
  assert.deepEqual(state.metrics.R.trained, { P: 0, A: 1, C: 0 });
});

test("headless game runner is deterministic and emits a compact ledger", () => {
  const genome = completeGenome();
  const first = runGame(genome, genome, { depth: 1 });
  const second = runGame(genome, genome, { depth: 1 });
  assert.deepEqual(first.ledger, second.ledger);
  assert.ok(["elimination", "draw"].includes(first.ledger.outcome));
  assert.equal(first.ledger.engineRulesVersion, "reach-v1");
  assert.equal(first.state.trace.every(entry => entry.kind === "poke"), true);
});
