import { runGame } from "../engine/board.js";
import { createScheduledGame } from "./schedule.js";

export const WORKER_PROTOCOL_VERSION = "reach-game-worker-v1";

function validateGenome(genome, expectedId, color) {
  if (genome === null || typeof genome !== "object" || genome.id !== expectedId || genome.genes === undefined) {
    throw new Error(`${color} worker genome does not match scheduled ID ${expectedId}`);
  }
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
  const expected = validateGameRequest(request);
  if (message?.protocol !== WORKER_PROTOCOL_VERSION || message.type !== "game_result"
    || message.jobId !== expected.jobId || message.scheduleIndex !== expected.game.scheduleIndex
    || message.ledgerRow?.redId !== expected.game.redId || message.ledgerRow?.blueId !== expected.game.blueId) {
    throw new Error("Game-worker result does not match its request");
  }
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
  const request = validateGameRequest(message);
  const { ledger } = runGameImpl(request.redGenome, request.blueGenome, request.engineOptions);
  return createGameResult(request, ledger);
}
