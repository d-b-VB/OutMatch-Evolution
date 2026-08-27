/**
 * Build the directional natural-elimination report used by the Reach ecology.
 * Every cross-population game contributes to both directional denominators, but
 * only an elimination contributes to the winning population's numerator.
 */
export function buildEliminationMatrix(rows, populationByGenome, populationOrder) {
  const counts = new Map();
  for (const rowPopulation of populationOrder) {
    for (const colPopulation of populationOrder) {
      if (rowPopulation !== colPopulation) {
        counts.set(`${rowPopulation}\0${colPopulation}`, {
          rowPopulation,
          colPopulation,
          games: 0,
          rowEliminations: 0
        });
      }
    }
  }

  for (const row of rows) {
    const validResult = (row.outcome === "elimination" && ["R", "B"].includes(row.winner))
      || (row.outcome === "draw" && (row.winner === "" || row.winner === null));
    if (!validResult) {
      throw new Error(`Invalid ledger result: ${row.outcome} with winner ${row.winner}`);
    }
    const redPopulation = populationByGenome.get(row.redId);
    const bluePopulation = populationByGenome.get(row.blueId);
    if (redPopulation === undefined || bluePopulation === undefined) {
      throw new Error(`Unknown genome in ledger row: ${row.redId} vs ${row.blueId}`);
    }
    if (redPopulation === bluePopulation) {
      throw new Error(`Within-population ecology game: ${row.redId} vs ${row.blueId}`);
    }

    const redCount = counts.get(`${redPopulation}\0${bluePopulation}`);
    const blueCount = counts.get(`${bluePopulation}\0${redPopulation}`);
    if (redCount === undefined || blueCount === undefined) {
      throw new Error("Ledger population is missing from populationOrder");
    }
    redCount.games += 1;
    blueCount.games += 1;
    if (row.outcome === "elimination" && row.winner === "R") redCount.rowEliminations += 1;
    if (row.outcome === "elimination" && row.winner === "B") blueCount.rowEliminations += 1;
  }

  const matrix = Object.fromEntries(populationOrder.map(rowPopulation => [
    rowPopulation,
    Object.fromEntries(populationOrder.map(colPopulation => {
      if (rowPopulation === colPopulation) return [colPopulation, null];
      const count = counts.get(`${rowPopulation}\0${colPopulation}`);
      return [colPopulation, count.games === 0 ? null : count.rowEliminations / count.games];
    }))
  ]));

  const reportCounts = [...counts.values()].map(count => ({
    ...count,
    rate: count.games === 0 ? null : count.rowEliminations / count.games
  }));
  return { matrix, counts: reportCounts };
}
