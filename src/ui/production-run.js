import { R29_POPULATIONS } from "../baseline/checkpoint.js";
import { validateMutationRanges } from "../evolution/breeding.js";
import { buildNextGeneration } from "../evolution/generation.js";
import { planAutomaticMigration } from "../evolution/migration.js";
import { buildStage1Schedule } from "../evolution/schedule.js";
import { PERSISTENCE_SCHEMAS } from "../persistence/schema.js";
import { buildEliminationMatrix } from "../reports/elimination.js";
import { buildFitnessReport } from "../reports/fitness.js";
import { buildSimilarityReport } from "../reports/similarity.js";
import { buildIndividualUnitRates, buildPopulationUnitRates } from "../reports/unit-rates.js";
import { createTournamentHooks } from "./run-service.js";
import { buildCombatCache } from "../evolution/worker-pool.js";
import { validateInterventionDocument } from "./interventions.js";

function rankingsByPopulation(rankings) {
  if (rankings && !Array.isArray(rankings)) return structuredClone(rankings);
  const result = Object.fromEntries(R29_POPULATIONS.map(population => [population, []]));
  for (const record of rankings ?? []) {
    if (!Object.hasOwn(result, record.population)) throw new Error(`Ranking has unknown population: ${record.population}`);
    result[record.population].push(structuredClone(record));
  }
  return result;
}

function parentMetadata(parent) {
  const checkpoint = parent.checkpoint;
  return {
    generation: checkpoint.generation ?? parent.generation,
    breedingSeed: String(checkpoint.breedingSeed ?? checkpoint.seed),
    nextRecruitingPopulation: checkpoint.nextRecruitingPopulation,
    engineRulesVersion: checkpoint.engineRulesVersion ?? "reach-v1",
    fitnessFormulaVersion: checkpoint.fitnessFormulaVersion ?? "reach-fitness-v1",
    breedingPrngVersion: checkpoint.breedingPrngVersion ?? "splitmix64-v1"
  };
}

function flattenRankings(rankings) {
  return R29_POPULATIONS.flatMap(population => rankings[population].map(record => ({ ...record, population })));
}

/** Build the real child, schedules, reports, and immutable-record hooks used by BrowserRunService. */
export function prepareProductionGeneration({
  runId,
  parent,
  controlReview,
  breedingSeed,
  parentLedger,
  similarityBaseline,
  mutationRangeDocument,
  now = () => new Date().toISOString()
}) {
  if (!Array.isArray(parent?.checkpoint?.population) || !Array.isArray(parentLedger?.rows)) {
    throw new Error("Production generation requires a completed parent and ledger");
  }
  const controls = controlReview.controls;
  const interventions = validateInterventionDocument(controlReview.interventions);
  const rankings = rankingsByPopulation(parent.rankings);
  const parentGenomes = new Map(parent.checkpoint.population.map(genome => [genome.id, genome]));
  if (parentGenomes.size !== parent.checkpoint.population.length) throw new Error("Parent checkpoint contains duplicate genomes");
  const populationByGenome = new Map(parent.checkpoint.population.map(genome => [genome.id, genome.population]));
  const metadata = parentMetadata(parent);
  const migration = planAutomaticMigration({
    rows: parentLedger.rows, populationByGenome, rankings,
    destinationPopulation: metadata.nextRecruitingPopulation,
    enabled: controls.migrationEnabled, maximumMigrants: controls.maximumMigrants
  });
  const mutationRanges = validateMutationRanges(mutationRangeDocument, similarityBaseline.locusOrder);
  const childCandidate = buildNextGeneration({
    parentMetadata: metadata, rankings, parentGenomes, migrants: migration.selected,
    interventions: interventions.operations,
    locusOrder: similarityBaseline.locusOrder, mutationRanges,
    wildcardProbability: controls.wildcardProbability,
    mutationProbability: controls.mutationProbability
  });
  if (childCandidate.breedingSeed !== breedingSeed) {
    throw new Error("Prepared child breeding seed does not match reviewed run inputs");
  }
  const childGenomes = childCandidate.population;
  const childPopulationByGenome = new Map(childGenomes.map(genome => [genome.id, genome.population]));
  const tournamentHooks = createTournamentHooks(childGenomes);
  const stage1Schedule = buildStage1Schedule(childGenomes);
  const ledgerId = `${runId}:${childCandidate.generation}`;
  return {
    childCandidate,
    stage1Schedule,
    genomes: childGenomes,
    workerCount: controls.workerCount,
    cacheSeedEntries: buildCombatCache(parentGenomes, parentLedger.rows),
    tournamentHooks,
    finalizationHooks: {
      rankFinal: tournamentHooks.rankFinal,
      buildReports: ({ ledger }) => ({
        elimination: buildEliminationMatrix(ledger, childPopulationByGenome, R29_POPULATIONS),
        similarity: buildSimilarityReport({ ...childCandidate, populationOrder: R29_POPULATIONS }, similarityBaseline),
        fitness: [...buildFitnessReport(ledger, childPopulationByGenome).values()],
        unitRates: {
          individual: [...buildIndividualUnitRates(ledger, childPopulationByGenome).values()],
          population: buildPopulationUnitRates(ledger, childPopulationByGenome, R29_POPULATIONS)
        }
      }),
      buildLedgerRecord: ({ ledger }) => ({
        schema: PERSISTENCE_SCHEMAS.ledger, runId, generation: childCandidate.generation, ledgerId, rows: ledger
      }),
      buildGenerationRecord: ({ rankings: finalRankings, reports, ledgerRecord }) => ({
        schema: PERSISTENCE_SCHEMAS.generation, runId, generation: childCandidate.generation,
        parentGeneration: parent.generation, completedAt: now(), fingerprint: childCandidate.fingerprint,
        ledgerRef: ledgerRecord.ledgerId, checkpoint: childCandidate,
        rankings: flattenRankings(finalRankings), interventions: structuredClone(controlReview.interventions.operations),
        manifest: { controlsHash: controlReview.controlsHash, interventionsHash: controlReview.interventionsHash },
        controls: structuredClone(controls), migration: structuredClone(migration),
        breeding: { breedingSeed: childCandidate.breedingSeed, breedingPrngVersion: childCandidate.breedingPrngVersion },
        reports
      })
    }
  };
}
