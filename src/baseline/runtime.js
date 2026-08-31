import { indexR29Population, R29_POPULATIONS, validateR29Checkpoint } from "./checkpoint.js";
import { parseR29Ledger } from "./ledger.js";
import { generationFingerprint } from "../evolution/generation.js";
import { rankLedger } from "../evolution/ranking.js";
import { PERSISTENCE_SCHEMAS } from "../persistence/schema.js";
import { buildEliminationMatrix } from "../reports/elimination.js";
import { buildFitnessReport } from "../reports/fitness.js";
import { buildIndividualUnitRates, buildPopulationUnitRates } from "../reports/unit-rates.js";

const json = response => {
  if (!response.ok) throw new Error(`R29 runtime artifact could not be loaded (${response.status})`);
  return response.json();
};

/** Load and construct the bundled completed R29 using the normal durable schema. */
export async function loadCanonicalR29(runId, { fetcher = fetch, now = () => new Date().toISOString() } = {}) {
  const [checkpoint, ledgerResponse] = await Promise.all([
    fetcher(new URL("../../seed/r29/Reach_R29_Complete_Checkpoint.json", import.meta.url)).then(json),
    fetcher(new URL("../../.generated/r29/Reach_R29_Full_Staged_Ledger.csv", import.meta.url))
  ]);
  if (!ledgerResponse.ok) throw new Error(`R29 runtime ledger could not be loaded (${ledgerResponse.status})`);
  validateR29Checkpoint(checkpoint);
  const rows = parseR29Ledger(await ledgerResponse.text());
  const { populationByGenome } = indexR29Population(checkpoint);
  const ranked = rankLedger(rows, populationByGenome, R29_POPULATIONS);
  const rankings = R29_POPULATIONS.flatMap(population => ranked[population].map(item => ({ ...item, population })));
  const ledgerId = `${runId}:ReachR29`;
  const immutableCheckpoint = structuredClone(checkpoint);
  return {
    ledger: { schema: PERSISTENCE_SCHEMAS.ledger, runId, generation: "ReachR29", ledgerId, rows },
    generation: {
      schema: PERSISTENCE_SCHEMAS.generation, runId, generation: "ReachR29", parentGeneration: null,
      completedAt: now(), fingerprint: generationFingerprint(immutableCheckpoint), ledgerRef: ledgerId,
      checkpoint: immutableCheckpoint, rankings, interventions: [],
      manifest: { source: "bundled-r29", ledgerArtifact: checkpoint.ledgerArtifact }, controls: {},
      migration: structuredClone(checkpoint.migration ?? {}),
      breeding: { rules: structuredClone(checkpoint.breedingRules), summary: structuredClone(checkpoint.breedingSummary) },
      reports: {
        elimination: buildEliminationMatrix(rows, populationByGenome, R29_POPULATIONS),
        fitness: [...buildFitnessReport(rows, populationByGenome).values()],
        unitRates: { individual: [...buildIndividualUnitRates(rows, populationByGenome).values()],
          population: buildPopulationUnitRates(rows, populationByGenome, R29_POPULATIONS) }
      }
    }
  };
}
