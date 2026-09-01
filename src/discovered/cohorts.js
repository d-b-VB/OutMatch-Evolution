import { RUBRICS, SPECIALIST_RUBRICS, rankRubric } from "./rubrics.js";

export const LOCAL_GROUP_COUNT = 7;
export const LOCAL_GROUP_SIZE = 49;
export const GENERALISTS_PER_GROUP = 7;
export const SPECIALISTS_PER_RUBRIC = 14;
export const LOCAL_SPECIALISTS_PER_RUBRIC = 7;

/** Deterministically shuffle 343 contestants into seven otherwise meaningless screening groups. */
export function buildRandomScreeningGroups(genomes, random, {
  groupCount = LOCAL_GROUP_COUNT,
  groupSize = LOCAL_GROUP_SIZE
} = {}) {
  if (!Array.isArray(genomes) || genomes.length !== groupCount * groupSize || typeof random?.nextFloat !== "function") {
    throw new Error("Screening groups require the full population and an explicit RNG");
  }
  const shuffled = [...genomes];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random.nextFloat() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return Array.from({ length: groupCount }, (_, group) => shuffled
    .slice(group * groupSize, (group + 1) * groupSize)
    .map(genome => genome.id));
}

/** Top seven Generalists from each screening group form the 49-person Generalist testing cohort. */
export function selectGeneralistCohort(report, groups, perGroup = GENERALISTS_PER_GROUP) {
  const selected = [];
  for (const ids of groups) selected.push(...rankRubric(report, "generalist", ids).slice(0, perGroup).map(entry => entry.id));
  if (new Set(selected).size !== selected.length) throw new Error("Generalist cohort contains duplicates");
  return selected;
}

function candidateRankCosts(report, groups, excluded) {
  const groupById = new Map(groups.flatMap((ids, group) => ids.map(id => [id, group])));
  const costs = new Map();
  for (const rubric of SPECIALIST_RUBRICS) {
    const ranking = rankRubric(report, rubric).filter(entry => !excluded.has(entry.id));
    const globalRank = new Map(ranking.map((entry, index) => [entry.id, index + 1]));
    const localRanks = groups.map(ids => {
      const eligible = new Set(ids.filter(id => !excluded.has(id)));
      const local = ranking.filter(entry => eligible.has(entry.id));
      return new Map(local.map((entry, index) => [entry.id, index + 1]));
    });
    costs.set(rubric, { ranking, globalRank, localRanks, groupById });
  }
  return costs;
}

/**
 * Build 112 mutually exclusive specialist testing places as one assignment problem.
 * Each rubric receives one representative from every screening group plus seven at-large
 * places.  Costs are within-rubric ranks rather than raw fitness values so the different
 * numerical scales of Lords and Hunters cannot make one rubric steal all versatile agents.
 */
export function selectNonOverlappingSpecialistCohorts(report, groups, generalistIds, {
  atLargePerRubric = SPECIALISTS_PER_RUBRIC - LOCAL_SPECIALISTS_PER_RUBRIC
} = {}) {
  if (!(report instanceof Map) || !Array.isArray(groups) || groups.length !== LOCAL_GROUP_COUNT) {
    throw new Error("Invalid specialist cohort inputs");
  }
  const excluded = new Set(generalistIds);
  const costs = candidateRankCosts(report, groups, excluded);
  const slots = [];
  for (const rubric of SPECIALIST_RUBRICS) {
    for (let group = 0; group < groups.length; group += 1) slots.push({ rubric, kind: "local", group });
    for (let index = 0; index < atLargePerRubric; index += 1) slots.push({ rubric, kind: "at_large", index });
  }

  // Successive shortest augmenting paths over a bipartite slot/candidate graph.
  // With 112 slots and <=294 candidates this is small enough to solve exactly in-browser.
  const assignment = minCostAssignment(slots, [...report.keys()].filter(id => !excluded.has(id)), (slot, id) => {
    const data = costs.get(slot.rubric);
    if (slot.kind === "local") {
      if (data.groupById.get(id) !== slot.group) return null;
      const rank = data.localRanks[slot.group].get(id);
      return rank === undefined ? null : rank;
    }
    const rank = data.globalRank.get(id);
    return rank === undefined ? null : rank;
  });

  const cohorts = Object.fromEntries(SPECIALIST_RUBRICS.map(rubric => [rubric, []]));
  for (let index = 0; index < slots.length; index += 1) cohorts[slots[index].rubric].push(assignment[index]);
  for (const rubric of SPECIALIST_RUBRICS) {
    if (cohorts[rubric].length !== SPECIALISTS_PER_RUBRIC) throw new Error(`Incomplete ${rubric} cohort`);
  }
  const all = Object.values(cohorts).flat();
  if (new Set(all).size !== all.length || all.some(id => excluded.has(id))) throw new Error("Specialist cohorts overlap");
  return cohorts;
}

