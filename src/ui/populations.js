import { R29_POPULATIONS } from "../baseline/checkpoint.js";
import { validateIntervention } from "./interventions.js";

const SORT_FIELDS = new Set(["rank", "id", "name", "origin", "fitness", "training", "kills", "pokes", "parentage"]);

function rankingIndex(rankings) {
  const values = Array.isArray(rankings) ? rankings : Object.values(rankings ?? {}).flat();
  return new Map(values.filter(value => value?.id).map(value => [value.id, value]));
}

function numeric(value) { return Number.isFinite(value) ? value : null; }

function metric(record, names) {
  for (const name of names) if (Number.isFinite(record?.[name])) return record[name];
  return null;
}

function unitRateIndex(generation) {
  return new Map((generation?.reports?.unitRates?.individual ?? []).map(record => [record.id, record]));
}

function unitTotal(record, field) {
  const values = record?.[field];
  return values && ["P", "A", "C"].every(unit => Number.isFinite(values[unit]))
    ? values.P + values.A + values.C : null;
}

function parentage(provenance) {
  const parents = [provenance?.fatherId ?? provenance?.father, provenance?.motherId ?? provenance?.mother]
    .filter(value => typeof value === "string");
  return parents.length ? parents.join(" × ") : provenance?.sourceId ?? "—";
}

function compare(left, right, field, direction) {
  const a = left[field];
  const b = right[field];
  const missing = value => value === null || value === undefined;
  if (missing(a) !== missing(b)) return missing(a) ? 1 : -1;
  const result = typeof a === "number" && typeof b === "number"
    ? a - b : String(a ?? "").localeCompare(String(b ?? ""));
  return result * (direction === "desc" ? -1 : 1) || left.id.localeCompare(right.id);
}

/** Build independent population rows without sorting or decorating archived objects. */
export function buildPopulationView(generation, {
  population = "all", query = "", sort = "rank", direction = "asc", selectedId = null
} = {}) {
  if (!SORT_FIELDS.has(sort)) throw new Error(`Unsupported population sort: ${sort}`);
  if (!["asc", "desc"].includes(direction)) throw new Error(`Unsupported sort direction: ${direction}`);
  if (population !== "all" && !R29_POPULATIONS.includes(population)) throw new Error(`Unknown population: ${population}`);
  const genomes = generation?.checkpoint?.population ?? [];
  if (!Array.isArray(genomes)) throw new Error("Generation population must be an array");
  const ranks = rankingIndex(generation?.rankings);
  const unitRates = unitRateIndex(generation);
  const provenance = generation?.checkpoint?.provenance ?? {};
  const rows = genomes.map(genome => {
    const ranking = ranks.get(genome.id) ?? {};
    const rates = unitRates.get(genome.id);
    const origin = provenance[genome.id] ?? {};
    return {
      id: String(genome.id),
      name: String(genome.name ?? genome.id),
      population: genome.population,
      rank: Number.isSafeInteger(ranking.rank) ? ranking.rank : null,
      fitness: numeric(ranking.fitness),
      training: unitTotal(rates, "trainedPerGame") ?? metric(ranking, ["training", "trained", "trainingRate"]),
      kills: unitTotal(rates, "killsPerGame") ?? metric(ranking, ["kills", "killRate"]),
      pokes: numeric(rates?.pokesPerGame) ?? metric(ranking, ["pokes", "pokeRate"]),
      unitRates: rates ? structuredClone(rates) : null,
      origin: String(origin.origin ?? "unknown"),
      parentage: parentage(origin)
    };
  });
  const counts = Object.fromEntries(R29_POPULATIONS.map(name => [name, rows.filter(row => row.population === name).length]));
  if (rows.length === 343 && Object.values(counts).some(count => count !== 49)) {
    throw new Error("Complete generation populations must contain 49 generals each");
  }
  const needle = query.trim().toLocaleLowerCase();
  const visible = rows.filter(row => (population === "all" || row.population === population)
    && (!needle || [row.id, row.name, row.origin, row.parentage].some(value => value.toLocaleLowerCase().includes(needle))))
    .sort((left, right) => compare(left, right, sort, direction));
  const selectedGenome = selectedId == null ? null : genomes.find(genome => genome.id === selectedId);
  const detail = selectedGenome ? {
    row: rows.find(row => row.id === selectedId),
    genome: structuredClone(selectedGenome),
    provenance: structuredClone(provenance[selectedId] ?? {}),
    fitness: structuredClone(ranks.get(selectedId) ?? {}),
    unitRates: structuredClone(unitRates.get(selectedId) ?? null)
  } : null;
  return { summaries: R29_POPULATIONS.map(name => ({ population: name, count: counts[name] })), rows: visible, detail };
}

/** Create a validator-backed manual move draft from a selected archived general. */
export function interventionForGeneral(general, destination, note) {
  return validateIntervention({
    type: "manual-move", generalId: general?.id, from: general?.population, to: destination, note
  });
}
