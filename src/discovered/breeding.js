import { flattenGenomeLoci } from "../baseline/checkpoint.js";
import { breedChild, reconstructGenomeGenes } from "../evolution/breeding.js";
import { RUBRICS, SPECIALIST_RUBRICS } from "./rubrics.js";

export const DEFAULT_EXPLORATION = Object.freeze({ inRangeWildcards: 4, frontierWildcards: 3 });

export function collectSurvivorTitles(rankings, {
  generalistCount = 14,
  specialistCount = 4
} = {}) {
  const titles = new Map();
  const add = (rubric, entry) => {
    if (!titles.has(entry.id)) titles.set(entry.id, []);
    titles.get(entry.id).push({ rubric, rank: entry.rank });
  };
  for (const entry of (rankings.generalist ?? []).slice(0, generalistCount)) add("generalist", entry);
  for (const rubric of SPECIALIST_RUBRICS) for (const entry of (rankings[rubric] ?? []).slice(0, specialistCount)) add(rubric, entry);
  return titles;
}

/** Guaranteed-child awards stack when the same contestant holds multiple titles. */
export function planGuaranteedAwards(rankings) {
  const awards = [];
  const add = (rubric, count, copies = 1) => {
    for (const entry of (rankings[rubric] ?? []).slice(0, count)) {
      for (let copy = 0; copy < copies; copy += 1) awards.push({ rubric, fatherId: entry.id, fatherRank: entry.rank, kind: "guaranteed" });
    }
  };
  add("generalist", 7, 1);
  add("generalist", 3, 1);
  add("generalist", 1, 1);
  for (const rubric of SPECIALIST_RUBRICS) {
    add(rubric, 2, 1);
    add(rubric, 1, 1);
  }
  return awards;
}

function weightedPick(entries, random) {
  if (!Array.isArray(entries) || entries.length === 0 || typeof random?.nextFloat !== "function") throw new Error("Rank lottery requires entries and RNG");
  const weights = entries.map(entry => 1 / Math.sqrt(entry.rank));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let draw = random.nextFloat() * total;
  for (let index = 0; index < entries.length; index += 1) {
    draw -= weights[index];
    if (draw < 0) return entries[index];
  }
  return entries.at(-1);
}

function eligibleMateRanks(rankings, rubric) {
  const count = rubric === "generalist" ? 14 : 4;
  const entries = (rankings[rubric] ?? []).slice(0, count);
  if (entries.length === 0) throw new Error(`No breeding ranks for ${rubric}`);
  return entries;
}

export function attachGuaranteedMothers(awards, rankings, random) {
  return awards.map(award => ({ ...award, motherId: weightedPick(eligibleMateRanks(rankings, award.rubric), random).id }));
}

/** Ordinary births choose a rubric with Generalist weighted 7:1 against every specialty. */
export function planOrdinaryParents(count, rankings, random, { generalistRubricWeight = 7 } = {}) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Ordinary birth count must be nonnegative");
  const rubricTickets = [
    ...Array.from({ length: generalistRubricWeight }, () => "generalist"),
    ...SPECIALIST_RUBRICS
  ];
  return Array.from({ length: count }, () => {
    const rubric = rubricTickets[Math.floor(random.nextFloat() * rubricTickets.length)];
    const pool = eligibleMateRanks(rankings, rubric);
    return {
      kind: "ordinary",
      rubric,
      fatherId: weightedPick(pool, random).id,
      motherId: weightedPick(pool, random).id
    };
  });
}

function locusMatrix(genomes, locusOrder) {
  return genomes.map(genome => {
    const values = new Map(flattenGenomeLoci(genome));
    return locusOrder.map(path => {
      const value = values.get(path);
      if (!Number.isFinite(value)) throw new Error(`Missing synthetic locus ${path} in ${genome.id}`);
      return value;
    });
  });
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Robust continuous-data mode: densest of seven equal-width bins, then median within that bin. */
function binnedMode(values, binCount = 7) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) return minimum;
  const width = (maximum - minimum) / binCount;
  const bins = Array.from({ length: binCount }, () => []);
  for (const value of values) bins[Math.min(binCount - 1, Math.floor((value - minimum) / width))].push(value);
  const best = bins.reduce((winner, bin) => bin.length > winner.length ? bin : winner, bins[0]);
  return median(best);
}

