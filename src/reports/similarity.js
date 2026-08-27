import { flattenGenomeLoci } from "../baseline/checkpoint.js";

/** Validate the frozen R29 quantiles and their alignment with canonical genomes. */
export function validateSimilarityBaseline(baseline, representativeGenome) {
  if (baseline.generation !== "ReachR29" || baseline.locusCount !== 112) {
    throw new Error("Expected 112-locus ReachR29 similarity baseline");
  }
  if (baseline.locusOrder.length !== 112 || new Set(baseline.locusOrder).size !== 112) {
    throw new Error("Similarity baseline must contain 112 unique locus names");
  }
  if (Object.keys(baseline.loci).length !== 112) {
    throw new Error("Similarity baseline must contain 112 locus ranges");
  }
  const genomeOrder = flattenGenomeLoci(representativeGenome).map(([name]) => name);
  if (baseline.locusOrder.some((name, index) => name !== genomeOrder[index])) {
    throw new Error("Similarity baseline locus order does not match genome loci");
  }
  for (const name of baseline.locusOrder) {
    const quantiles = baseline.loci[name];
    if (quantiles === undefined
      || !Number.isFinite(quantiles.q05)
      || !Number.isFinite(quantiles.q95)
      || !Number.isFinite(quantiles.span)
      || quantiles.span < 0
      || quantiles.span !== quantiles.q95 - quantiles.q05) {
      throw new Error(`Invalid similarity baseline for locus ${name}`);
    }
  }
  return baseline;
}

/** Calculate one frozen-range locus contribution, including the zero-span rule. */
export function locusSimilarity(a, b, span) {
  if (![a, b, span].every(Number.isFinite) || span < 0) {
    throw new Error("Locus similarity requires finite values and a non-negative span");
  }
  if (span === 0) return a === b ? 1 : 0;
  return Math.max(0, 1 - Math.abs(a - b) / span);
}

/** Calculate fixed-baseline similarity between two 112-locus genomes. */
export function genomeSimilarity(a, b, baseline) {
  const aLoci = new Map(flattenGenomeLoci(a));
  const bLoci = new Map(flattenGenomeLoci(b));
  if (aLoci.size !== baseline.locusOrder.length || bLoci.size !== baseline.locusOrder.length) {
    throw new Error("Genome and similarity baseline locus counts differ");
  }
  let total = 0;
  for (const name of baseline.locusOrder) {
    if (!aLoci.has(name) || !bLoci.has(name) || baseline.loci[name] === undefined) {
      throw new Error(`Missing similarity locus ${name}`);
    }
    total += locusSimilarity(aLoci.get(name), bLoci.get(name), baseline.loci[name].span);
  }
  return total / baseline.locusOrder.length;
}

/** Summarize a non-empty set of pair similarities. */
export function similarityStatistics(values) {
  if (values.length === 0 || values.some(value => !Number.isFinite(value))) {
    throw new Error("Similarity statistics require finite pair values");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    n_pairs: sorted.length,
    min: sorted[0],
    median,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    max: sorted.at(-1)
  };
}

/** Compare every unique within-population pair. */
export function withinPopulationSimilarity(genomes, baseline) {
  const values = [];
  for (let a = 0; a < genomes.length; a += 1) {
    for (let b = a + 1; b < genomes.length; b += 1) {
      values.push(genomeSimilarity(genomes[a], genomes[b], baseline));
    }
  }
  return similarityStatistics(values);
}

/** Compare the Cartesian product of two different populations. */
export function betweenPopulationSimilarity(aGenomes, bGenomes, baseline) {
  const values = [];
  for (const a of aGenomes) {
    for (const b of bGenomes) values.push(genomeSimilarity(a, b, baseline));
  }
  return similarityStatistics(values);
}

/** Build the symmetric population matrix and detailed pair summaries. */
export function buildSimilarityReport(checkpoint, baseline) {
  const populations = Object.fromEntries(checkpoint.populationOrder.map(population => [
    population,
    checkpoint.population.filter(genome => genome.population === population)
  ]));
  const matrix = Object.fromEntries(checkpoint.populationOrder.map(population => [population, {}]));
  const comparisons = [];
  for (let a = 0; a < checkpoint.populationOrder.length; a += 1) {
    const aName = checkpoint.populationOrder[a];
    for (let b = a; b < checkpoint.populationOrder.length; b += 1) {
      const bName = checkpoint.populationOrder[b];
      const type = a === b ? "within" : "between";
      const statistics = type === "within"
        ? withinPopulationSimilarity(populations[aName], baseline)
        : betweenPopulationSimilarity(populations[aName], populations[bName], baseline);
      comparisons.push({ type, A: aName, B: bName, ...statistics });
      matrix[aName][bName] = statistics.mean;
      matrix[bName][aName] = statistics.mean;
    }
  }
  return { matrix, comparisons };
}