function minCostAssignment(slots, candidateIds, edgeCost) {
  const slotCount = slots.length;
  const candidateCount = candidateIds.length;
  const source = 0;
  const slotOffset = 1;
  const candidateOffset = slotOffset + slotCount;
  const sink = candidateOffset + candidateCount;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (from, to, capacity, cost) => {
    const forward = { to, reverse: graph[to].length, capacity, cost, original: capacity };
    const reverse = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost, original: 0 };
    graph[from].push(forward);
    graph[to].push(reverse);
  };
  for (let slot = 0; slot < slotCount; slot += 1) addEdge(source, slotOffset + slot, 1, 0);
  for (let candidate = 0; candidate < candidateCount; candidate += 1) addEdge(candidateOffset + candidate, sink, 1, 0);
  for (let slot = 0; slot < slotCount; slot += 1) {
    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
      const cost = edgeCost(slots[slot], candidateIds[candidate]);
      if (cost !== null && Number.isFinite(cost)) addEdge(slotOffset + slot, candidateOffset + candidate, 1, cost);
    }
  }

  let flow = 0;
  while (flow < slotCount) {
    const distance = Array(graph.length).fill(Number.POSITIVE_INFINITY);
    const previousNode = Array(graph.length).fill(-1);
    const previousEdge = Array(graph.length).fill(-1);
    distance[source] = 0;
    // Bellman-Ford is deliberately simple here; residual negative edges make plain Dijkstra unsafe.
    for (let pass = 0; pass < graph.length - 1; pass += 1) {
      let changed = false;
      for (let node = 0; node < graph.length; node += 1) {
        if (!Number.isFinite(distance[node])) continue;
        for (let edgeIndex = 0; edgeIndex < graph[node].length; edgeIndex += 1) {
          const edge = graph[node][edgeIndex];
          if (edge.capacity <= 0 || distance[node] + edge.cost >= distance[edge.to]) continue;
          distance[edge.to] = distance[node] + edge.cost;
          previousNode[edge.to] = node;
          previousEdge[edge.to] = edgeIndex;
          changed = true;
        }
      }
      if (!changed) break;
    }
    if (!Number.isFinite(distance[sink])) throw new Error("No non-overlapping specialist assignment exists");
    for (let node = sink; node !== source; node = previousNode[node]) {
      const from = previousNode[node];
      const edge = graph[from][previousEdge[node]];
      edge.capacity -= 1;
      graph[node][edge.reverse].capacity += 1;
    }
    flow += 1;
  }

  return slots.map((slot, slotIndex) => {
    const node = slotOffset + slotIndex;
    const chosen = graph[node].find(edge => edge.to >= candidateOffset && edge.to < sink && edge.original === 1 && edge.capacity === 0);
    if (chosen === undefined) throw new Error(`Unassigned specialist slot ${slot.rubric}`);
    return candidateIds[chosen.to - candidateOffset];
  });
}

export function buildEliteTestingCohort(generalists, specialists) {
  const ids = [...generalists, ...SPECIALIST_RUBRICS.flatMap(rubric => specialists[rubric])];
  if (ids.length !== 161 || new Set(ids).size !== 161) throw new Error("Elite testing cohort must contain 161 unique contestants");
  return ids;
}

export function validateRubricName(rubric) {
  if (!RUBRICS.includes(rubric)) throw new Error(`Unknown rubric: ${rubric}`);
  return rubric;
}
