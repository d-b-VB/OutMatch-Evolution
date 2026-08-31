import { ReusableWorkerPoolSession, runWorkerSchedule } from "../evolution/worker-pool.js";
import { buildChallengerSchedule, identifyChallengers } from "../evolution/challengers.js";
import { rankLedger, selectTentativeElites } from "../evolution/ranking.js";
import { buildPopulationRosters, buildStage2Schedule } from "../evolution/schedule.js";
import { finalizeDurableTournament, runDurableTournamentStages } from "../persistence/durable-tournament.js";
import { buildProgressCheckpoint } from "../persistence/resume.js";

const PRNG_VERSION = "splitmix64-v1";
export const DEFAULT_CHECKPOINT_BATCH_SIZE = 256;

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required`);
  return value;
}

function nextGeneration(parentGeneration) {
  const match = /^ReachR(\d+)$/.exec(parentGeneration);
  if (!match) throw new Error("Parent generation must use ReachR<number>");
  return `ReachR${Number(match[1]) + 1}`;
}

function validateReviewedInputs(parent, controlReview) {
  if (!controlReview?.controls || !controlReview.controlsHash || !controlReview.interventionsHash) {
    throw new Error("Controls and interventions must be reviewed before starting");
  }
  if (controlReview.interventions?.parentGeneration !== parent?.generation) {
    throw new Error("Interventions are not bound to the selected parent generation");
  }
}

/** Construct the first durable record only from reviewed deterministic inputs. */
export function buildInitialRunProgress({
  runId,
  parent,
  controlReview,
  breedingSeed,
  breedingPrngVersion = PRNG_VERSION,
  childCandidate,
  stage1Schedule,
  now = () => new Date().toISOString()
}) {
  validateReviewedInputs(parent, controlReview);
  if (!Array.isArray(stage1Schedule) || childCandidate === null || typeof childCandidate !== "object") {
    throw new Error("Prepared generation must include a child candidate and Stage 1 schedule");
  }
  return buildProgressCheckpoint({
    runId: requiredString(runId, "Run ID"),
    parentGeneration: requiredString(parent?.generation, "Parent generation"),
    parentFingerprint: requiredString(parent?.fingerprint, "Parent fingerprint"),
    targetGeneration: nextGeneration(parent.generation),
    controlsHash: controlReview.controlsHash,
    interventionsHash: controlReview.interventionsHash,
    breedingSeed: requiredString(breedingSeed, "Breeding seed"),
    breedingPrngVersion: requiredString(breedingPrngVersion, "Breeding PRNG version"),
    phase: "stage1_running",
    schedule: stage1Schedule,
    childCandidate,
    updatedAt: now()
  });
}

function checkpointIdentity(checkpoint) {
  return Object.fromEntries([
    "runId", "parentGeneration", "parentFingerprint", "targetGeneration", "controlsHash",
    "interventionsHash", "breedingSeed", "breedingPrngVersion"
  ].map(key => [key, checkpoint[key]]));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Bind the canonical ranking, Stage 2, and challenger planners for a prepared population. */
export function createTournamentHooks(genomes, { populationOrder, eliteCount = 14 } = {}) {
  if (!Array.isArray(genomes)) throw new Error("Tournament hooks require a genome array");
  const populationByGenome = new Map(genomes.map(genome => [genome.id, genome.population]));
  if (populationByGenome.size !== genomes.length) throw new Error("Tournament hooks received duplicate genome IDs");
  const rosters = buildPopulationRosters(genomes, populationOrder);
  const rank = rows => rankLedger(rows, populationByGenome, populationOrder);
  return {
    rankStage1(rows) { return selectTentativeElites(rank(rows), eliteCount); },
    buildStage2Schedule(tentativeElites) {
      return buildStage2Schedule(tentativeElites, rosters);
    },
    rankStage2: rank,
    planChallengerIteration(rows, iteration) {
      const rankings = rank(rows);
      const challengers = identifyChallengers(rankings, rows, populationByGenome, rosters, eliteCount);
      return {
        rankings,
        challengers,
        schedule: buildChallengerSchedule(challengers, rows, populationByGenome, rosters, { iteration })
      };
    },
    rankFinal: rank
  };
}

/**
 * UI-facing owner of one durable generation operation. Domain construction is
 * injected so DOM code cannot accidentally reproduce tournament transitions.
 */
export class BrowserRunService {
  constructor({
    database,
    progressRepository,
    prepareGeneration,
    restoreGeneration,
    createWorker,
    workerSchedule = runWorkerSchedule,
    runStages = runDurableTournamentStages,
    finalize = finalizeDurableTournament,
    onCheckpoint = () => {},
    onLiveProgress = () => {},
    checkpointBatchSize = DEFAULT_CHECKPOINT_BATCH_SIZE,
    workerSessionFactory = options => new ReusableWorkerPoolSession(options),
    now = () => new Date().toISOString()
  }) {
    if (!database || typeof progressRepository?.get !== "function" || typeof progressRepository?.save !== "function") {
      throw new Error("Run service requires available durable storage");
    }
    if (typeof prepareGeneration !== "function") throw new Error("Run service requires a generation preparer");
    this.database = database;
    this.progressRepository = progressRepository;
    this.prepareGeneration = prepareGeneration;
    this.restoreGeneration = restoreGeneration;
    this.createWorker = createWorker;
    this.workerSchedule = workerSchedule;
    this.runStages = runStages;
    this.finalize = finalize;
    this.onCheckpoint = onCheckpoint;
    this.onLiveProgress = onLiveProgress;
    if (!Number.isSafeInteger(checkpointBatchSize) || checkpointBatchSize < 1) {
      throw new Error("Checkpoint batch size must be a positive integer");
    }
    this.checkpointBatchSize = checkpointBatchSize;
    this.workerSessionFactory = workerSessionFactory;
    this.now = now;
    this.pauseRequested = false;
    this.stopRequested = false;
    this.active = false;
    this.contexts = new Map();
  }

  requestPause() { this.pauseRequested = true; }

  stopAfterGeneration() { this.stopRequested = true; }

  async start({ runId, parent, controlReview, breedingSeed, breedingPrngVersion = PRNG_VERSION }) {
    if (this.active) throw new Error("A generation operation is already active");
    if (await this.progressRepository.get(runId)) throw new Error("Run already has durable progress; resume it instead");
    validateReviewedInputs(parent, controlReview);
    this.stopRequested = false;
    const prepared = await this.prepareGeneration({
      runId, parent: structuredClone(parent), controlReview: structuredClone(controlReview),
      breedingSeed, breedingPrngVersion
    });
    const checkpoint = buildInitialRunProgress({
      runId, parent, controlReview, breedingSeed, breedingPrngVersion,
      childCandidate: prepared.childCandidate, stage1Schedule: prepared.stage1Schedule, now: this.now
    });
    await this.progressRepository.save(checkpoint);
    this.onCheckpoint(checkpoint);
    this.contexts.set(runId, prepared);
    return this.#drive(checkpoint, prepared);
  }

  async resume({ runId, prepared }) {
    if (this.active) throw new Error("A generation operation is already active");
    const checkpoint = await this.progressRepository.get(runId);
    if (!checkpoint) throw new Error("Run has no durable progress to resume");
    const context = prepared ?? this.contexts.get(runId)
      ?? (typeof this.restoreGeneration === "function" ? await this.restoreGeneration(structuredClone(checkpoint)) : null);
    if (!context) throw new Error("Resume requires a deterministic generation restorer after reload");
    const restoredCandidate = context.childCandidate;
    if (restoredCandidate && canonical(restoredCandidate) !== canonical(checkpoint.childCandidate)) {
      throw new Error("Restored generation candidate does not match durable progress");
    }
    this.contexts.set(runId, context);
    this.pauseRequested = false;
    return this.#drive(checkpoint, context);
  }

  async #drive(checkpoint, prepared) {
    this.active = true;
    const started = Date.now();
    const diagnostics = { totalGames: 0, workerCount: prepared.workerCount ?? 1,
      batchSize: this.checkpointBatchSize, checkpoints: 0, combatMilliseconds: 0,
      checkpointMilliseconds: 0, phaseTransitionMilliseconds: 0, finalizationMilliseconds: 0 };
    let session;
    try {
      const genomes = prepared.genomes instanceof Map
        ? prepared.genomes : new Map(prepared.genomes?.map(genome => [genome.id, genome]));
      if (!(genomes instanceof Map)) throw new Error("Prepared generation must index tournament genomes");
      const executeGame = async game => (await this.workerSchedule({
        schedule: [game], genomes, workerCount: prepared.workerCount ?? 1,
        createWorker: this.createWorker, engineOptions: prepared.engineOptions
      }))[0];
      const batchSize = this.checkpointBatchSize;
      let previousCheckpoint = checkpoint;
      let liveCompleted = checkpoint.cursor;
      let liveTotal = checkpoint.schedule.length;
      const underway = new Map();
      let firstFightActivity = [];
      const publishActivity = event => this.onLiveProgress({ ...event, completed: liveCompleted,
        total: liveTotal, underway: [...underway.values()].map(game => ({ redId: game.redId,
          blueId: game.blueId, scheduleIndex: game.scheduleIndex })), firstFightActivity,
        observedAt: this.now() });
      session = this.workerSchedule === runWorkerSchedule ? this.workerSessionFactory({
        genomes, workerCount: prepared.workerCount ?? 1, createWorker: this.createWorker,
        engineOptions: prepared.engineOptions,
        onProgress: event => {
          liveCompleted += 1;
          publishActivity(event);
        },
        onActivity: event => {
          const key = `${event.stage}:${event.scheduleIndex}`;
          if (event.status === "started") underway.set(key, event);
          else underway.delete(key);
          if (event.activity?.length) firstFightActivity = event.activity;
          publishActivity(event);
        }
      }) : undefined;
      const executeBatch = session ? async schedule => {
        diagnostics.totalGames += schedule.length;
        const combatStarted = Date.now();
        try { return await session.run(schedule); }
        finally { diagnostics.combatMilliseconds += Date.now() - combatStarted; }
      } : undefined;
      const stagesStarted = Date.now();
      const result = await this.runStages({
        checkpoint,
        expected: checkpointIdentity(checkpoint),
        executeGame,
        executeBatch,
        checkpointInterval: executeBatch ? batchSize : 1,
        saveCheckpoint: async value => {
          const checkpointStarted = Date.now();
          const incremental = value.phase === previousCheckpoint.phase
            && value.schedule.length === previousCheckpoint.schedule.length
            && value.cursor >= previousCheckpoint.cursor
            && typeof this.progressRepository.saveIncremental === "function";
          if (incremental) await this.progressRepository.saveIncremental(value, previousCheckpoint);
          else await this.progressRepository.save(value);
          previousCheckpoint = value;
          diagnostics.checkpoints += 1;
          diagnostics.checkpointMilliseconds += Date.now() - checkpointStarted;
          liveCompleted = value.cursor;
          liveTotal = value.schedule.length;
          this.onCheckpoint(value);
        },
        shouldPause: () => this.pauseRequested,
        now: this.now,
        ...prepared.tournamentHooks
      });
      diagnostics.phaseTransitionMilliseconds = Math.max(0, Date.now() - stagesStarted
        - diagnostics.combatMilliseconds - diagnostics.checkpointMilliseconds);
      if (result.status === "paused") return result;
      const finalizationStarted = Date.now();
      const completed = await this.finalize({
        database: this.database,
        checkpoint: result.checkpoint,
        expected: checkpointIdentity(result.checkpoint),
        ...prepared.finalizationHooks
      });
      diagnostics.finalizationMilliseconds = Date.now() - finalizationStarted;
      return { ...completed, stopRequested: this.stopRequested };
    } finally {
      session?.close();
      if (session) Object.assign(diagnostics, session.stats);
      diagnostics.totalMilliseconds = Date.now() - started;
      globalThis.console?.info?.("OutMatch generation performance", diagnostics);
      this.active = false;
    }
  }
}

export { PRNG_VERSION as DEFAULT_BREEDING_PRNG_VERSION };
