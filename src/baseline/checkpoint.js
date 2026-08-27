export const R29_POPULATIONS = Object.freeze([
  "horse_lords",
  "pike_lords",
  "archer_lords",
  "horse_hunters",
  "pike_hunters",
  "archer_hunters",
  "generalists"
]);

/** Return the genome's numeric loci in a stable, name-sorted order. */
export function flattenGenomeLoci(genome) {
  const loci = [];
  function visit(value, path) {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`Genome ${genome.id} has non-finite locus ${path}`);
      loci.push([path, value]);
      return;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Genome ${genome.id} has non-numeric locus ${path}`);
    }
    for (const key of Object.keys(value).sort()) visit(value[key], path ? `${path}.${key}` : key);
  }
  visit(genome.genes, "");
  return loci;
}

/** Build the two ID indexes shared by R29 ledger and report verification. */
export function indexR29Population(checkpoint) {
  const genomes = new Map();
  const populationByGenome = new Map();
  for (const genome of checkpoint.population) {
    if (genomes.has(genome.id)) throw new Error(`Duplicate R29 genome ID: ${genome.id}`);
    genomes.set(genome.id, genome);
    populationByGenome.set(genome.id, genome.population);
  }
  return { genomes, populationByGenome };
}

/** Validate the fixed transfer-boundary invariants of the supplied R29 state. */
export function validateR29Checkpoint(checkpoint) {
  if (checkpoint.generation !== "ReachR29") throw new Error("Expected ReachR29 checkpoint");
  if (checkpoint.populationSize !== 343 || checkpoint.population.length !== 343) {
    throw new Error("R29 checkpoint must contain 343 genomes");
  }
  if (checkpoint.populationSizeEach !== 49) throw new Error("R29 populations must contain 49 genomes");
  if (checkpoint.nextRecruitingPopulation !== "horse_hunters") {
    throw new Error("R29 next recruiting population must be horse_hunters");
  }
  if (checkpoint.populationOrder.length !== R29_POPULATIONS.length
    || checkpoint.populationOrder.some((population, index) => population !== R29_POPULATIONS[index])) {
    throw new Error("R29 checkpoint has unexpected population order");
  }

  const { genomes, populationByGenome } = indexR29Population(checkpoint);
  const counts = Object.fromEntries(R29_POPULATIONS.map(population => [population, 0]));
  for (const genome of genomes.values()) {
    if (!Object.hasOwn(counts, genome.population)) {
      throw new Error(`Genome ${genome.id} has unknown population ${genome.population}`);
    }
    counts[genome.population] += 1;
    const loci = flattenGenomeLoci(genome);
    if (loci.length !== 112) throw new Error(`Genome ${genome.id} has ${loci.length} loci; expected 112`);
  }
  for (const [population, count] of Object.entries(counts)) {
    if (count !== 49) throw new Error(`R29 population ${population} has ${count} genomes; expected 49`);
  }
  return { genomes, populationByGenome, counts };
}
