export const BOARD_RADIUS = 3;
export const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const MATERIAL_VALUE = { P: 100, A: 105, C: 110 };
export const ROUND_CAP = 20;
export const ENGINE_RULES_VERSION = "reach-v1";

const key = ([q, r]) => `${q},${r}`;
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const enemyOf = side => side === "R" ? "B" : "R";
const BASE = { R: [-3, 0], B: [3, 0] };
const UNIT_TYPES = ["P", "A", "C"];

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
    trained: emptyUnitCounts(),
    pokeActions: 0,
    pokeKills: 0,
    killsByAttacker: emptyUnitCounts(),
    victimsByType: emptyUnitCounts()
  };
}

export function createState({ units, round = 1, turn = "R", pending = { R: null, B: null } }) {
  return {
    units: structuredClone(units),
    round,
    turn,
    pending: { ...pending },
    nextUnitId: units.reduce((maximum, unit) => Math.max(maximum, unit.id), 0) + 1,
    captured: { R: 0, B: 0 },
    metrics: { R: emptySideMetrics(), B: emptySideMetrics() },
    trace: []
  };
}

export function hexDistance(a, b) {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs((-a[0] - a[1]) - (-b[0] - b[1]))
  );
}

export function recruitScores(state, side, genome) {
  const genes = genome.genes;
  const friendly = { P: 0, A: 0, C: 0 };
  const enemy = { P: 0, A: 0, C: 0 };
  for (const unit of state.units) {
    (unit.side === side ? friendly : enemy)[unit.typ] += 1;
  }
  return Object.fromEntries(UNIT_TYPES.map(type => {
    let score = genes.recruitBase[type];
    for (const enemyType of UNIT_TYPES) {
      score += genes.recruitResponse[`${type}>${enemyType}`] * enemy[enemyType];
      score += 0.7 * (
        genes.desiredRatio[`${type}>${enemyType}`] * enemy[enemyType] - friendly[type]
      );
    }
    return [type, score];
  }));
}

export function chooseRecruit(state, side, genome) {
  const scores = recruitScores(state, side, genome);
  return [...UNIT_TYPES].sort((a, b) => scores[b] - scores[a])[0];
}

export function deploymentSpots(state, side) {
  const occupied = occupancy(state);
  return neighbours.get(key(BASE[side])).filter(position => !occupied.has(key(position)));
}

