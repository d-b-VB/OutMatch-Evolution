export const BOARD_RADIUS = 3;
export const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const MATERIAL_VALUE = { P: 100, A: 105, C: 110 };

const key = ([q, r]) => `${q},${r}`;
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const enemyOf = side => side === "R" ? "B" : "R";

export const BOARD_CELLS = [];
for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q += 1) {
  for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r += 1) {
    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= BOARD_RADIUS) {
      BOARD_CELLS.push([q, r]);
    }
  }
}

const cellSet = new Set(BOARD_CELLS.map(key));
const neighbours = new Map(BOARD_CELLS.map(cell => [
  key(cell),
  DIRECTIONS
    .map(([dq, dr]) => [cell[0] + dq, cell[1] + dr])
    .filter(candidate => cellSet.has(key(candidate)))
]));

function emptyUnitCounts() {
  return { P: 0, A: 0, C: 0 };
}

function emptySideMetrics() {
  return {
    pokeActions: 0,
    pokeKills: 0,
    killsByAttacker: emptyUnitCounts(),
    victimsByType: emptyUnitCounts()
  };
}

export function createState({ units, round = 1, turn = "R" }) {
  return {
    units: structuredClone(units),
    round,
    turn,
    captured: { R: 0, B: 0 },
    metrics: { R: emptySideMetrics(), B: emptySideMetrics() },
    trace: []
  };
}

export function initialState() {
  return createState({ units: [
    { id: 1, side: "R", typ: "P", pos: [-2, 0], active: true },
    { id: 2, side: "R", typ: "A", pos: [-3, 1], active: true },
    { id: 3, side: "R", typ: "C", pos: [-2, -1], active: true },
    { id: 4, side: "B", typ: "P", pos: [2, 0], active: true },
    { id: 5, side: "B", typ: "A", pos: [3, -1], active: true },
    { id: 6, side: "B", typ: "C", pos: [2, 1], active: true }
  ] });
}

export function unitById(state, id) {
  return state.units.find(unit => unit.id === id);
}

function occupancy(state) {
  return new Map(state.units.map(unit => [key(unit.pos), unit]));
}

function isInEnemyPikeZone(state, position, side, occupied = occupancy(state)) {
  return neighbours.get(key(position)).some(cell => {
    const unit = occupied.get(key(cell));
    return unit?.side === enemyOf(side) && unit.typ === "P";
  });
}

export function legalMoves(state, unit) {
  const occupied = occupancy(state);
  if (unit.typ === "C") {
    const moves = [];
    const seen = new Set([key(unit.pos)]);
    const queue = [[unit.pos, 0]];
    while (queue.length > 0) {
      const [position, distance] = queue.shift();
      if (distance >= 3) continue;
      for (const candidate of neighbours.get(key(position))) {
        const candidateKey = key(candidate);
        if (seen.has(candidateKey)) continue;
        seen.add(candidateKey);
        const occupant = occupied.get(candidateKey);
        const mustStop = isInEnemyPikeZone(state, candidate, unit.side, occupied);
        if (!occupant || occupant.side !== unit.side) moves.push(candidate);
        if ((!occupant || occupant.side === unit.side) && !mustStop) {
          queue.push([candidate, distance + 1]);
        }
      }
    }
    return moves;
  }
  if (unit.typ === "A") {
    return neighbours.get(key(unit.pos)).filter(cell => !occupied.has(key(cell)));
  }
  return neighbours.get(key(unit.pos)).filter(cell => {
    const occupant = occupied.get(key(cell));
    return !occupant || occupant.side !== unit.side;
  });
}

export function archerTargets(state, unit) {
  if (unit.typ !== "A") return [];
  const occupied = occupancy(state);
  return neighbours
    .get(key(unit.pos))
    .map(position => occupied.get(key(position)))
    .filter(target => target?.side === enemyOf(unit.side));
}

function cloneForActionGeneration(state) {
  return structuredClone(state);
}

