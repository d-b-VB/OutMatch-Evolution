import { flattenGenomeLoci } from "../baseline/checkpoint.js";
import { breedChild, validateMutationRanges } from "../evolution/breeding.js";

function compareLocusOrders(first, second) {
  return first.length === second.length && first.every((path, index) => path === second[index]);
}

function normalizeGenome(genome, id, provenance) {
  return {
    genome: { id, name: genome.name ?? genome.original_name ?? id, population: "discovered", genes: structuredClone(genome.genes) },
    provenance
  };
}

/**
 * Use every final Reach R29 top-14 contestant (98 old-population finalists) plus every
 * compatible evolved human opponent as exact founders.  Fill the rest of the 343-person
 * initial ecology with deterministic crosses among those founders, weighted by source rank.
 */
export function buildDiscoveredSeed({
  r29Checkpoint,
  namedOpponentDocument,
  mutationRangeDocument,
  random,
  populationSize = 343,
  idPrefix = "DISC_G0"
}) {
  if (r29Checkpoint?.generation !== "ReachR29" || !Array.isArray(r29Checkpoint.population)
    || namedOpponentDocument?.opponents === undefined || typeof random?.nextFloat !== "function") {
    throw new Error("Invalid discovered-ecology seed sources");
  }
  const r29ById = new Map(r29Checkpoint.population.map(genome => [genome.id, genome]));
  const finalists = [];
  for (const [sourceRubric, ids] of Object.entries(r29Checkpoint.finalTop14 ?? {})) {
    ids.forEach((id, index) => {
      const genome = r29ById.get(id);
      if (genome === undefined) throw new Error(`R29 finalist ${id} is absent from checkpoint population`);
      finalists.push({ genome, sourceRubric, sourceRank: index + 1 });
    });
  }
  const uniqueFinalists = [...new Map(finalists.map(entry => [entry.genome.id, entry])).values()];
  if (uniqueFinalists.length === 0) throw new Error("R29 checkpoint has no finalTop14 founders");

  const referenceOrder = flattenGenomeLoci(uniqueFinalists[0].genome).map(([path]) => path);
  if (referenceOrder.length !== 112) throw new Error("Discovered ecology requires 112-locus genomes");
  const mutationRanges = validateMutationRanges(mutationRangeDocument, referenceOrder);
  for (const entry of uniqueFinalists) {
    const order = flattenGenomeLoci(entry.genome).map(([path]) => path);
    if (!compareLocusOrders(referenceOrder, order)) throw new Error(`R29 founder ${entry.genome.id} has incompatible loci`);
  }

  const named = namedOpponentDocument.opponents.map((genome, index) => {
    const order = flattenGenomeLoci(genome).map(([path]) => path);
    if (!compareLocusOrders(referenceOrder, order)) throw new Error(`Named opponent ${genome.name ?? genome.id} is not genome-compatible with Reach R29`);
    return { genome, sourceRank: index + 1 };
  });

  const records = [];
  for (const entry of uniqueFinalists) records.push(normalizeGenome(
    entry.genome,
    `${idPrefix}_R29_${entry.genome.id}`,
    { origin: "reach_r29_finalist", sourceId: entry.genome.id, sourceRubric: entry.sourceRubric, sourceRank: entry.sourceRank }
  ));
  for (const entry of named) records.push(normalizeGenome(
    entry.genome,
    `${idPrefix}_NAMED_${entry.genome.id}`,
    { origin: "outmatch_named_opponent", sourceId: entry.genome.id, sourceName: entry.genome.name, sourceRank: entry.sourceRank }
  ));
  if (records.length >= populationSize) return { population: records.slice(0, populationSize), locusOrder: referenceOrder, mutationRanges };

  const founderWeights = records.map(record => {
    const rank = record.provenance.sourceRank ?? 14;
    return { record, weight: 1 / Math.sqrt(rank) };
  });
  const totalWeight = founderWeights.reduce((sum, entry) => sum + entry.weight, 0);
  const pick = () => {
    let draw = random.nextFloat() * totalWeight;
    for (const entry of founderWeights) {
      draw -= entry.weight;
      if (draw < 0) return entry.record;
    }
    return founderWeights.at(-1).record;
  };

  while (records.length < populationSize) {
    const father = pick();
    const mother = pick();
    const number = records.length + 1;
    const result = breedChild({
      id: `${idPrefix}_C${String(number).padStart(3, "0")}`,
      population: "discovered",
      father: father.genome,
      mother: mother.genome,
      locusOrder: referenceOrder,
      mutationRanges,
      random
    });
    records.push({
      genome: result.child,
      provenance: {
        ...result.provenance,
        origin: "founder_cross",
        fatherSource: father.provenance,
        motherSource: mother.provenance
      }
    });
  }
  return { population: records, locusOrder: referenceOrder, mutationRanges };
}
