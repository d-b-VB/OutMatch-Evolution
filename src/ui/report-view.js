const LABELS = Object.freeze({
  elimination: "Elimination matrix",
  similarity: "Genetic similarity",
  fitness: "Fitness & specialization",
  unitRates: "Unit training & kills",
  rankings: "Population rankings",
  migration: "Migration summary",
  breeding: "Breeding summary"
});

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reportEntries(generation) {
  if (!generation) return [];
  const reports = plainObject(generation.reports) ? generation.reports : {};
  const entries = Object.entries(reports).map(([id, value]) => ({ id, label: LABELS[id] ?? id, value }));
  if (Array.isArray(generation.rankings)) entries.push({ id: "rankings", label: LABELS.rankings, value: generation.rankings });
  if (plainObject(generation.migration)) entries.push({ id: "migration", label: LABELS.migration, value: generation.migration });
  if (plainObject(generation.breeding)) entries.push({ id: "breeding", label: LABELS.breeding, value: generation.breeding });
  return entries.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

function matrixRows(value) {
  const matrix = plainObject(value?.matrix) ? value.matrix : null;
  if (!matrix) return null;
  const columns = Object.keys(matrix);
  if (!columns.length || columns.some(column => !plainObject(matrix[column]))) return null;
  return { columns, rows: columns.map(row => ({ row, values: columns.map(column => matrix[row][column] ?? null) })) };
}

export function buildReportView(generation, selectedId = null) {
  const reports = reportEntries(generation);
  if (!reports.length) return { reports, selected: null, matrix: null };
  const selected = reports.find(report => report.id === selectedId) ?? reports[0];
  return { reports, selected, matrix: matrixRows(selected.value) };
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
  if (!view.matrix) throw new Error("CSV download is currently available for matrix reports");
  const lines = [["population", ...view.matrix.columns].map(csvCell).join(",")];
  for (const row of view.matrix.rows) lines.push([row.row, ...row.values].map(csvCell).join(","));
  return { extension: "csv", type: "text/csv", text: `${lines.join("\n")}\n` };
}