function removeUnit(state, unitId) {
  state.units = state.units.filter(unit => unit.id !== unitId);
}

export function legalActions(state, unitId) {
  const unit = unitById(state, unitId);
  if (!unit?.active) return [];
  const actions = [{ kind: "hold", unitId }];
  if (unit.typ === "A") {
    for (const target of archerTargets(state, unit)) {
      actions.push({ kind: "shoot", unitId, targetId: target.id });
    }
    for (const destination of legalMoves(state, unit)) {
      actions.push({ kind: "move", unitId, destination });
      const movedState = cloneForActionGeneration(state);
      const movedArcher = unitById(movedState, unitId);
      movedArcher.pos = [...destination];
      for (const target of archerTargets(movedState, movedArcher)) {
        actions.push({ kind: "moveshoot", unitId, destination, targetId: target.id });
      }
    }
    for (const target of archerTargets(state, unit)) {
      const shotState = cloneForActionGeneration(state);
      removeUnit(shotState, target.id);
      const shotArcher = unitById(shotState, unitId);
      for (const destination of legalMoves(shotState, shotArcher)) {
        actions.push({ kind: "shootmove", unitId, targetId: target.id, destination });
      }
    }
  } else {
    for (const destination of legalMoves(state, unit)) {
      actions.push({ kind: "move", unitId, destination });
    }
  }
  if (unit.typ === "P") {
    const occupied = occupancy(state);
    for (const position of neighbours.get(key(unit.pos))) {
      const victim = occupied.get(key(position));
      if (victim?.side === enemyOf(unit.side)) {
        actions.push({ kind: "poke", unitId, targetId: victim.id });
      }
    }
  }
  return actions;
}

function actionIsLegal(state, action) {
  return legalActions(state, action.unitId).some(candidate =>
    candidate.kind === action.kind
    && candidate.targetId === action.targetId
    && (candidate.destination === undefined
      ? action.destination === undefined
      : action.destination !== undefined && same(candidate.destination, action.destination))
  );
}

function creditKill(state, attacker, victim) {
  state.captured[attacker.side] += MATERIAL_VALUE[victim.typ];
  state.metrics[attacker.side].killsByAttacker[attacker.typ] += 1;
  state.metrics[attacker.side].victimsByType[victim.typ] += 1;
  state.units = state.units.filter(unit => unit.id !== victim.id);
}

function shoot(state, attacker, targetId) {
  const victim = unitById(state, targetId);
  creditKill(state, attacker, victim);
  return victim;
}

function move(state, attacker, destination) {
  const victim = state.units.find(unit =>
    unit.side !== attacker.side && same(unit.pos, destination)
  );
  if (victim) creditKill(state, attacker, victim);
  attacker.pos = [...destination];
  return victim;
}

export function applyAction(state, action) {
  if (!actionIsLegal(state, action)) throw new Error("Illegal action");
  const attacker = unitById(state, action.unitId);
  if (action.kind === "move") {
    move(state, attacker, action.destination);
  } else if (action.kind === "shoot") {
    shoot(state, attacker, action.targetId);
  } else if (action.kind === "moveshoot") {
    move(state, attacker, action.destination);
    shoot(state, attacker, action.targetId);
  } else if (action.kind === "shootmove") {
    shoot(state, attacker, action.targetId);
    move(state, attacker, action.destination);
  } else if (action.kind === "poke") {
    const victim = unitById(state, action.targetId);
    const trace = {
      kind: "poke",
      side: attacker.side,
      round: state.round,
      attacker: { id: attacker.id, type: attacker.typ, position: [...attacker.pos] },
      victim: { id: victim.id, type: victim.typ, position: [...victim.pos] }
    };
    state.metrics[attacker.side].pokeActions += 1;
    state.metrics[attacker.side].pokeKills += 1;
    creditKill(state, attacker, victim);
    state.trace.push(trace);
  }
  attacker.active = false;
  return state;
}
