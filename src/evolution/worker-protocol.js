import { runGame } from "../engine/board.js";
import { createScheduledGame } from "./schedule.js";

export const WORKER_PROTOCOL_VERSION = "reach-game-worker-v1";
export const EXHIBITION_REQUEST_TYPE = "run_exhibition";
export const INITIALIZE_GENERATION_TYPE = "initialize_generation";
export const INITIALIZED_GAME_TYPE = "run_initialized_game";

function validateGenome(genome, expectedId, color) {
  if (genome === null || typeof genome !== "object" || genome.id !== expectedId || genome.genes === undefined) {
    throw new Error(`${color} worker genome does not match scheduled ID ${expectedId}`);
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Construct a structured-clone-safe single-game worker request. */
export function createGameRequest({ jobId, game, redGenome, blueGenome, engineOptions = { depth: 3 } }) {
  if (typeof jobId !== "string" || jobId.length === 0) throw new Error("Worker job ID must be a non-empty string");
  const scheduledGame = createScheduledGame(game);
  validateGenome(redGenome, scheduledGame.redId, "Red");
  validateGenome(blueGenome, scheduledGame.blueId, "Blue");
  if (!Number.isSafeInteger(engineOptions.depth) || engineOptions.depth < 1 || engineOptions.depth > 3) {
    throw new Error(`Invalid worker engine depth: ${engineOptions.depth}`);
  }
  return {
    protocol: WORKER_PROTOCOL_VERSION,
    type: "run_game",
    jobId,
    game: scheduledGame,
    redGenome,
    blueGenome,
    engineOptions: { depth: engineOptions.depth }
  };
}

export function validateGameRequest(message) {
  if (message?.protocol !== WORKER_PROTOCOL_VERSION || message.type !== "run_game") {
    throw new Error("Unsupported game-worker request");
  }
  return createGameRequest(message);
}

function validateEngineOptions(engineOptions) {
  if (!Number.isSafeInteger(engineOptions?.depth) || engineOptions.depth < 1 || engineOptions.depth > 3) {
    throw new Error(`Invalid worker engine depth: ${engineOptions?.depth}`);
  }
  return { depth: engineOptions.depth };
}

/** Send one immutable generation to a Worker before lightweight game jobs. */
export function createGenerationInitialization({ genomes, engineOptions = { depth: 3 } }) {
  const values = genomes instanceof Map ? [...genomes.values()] : genomes;
  if (!Array.isArray(values) || values.length === 0) throw new Error("Worker generation requires genomes");
  const ids = new Set();
  for (const genome of values) {
    validateGenome(genome, genome?.id, "Generation");
    if (ids.has(genome.id)) throw new Error(`Duplicate worker genome ID ${genome.id}`);
    ids.add(genome.id);
  }
  return { protocol: WORKER_PROTOCOL_VERSION, type: INITIALIZE_GENERATION_TYPE,
    genomes: values, engineOptions: validateEngineOptions(engineOptions) };
}

/** Construct a game job containing identities only; genomes stay inside the initialized Worker. */
export function createInitializedGameRequest({ jobId, game, captureActivity = false }) {
  if (typeof jobId !== "string" || !jobId) throw new Error("Worker job ID must be a non-empty string");
  if (typeof captureActivity !== "boolean") throw new Error("Worker activity capture flag must be boolean");
  return { protocol: WORKER_PROTOCOL_VERSION, type: INITIALIZED_GAME_TYPE, jobId,
    game: createScheduledGame(game), captureActivity };
}

export function validateInitializedGameRequest(message) {
  if (message?.protocol !== WORKER_PROTOCOL_VERSION || message.type !== INITIALIZED_GAME_TYPE) {
    throw new Error("Unsupported initialized game-worker request");
  }
  return createInitializedGameRequest(message);
}

function canonicalLedgerRow(game, ledger) {
  const side = (prefix, color) => ({
    [`${prefix}P`]: ledger.trained[color].P,
    [`${prefix}A`]: ledger.trained[color].A,
    [`${prefix}C`]: ledger.trained[color].C,
    [`${prefix}Pokes`]: ledger.pokes[color],
    [`${prefix}KillByP`]: ledger.killsByAttacker[color].P,
    [`${prefix}KillByA`]: ledger.killsByAttacker[color].A,
    [`${prefix}KillByC`]: ledger.killsByAttacker[color].C,
    [`${prefix}VictimP`]: ledger.victimsByType[color].P,
    [`${prefix}VictimA`]: ledger.victimsByType[color].A,
    [`${prefix}VictimC`]: ledger.victimsByType[color].C
  });
  return {
    stage: game.stage,
    scheduleIndex: game.scheduleIndex,
    redId: game.redId,
    outcome: ledger.outcome,
    blueId: game.blueId,
    winner: ledger.winner ?? "",
    round: ledger.round,
    redScore: ledger.redScore,
    blueScore: ledger.blueScore,
    ...side("red", "R"),
    ...side("blue", "B"),
    engineRulesVersion: ledger.engineRulesVersion
  };
}

/** Construct and validate a successful worker response. */
export function createGameResult(request, ledger) {
  const validated = validateGameRequest(request);
  if (ledger === null || typeof ledger !== "object") throw new Error("Worker game produced no ledger");
  return {
    protocol: WORKER_PROTOCOL_VERSION,
    type: "game_result",
    jobId: validated.jobId,
    scheduleIndex: validated.game.scheduleIndex,
    ledgerRow: canonicalLedgerRow(validated.game, ledger)
  };
}

export function validateGameResult(message, request) {
  const expected = request?.type === INITIALIZED_GAME_TYPE
    ? validateInitializedGameRequest(request) : validateGameRequest(request);
  if (message?.protocol !== WORKER_PROTOCOL_VERSION || message.type !== "game_result"
    || message.jobId !== expected.jobId || message.scheduleIndex !== expected.game.scheduleIndex
    || message.ledgerRow?.redId !== expected.game.redId || message.ledgerRow?.blueId !== expected.game.blueId) {
    throw new Error("Game-worker result does not match its request");
  }
  return message;
}

/** Resolve a lightweight job against a Worker's immutable initialized generation. */
export function handleInitializedGameRequest(message, context, runGameImpl = runGame) {
  if (message?.type === INITIALIZE_GENERATION_TYPE) {
    const initialization = createGenerationInitialization(message);
    context.genomes = new Map(initialization.genomes.map(genome => [genome.id, deepFreeze(genome)]));
    context.engineOptions = initialization.engineOptions;
    return { protocol: WORKER_PROTOCOL_VERSION, type: "generation_initialized", genomeCount: context.genomes.size };
  }
  const request = validateInitializedGameRequest(message);
  if (!(context.genomes instanceof Map)) throw new Error("Worker generation is not initialized");
  const redGenome = context.genomes.get(request.game.redId);
  const blueGenome = context.genomes.get(request.game.blueId);
  if (!redGenome || !blueGenome) throw new Error(`Unknown initialized genome in ${request.game.redId} vs ${request.game.blueId}`);
  const fullRequest = createGameRequest({ ...request, redGenome, blueGenome, engineOptions: context.engineOptions });
  const gameResult = runGameImpl(redGenome, blueGenome,
    { ...context.engineOptions, captureReplay: request.captureActivity });
  const { ledger } = gameResult;
  const result = createGameResult(fullRequest, ledger);
  const describe = action => {
    if (action.kind === "move") return `Unit ${action.unitId} moved to (${action.destination.join(", ")})`;
    if (action.kind === "hold") return `Unit ${action.unitId} held position`;
    if (action.kind === "poke") return `Pikeman ${action.unitId} poked unit ${action.targetId}`;
    if (action.kind === "shoot") return `Archer ${action.unitId} shot unit ${action.targetId}`;
    return `Unit ${action.unitId ?? "?"} performed ${action.kind}`;
  };
  return { ...result, jobId: request.jobId,
    ...(request.captureActivity ? { activity: gameResult.replay.actions.map(describe) } : {}) };
}

/** Build a replay-producing request which is never valid as an evolutionary ledger job. */
export function createExhibitionRequest({ jobId, redGenome, blueGenome, engineOptions = { depth: 3 } }) {
  if (typeof jobId !== "string" || !jobId) throw new Error("Exhibition job ID must be a non-empty string");
  if (typeof redGenome?.id !== "string" || !redGenome.id || typeof blueGenome?.id !== "string" || !blueGenome.id) {
    throw new Error("Exhibition genomes require IDs");
  }
  validateGenome(redGenome, redGenome?.id, "Red");
  validateGenome(blueGenome, blueGenome?.id, "Blue");
  if (redGenome.id === blueGenome.id) throw new Error("Exhibition generals must be different");
  if (!Number.isSafeInteger(engineOptions.depth) || engineOptions.depth < 1 || engineOptions.depth > 3) {
    throw new Error(`Invalid exhibition engine depth: ${engineOptions.depth}`);
  }
  return {
    protocol: WORKER_PROTOCOL_VERSION, type: EXHIBITION_REQUEST_TYPE, jobId,
    redGenome, blueGenome, engineOptions: { depth: engineOptions.depth }
  };
}

export function validateExhibitionResult(message, request) {
  const expected = createExhibitionRequest(request);
  if (message?.protocol !== WORKER_PROTOCOL_VERSION || message.type !== "exhibition_result"
    || message.jobId !== expected.jobId || message.game?.redId !== expected.redGenome.id
    || message.game?.blueId !== expected.blueGenome.id || !Array.isArray(message.game?.replay?.frames)
    || !Array.isArray(message.game?.replay?.actions)) throw new Error("Exhibition result does not match its request");
  return message;
}

/** Construct a structured worker failure without leaking non-cloneable Error state. */
export function createGameError(request, error) {
  const validated = validateGameRequest(request);
  return {
    protocol: WORKER_PROTOCOL_VERSION,
    type: "game_error",
    jobId: validated.jobId,
    scheduleIndex: validated.game.scheduleIndex,
    error: {
      name: typeof error?.name === "string" ? error.name : "Error",
      message: typeof error?.message === "string" ? error.message : String(error)
    }
  };
}

/** Execute one validated request; usable directly in tests and by the Worker entry point. */
export function handleGameRequest(message, runGameImpl = runGame) {
  if (message?.type === EXHIBITION_REQUEST_TYPE) {
    const request = createExhibitionRequest(message);
    const result = runGameImpl(request.redGenome, request.blueGenome, { ...request.engineOptions, captureReplay: true });
    return {
      protocol: WORKER_PROTOCOL_VERSION, type: "exhibition_result", jobId: request.jobId,
      game: {
        redId: request.redGenome.id, blueId: request.blueGenome.id,
        result: structuredClone(result.result), ledger: structuredClone(result.ledger), replay: structuredClone(result.replay)
      }
    };
  }
  const request = validateGameRequest(message);
  const { ledger } = runGameImpl(request.redGenome, request.blueGenome, request.engineOptions);
  return createGameResult(request, ledger);
}