export function synthesizeGenome({ id, genomes, locusOrder, method }) {
  if (!["mean", "median", "mode"].includes(method) || genomes.length === 0) throw new Error("Invalid synthetic genome request");
  const matrix = locusMatrix(genomes, locusOrder);
  const loci = locusOrder.map((path, locus) => {
    const values = matrix.map(row => row[locus]);
    const value = method === "mean"
      ? values.reduce((sum, item) => sum + item, 0) / values.length
      : method === "median" ? median(values) : binnedMode(values);
    return [path, value];
  });
  return {
    genome: { id, genes: reconstructGenomeGenes(loci) },
    provenance: { origin: "synthetic", method, sourceIds: genomes.map(genome => genome.id) }
  };
}

/** Default consensus entrants: mean/median/mode of top 49 G, top 7 G, and top 14 of each specialty. */
export function buildDefaultSyntheticEntrants({ rankings, genomeById, locusOrder, idPrefix }) {
  const cohorts = [
    { label: "G49", ids: (rankings.generalist ?? []).slice(0, 49).map(entry => entry.id) },
    { label: "G7", ids: (rankings.generalist ?? []).slice(0, 7).map(entry => entry.id) },
    ...SPECIALIST_RUBRICS.map(rubric => ({ label: `${rubric}_14`, ids: (rankings[rubric] ?? []).slice(0, 14).map(entry => entry.id) }))
  ];
  return cohorts.flatMap(cohort => ["mean", "median", "mode"].map(method => {
    const genomes = cohort.ids.map(id => genomeById.get(id)).filter(Boolean);
    if (genomes.length !== cohort.ids.length || genomes.length === 0) throw new Error(`Incomplete synthetic cohort ${cohort.label}`);
    return synthesizeGenome({ id: `${idPrefix}_SYN_${cohort.label}_${method}`, genomes, locusOrder, method });
  }));
}

export function observedLocusRanges(genomes, locusOrder) {
  const ranges = new Map(locusOrder.map(path => [path, { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY }]));
  for (const genome of genomes) {
    for (const [path, value] of flattenGenomeLoci(genome)) {
      const range = ranges.get(path);
      if (range === undefined) throw new Error(`Unexpected locus ${path}`);
      range.minimum = Math.min(range.minimum, value);
      range.maximum = Math.max(range.maximum, value);
    }
  }
  return ranges;
}

export function generateExplorationWildcard({ id, locusOrder, observedRanges, random, frontier = false }) {
  const loci = locusOrder.map(path => {
    const range = observedRanges.get(path);
    if (range === undefined || !Number.isFinite(range.minimum) || !Number.isFinite(range.maximum)) throw new Error(`Missing observed range ${path}`);
    const width = Math.max(range.maximum - range.minimum, Math.max(Math.abs(range.minimum), Math.abs(range.maximum), 1) * 0.05);
    let value;
    if (!frontier) value = random.nextRange(range.minimum, range.maximum);
    else if (random.nextFloat() < 0.5) value = random.nextRange(range.minimum - width, range.minimum);
    else value = random.nextRange(range.maximum, range.maximum + width);
    return [path, value];
  });
  return {
    genome: { id, genes: reconstructGenomeGenes(loci) },
    provenance: { origin: frontier ? "frontier_wildcard" : "in_range_wildcard" }
  };
}

/** Breed all cross children after awards/synthetic/wildcard reservations are known. */
export function materializeCrossBirths({ parentPlans, genomeById, locusOrder, mutationRanges, random, idPrefix }) {
  return parentPlans.map((plan, index) => {
    const father = genomeById.get(plan.fatherId);
    const mother = genomeById.get(plan.motherId);
    if (father === undefined || mother === undefined) throw new Error("Breeding plan references missing parent");
    const result = breedChild({
      id: `${idPrefix}_B${String(index + 1).padStart(3, "0")}`,
      population: "discovered",
      father,
      mother,
      locusOrder,
      mutationRanges,
      random
    });
    return { genome: result.child, provenance: { ...result.provenance, origin: "cross", rubric: plan.rubric, selection: plan.kind } };
  });
}

export function validateRankingsForBreeding(rankings) {
  for (const rubric of RUBRICS) if (!Array.isArray(rankings[rubric])) throw new Error(`Missing ${rubric} ranking`);
  return rankings;
}