export function chooseDeployment(state, side, genome) {
  if (!state.pending[side]) return null;
  const spots = deploymentSpots(state, side);
  if (spots.length === 0) return null;
  const genes = genome.genes.deploy;
  const friendly = state.units.filter(unit => unit.side === side);
  const enemy = state.units.filter(unit => unit.side !== side);
  const score = position => {
    const support = friendly.filter(unit => hexDistance(position, unit.pos) === 1).length;
    const exposure = enemy.filter(unit => hexDistance(position, unit.pos) === 1).length;
    return -hexDistance(position, [0, 0]) * genes.center
      - hexDistance(position, BASE[enemyOf(side)]) * genes.enemyBase
      + support * genes.support
      + exposure * genes.exposure;
  };
  return spots
    .map((position, index) => ({ position, index, score: score(position) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0].position;
}

export function deployPending(state, side, genome) {
  const position = chooseDeployment(state, side, genome);
  if (!position) return null;
  const deployed = {
    id: state.nextUnitId,
    side,
    typ: state.pending[side],
    pos: [...position],
    active: false
  };
  state.nextUnitId += 1;
  state.units.push(deployed);
  state.pending[side] = null;
  return deployed;
}

export function beginSideTurn(state, side, genome) {
  state.turn = side;
  for (const unit of state.units) {
    if (unit.side === side) unit.active = true;
  }
  return deployPending(state, side, genome);
}

export function commitRecruitment(state, side, genome, type = chooseRecruit(state, side, genome)) {
  if (state.round % 2 !== 1) throw new Error("Recruitment is only available on odd rounds");
  if (state.pending[side] !== null) throw new Error("A reinforcement is already pending");
  if (!UNIT_TYPES.includes(type)) throw new Error(`Unknown unit type: ${type}`);
  state.pending[side] = type;
  state.metrics[side].trained[type] += 1;
  return type;
}

export function endSideTurn(state, side) {
  if (state.turn !== side) throw new Error(`It is not ${side}'s turn`);
  if (state.units.some(unit => unit.side === side && unit.active)) {
    throw new Error("All units must activate before ending the side turn");
  }
  if (side === "R") {
    state.turn = "B";
  } else {
    state.round += 1;
    state.turn = "R";
  }
  return { round: state.round, turn: state.turn };
}

export function gameResult(state) {
  const redAlive = state.units.some(unit => unit.side === "R");
  const blueAlive = state.units.some(unit => unit.side === "B");
  if (redAlive !== blueAlive) {
    const winner = redAlive ? "R" : "B";
    const factor = 0.5 * (ROUND_CAP - state.round) / (ROUND_CAP - 1);
    return {
      status: "complete",
      outcome: "elimination",
      winner,
      round: state.round,
      rawScore: {
        [winner]: 1 + factor,
        [enemyOf(winner)]: factor === 0 ? 0 : -factor
      }
    };
  }
  if (state.round > ROUND_CAP) {
    return {
      status: "complete",
      outcome: "draw",
      winner: null,
      round: ROUND_CAP,
      rawScore: { R: 0, B: 0 }
    };
  }
  return { status: "ongoing" };
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
  if (unit.typ === "P") {
    const occupied = occupancy(state);
    for (const position of neighbours.get(key(unit.pos))) {
      const victim = occupied.get(key(position));
      if (victim?.side === enemyOf(unit.side)) {
        actions.push({ kind: "poke", unitId, targetId: victim.id });
      }
    }
    for (const destination of legalMoves(state, unit)) {
      actions.push({ kind: "move", unitId, destination });
    }
  } else if (unit.typ === "A") {
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
  return actions;
}

export function immediateCaptures(state, side) {
  const occupied = occupancy(state);
  let captures = 0;
  for (const unit of state.units.filter(candidate => candidate.side === side)) {
    if (unit.typ === "A") {
      captures += archerTargets(state, unit).length;
      continue;
    }
    captures += legalMoves(state, unit).filter(position => {
      const target = occupied.get(key(position));
      return target?.side === enemyOf(side);
    }).length;
  }
  return captures;
}

export function stateHash(state) {
  return [...state.units]
    .sort((a, b) => a.id - b.id)
    .map(unit => `${unit.side}${unit.typ}${unit.pos[0]},${unit.pos[1]},${unit.active ? 1 : 0}`)
    .join("|");
}

function isCaptureAction(state, side, action, occupied) {
  if (["shoot", "moveshoot", "shootmove", "poke"].includes(action.kind)) return true;
  if (action.kind !== "move") return false;
  return occupied.get(key(action.destination))?.side === enemyOf(side);
}

export function orderedCandidateActions(state, side, genome) {
  const rawBreadth = Math.max(1, Math.round(genome.genes.search.breadth));
  const breadth = Math.min(8, rawBreadth);
  const exploration = genome.genes.search.exploration;
  const ordering = genome.genes.search.ordering;
  const occupied = occupancy(state);
  const pool = [];
  for (const unit of state.units.filter(candidate => candidate.side === side && candidate.active)) {
    for (const action of legalActions(state, unit.id)) {
      let quickScore = isCaptureAction(state, side, action, occupied) ? 100 : 0;
      if (action.kind === "hold") quickScore -= 5;
      pool.push({ action, score: quickScore * ordering });
    }
  }
  pool.sort((a, b) => b.score - a.score);
  if (pool.length === 0) return [];
  const count = Math.max(1, Math.min(pool.length, breadth));
  const explorationCount = Math.min(count - 1, Math.round(count * exploration));
  return pool
    .slice(0, count - explorationCount)
    .concat(explorationCount > 0 ? pool.slice(-explorationCount) : [])
    .map(entry => entry.action);
}

export function featureScore(before, after, side, genome, action) {
  const genes = genome.genes;
  const friendlyBefore = before.units.filter(unit => unit.side === side);
  const friendlyAfter = after.units.filter(unit => unit.side === side);
  const enemyBefore = before.units.filter(unit => unit.side !== side);
  const enemyAfter = after.units.filter(unit => unit.side !== side);
  const actorBefore = friendlyBefore.find(unit => unit.id === action.unitId);
  const actor = friendlyAfter.find(unit => unit.id === action.unitId) ?? actorBefore;
  let score = 0;

  const killed = enemyBefore.filter(unit =>
    !enemyAfter.some(survivor => survivor.id === unit.id)
  );
  for (const victim of killed) {
    score += genes.captureTarget[victim.typ];
    if (actorBefore) score += genes.attacker[actorBefore.typ];
  }

  if (actorBefore && actor) {
    const progress = hexDistance(actorBefore.pos, BASE[enemyOf(side)])
      - hexDistance(actor.pos, BASE[enemyOf(side)]);
    score += progress * genes.action.progress;
    score += (
      hexDistance(actorBefore.pos, [0, 0]) - hexDistance(actor.pos, [0, 0])
    ) * genes.action.center;
    score += progress * genes.action.enemyBase;
    const actorSurvived = after.units.some(unit => unit.id === actor.id);
    score += (actorSurvived ? legalMoves(after, actor).length : 0) * genes.action.mobility * 0.15;

    const friends = friendlyAfter.filter(unit => unit.id !== actor.id);
    const adjacentFriends = friends.filter(unit => hexDistance(actor.pos, unit.pos) === 1).length;
    score += adjacentFriends * genes.action.support;
    score += -adjacentFriends * genes.action.dispersion;

    for (const [relationship, units] of [["friend", friends], ["enemy", enemyAfter]]) {
      for (const radius of [1, 2]) {
        const count = Math.min(
          6,
          units.filter(unit => hexDistance(actor.pos, unit.pos) <= radius).length
        );
        score += genes.cell[`${relationship}${radius}_${count}`];
      }
    }

    for (const friend of friends) {
      const distance = hexDistance(actor.pos, friend.pos);
      if (distance >= 1 && distance <= 3) {
        score += genes.pos36?.[`${actor.typ}|friend|${friend.typ}|${distance}`] ?? 0;
      }
    }
    for (const enemy of enemyAfter) {
      const distance = hexDistance(actor.pos, enemy.pos);
      if (distance >= 1 && distance <= 3) {
        score += genes.pos36?.[`${actor.typ}|enemy|${enemy.typ}|${distance}`] ?? 0;
      }
    }
  }

  score += immediateCaptures(after, side) * genes.action.force;
  score += immediateCaptures(after, enemyOf(side)) * genes.action.exposure;
  if (action.kind === "hold") score += genes.action.hold;
  return score;
}

export function actionIncrement(before, after, side, genome, action, priorActions = []) {
  let score = featureScore(before, after, side, genome, action);
  if (priorActions.length > 0) {
    const sequence = genome.genes.sequence;
    score += sequence.secondAction;
    const previous = priorActions.at(-1);
    score += previous.unitId === action.unitId
      ? sequence.sameUnitCombo
      : sequence.coordinatedCombo;
    if (after.units.length <= before.units.length - 1) {
      score += sequence.doubleCapture;
    }
  }
  return score;
}

export function lookahead(state, side, genome, depth = 3, history = []) {
  let beam = [{ score: 0, state: structuredClone(state), actions: [] }];
  const transpositions = new Set();
  const searchDepth = Math.max(1, depth);

  for (let ply = 0; ply < searchDepth; ply += 1) {
    const candidates = [];
    let expanded = false;
    for (const node of beam) {
      const hasActiveUnit = node.state.units.some(unit => unit.side === side && unit.active);
      if (!hasActiveUnit) {
        candidates.push(node);
        continue;
      }
      const actions = orderedCandidateActions(node.state, side, genome);
      if (actions.length === 0) {
        candidates.push(node);
        continue;
      }
      for (const action of actions) {
        const before = structuredClone(node.state);
        const nextState = structuredClone(node.state);
        applyAction(nextState, action);
        const hash = stateHash(nextState);
        if (transpositions.has(hash)) continue;
        transpositions.add(hash);
        expanded = true;
        candidates.push({
          score: node.score + actionIncrement(
            before,
            nextState,
            side,
            genome,
            action,
            history.concat(node.actions)
          ),
          state: nextState,
          actions: node.actions.concat(action)
        });
      }
    }
    if (!expanded) break;
    candidates.sort((a, b) => b.score - a.score);
    beam = candidates.slice(0, Math.max(1, Math.min(4, candidates.length)));
  }

  beam.sort((a, b) => b.score - a.score);
  return beam[0] ?? { score: 0, state: structuredClone(state), actions: [] };
}

export function chooseAction(state, side, genome, depth = 3, history = []) {
  const active = state.units.filter(unit => unit.side === side && unit.active);
  if (active.length === 0) return null;
  const result = lookahead(state, side, genome, depth, history);
  return result.actions[0] ?? { kind: "hold", unitId: active[0].id };
}

export function planTurn(state, side, genome, depth = 3) {
  const plannedState = structuredClone(state);
  const actions = [];
  let score = 0;
  while (plannedState.units.some(unit => unit.side === side && unit.active)) {
    const action = chooseAction(plannedState, side, genome, depth, actions);
    const before = structuredClone(plannedState);
    applyAction(plannedState, action);
    score += actionIncrement(before, plannedState, side, genome, action, actions);
    actions.push(action);
  }
  return { score, state: plannedState, actions };
}

export function playSideTurn(state, side, genome, depth = 3) {
  const deployed = beginSideTurn(state, side, genome);
  const recruited = state.round % 2 === 1 && state.pending[side] === null
    ? commitRecruitment(state, side, genome)
    : null;
  const actions = [];
  while (state.units.some(unit => unit.side === side && unit.active)) {
    const action = chooseAction(state, side, genome, depth, actions);
    applyAction(state, action);
    actions.push(action);
    const result = gameResult(state);
    if (result.status === "complete") {
      return { deployed, recruited, actions, result };
    }
  }
  endSideTurn(state, side);
  return { deployed, recruited, actions, result: gameResult(state) };
}

function ledgerFromState(state, result) {
  return {
    outcome: result.outcome,
    winner: result.winner,
    round: result.round,
    redScore: result.rawScore.R,
    blueScore: result.rawScore.B,
    trained: structuredClone({ R: state.metrics.R.trained, B: state.metrics.B.trained }),
    pokes: { R: state.metrics.R.pokeActions, B: state.metrics.B.pokeActions },
    pokeKills: { R: state.metrics.R.pokeKills, B: state.metrics.B.pokeKills },
    killsByAttacker: structuredClone({
      R: state.metrics.R.killsByAttacker,
      B: state.metrics.B.killsByAttacker
    }),
    victimsByType: structuredClone({
      R: state.metrics.R.victimsByType,
      B: state.metrics.B.victimsByType
    }),
    engineRulesVersion: ENGINE_RULES_VERSION
  };
}

export function runGame(redGenome, blueGenome, { depth = 3 } = {}) {
  const state = initialState();
  const genomes = { R: redGenome, B: blueGenome };
  while (true) {
    for (const side of ["R", "B"]) {
      const turn = playSideTurn(state, side, genomes[side], depth);
      if (turn.result.status === "complete") {
        return {
          result: turn.result,
          ledger: ledgerFromState(state, turn.result),
          state
        };
      }
    }
  }
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
