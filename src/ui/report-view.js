const LABELS = Object.freeze({
  elimination: "Elimination matrix",
  similarity: "Genetic similarity",
  fitness: "Fitness & specialization",
  unitRates: "Unit training & kills",
  rankings: "Population rankings",
  migration: "Migration summary",
  breeding: "Breeding summary",
  comparison: "Generation comparison"
});

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reportEntries(generation, previousGeneration) {
  if (!generation) return [];
  const reports = plainObject(generation.reports) ? generation.reports : {};
  const entries = Object.entries(reports).map(([id, value]) => ({ id, label: LABELS[id] ?? id, value }));
  if (Array.isArray(generation.rankings) || plainObject(generation.rankings)) {
    entries.push({ id: "rankings", label: LABELS.rankings, value: generation.rankings });
  }
  if (plainObject(generation.migration)) entries.push({ id: "migration", label: LABELS.migration, value: generation.migration });
  if (plainObject(generation.breeding)) entries.push({ id: "breeding", label: LABELS.breeding, value: generation.breeding });
  if (previousGeneration) entries.push({
    id: "comparison", label: LABELS.comparison,
    value: buildGenerationComparison(generation, previousGeneration)
  });
  const unique = new Map(entries.map(entry => [entry.id, entry]));
  return [...unique.values()].sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

function matrixTable(value) {
  const matrix = plainObject(value?.matrix) ? value.matrix : null;
  if (!matrix) return null;
  const columns = Object.keys(matrix);
  if (!columns.length || columns.some(column => !plainObject(matrix[column]))) return null;
  return {
    columns: ["population", ...columns],
    rows: columns.map(row => [row, ...columns.map(column => matrix[row][column] ?? null)])
  };
}

function matrixView(value) {
  const table = matrixTable(value);
  if (!table) return null;
  const columns = table.columns.slice(1);
  return { columns, rows: table.rows.map(row => ({ row: row[0], values: row.slice(1) })) };
}

function flatten(value, prefix = "", result = {}) {
  if (plainObject(value)) {
    for (const key of Object.keys(value).sort()) flatten(value[key], prefix ? `${prefix}.${key}` : key, result);
  } else if (!Array.isArray(value)) result[prefix] = value;
  return result;
}

function records(value) {
  if (Array.isArray(value)) return value;
  if (!plainObject(value)) return [];
  const array = Object.values(value).flat().filter(item => plainObject(item));
  return array.length ? array : Object.entries(value).map(([key, item]) => plainObject(item) ? { key, ...item } : { key, value: item });
}

function recordsTable(items) {
  if (!items.length) return null;
  const flattened = items.map(item => flatten(item));
  const columns = [...new Set(flattened.flatMap(Object.keys))].sort();
  return { columns, rows: flattened.map(item => columns.map(column => item[column] ?? null)) };
}

function reportTable(id, value) {
  if (["elimination", "similarity"].includes(id)) return matrixTable(value) ?? recordsTable(records(value?.counts ?? value?.comparisons));
  if (id === "unitRates") {
    const source = value?.individual ?? value?.gameWeighted ?? value;
    return recordsTable(records(source));
  }
  if (["rankings", "fitness"].includes(id)) return recordsTable(records(value));
  if (["migration", "breeding"].includes(id)) {
    const preferred = value?.selected ?? value?.migrants ?? value?.births ?? value?.pairs;
    return recordsTable(records(preferred ?? value));
  }
  if (id === "comparison") return { columns: ["metric", "previous", "current", "delta"], rows: value.rows.map(row => [row.metric, row.previous, row.current, row.delta]) };
  return matrixTable(value) ?? recordsTable(records(value));
}

function numericLeaves(value, prefix = "", output = {}) {
  if (Number.isFinite(value)) output[prefix] = value;
  else if (plainObject(value)) for (const key of Object.keys(value).sort()) numericLeaves(value[key], prefix ? `${prefix}.${key}` : key, output);
  return output;
}

/** Compare only numeric values already archived in two immutable generation records. */
export function buildGenerationComparison(current, previous) {
  const currentValues = numericLeaves({ reports: current?.reports, migration: current?.migration, breeding: current?.breeding });
  const previousValues = numericLeaves({ reports: previous?.reports, migration: previous?.migration, breeding: previous?.breeding });
  const rows = Object.keys(currentValues).filter(metric => Object.hasOwn(previousValues, metric)).sort().map(metric => ({
    metric, previous: previousValues[metric], current: currentValues[metric], delta: currentValues[metric] - previousValues[metric]
  }));
  return { currentGeneration: current.generation, previousGeneration: previous.generation, rows };
}

export function buildReportView(generation, selectedId = null, previousGeneration = null) {
  const reports = reportEntries(generation, previousGeneration);
  if (!reports.length) return { reports, selected: null, table: null, matrix: null };
  const selected = reports.find(report => report.id === selectedId) ?? reports[0];
  const table = reportTable(selected.id, selected.value);
  const matrix = matrixView(selected.value);
  return { reports, selected, table, matrix };
}

function csvCell(value) {
  const text = value == null ? "" : plainObject(value) || Array.isArray(value) ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function reportDownload(view, format) {
  if (!view?.selected) throw new Error("Choose a report before downloading");
  if (format === "json") return {
    extension: "json", type: "application/json",
    text: `${JSON.stringify(view.selected.value, null, 2)}\n`
  };
  if (format !== "csv") throw new Error(`Unsupported report format: ${format}`);
  if (!view.table) throw new Error("The selected report has no tabular CSV representation");
  const lines = [view.table.columns.map(csvCell).join(",")];
  for (const row of view.table.rows) lines.push(row.map(csvCell).join(","));
  return { extension: "csv", type: "text/csv", text: `${lines.join("\n")}\n` };
}
