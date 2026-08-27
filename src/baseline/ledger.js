const STRING_FIELDS = new Set(["stage", "redId", "outcome", "blueId", "winner"]);
const R29_STAGES = ["stage1_core", "stage2_elite", "challenger"];

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  values.push(value);
  return values;
}

/** Parse the canonical R29 staged-ledger CSV into typed row objects. */
export function parseR29Ledger(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("R29 ledger must contain a header and at least one row");
  const fields = parseCsvLine(lines[0]);

  return lines.slice(1).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    if (values.length !== fields.length) {
      throw new Error(`R29 ledger row ${rowIndex + 2} has ${values.length} fields; expected ${fields.length}`);
    }
    return Object.fromEntries(fields.map((field, fieldIndex) => {
      const value = values[fieldIndex];
      if (STRING_FIELDS.has(field)) return [field, value];
      const number = Number(value);
      if (value === "" || !Number.isFinite(number)) {
        throw new Error(`R29 ledger row ${rowIndex + 2} has invalid numeric ${field}`);
      }
      return [field, number];
    }));
  });
}

/** Count the canonical tournament stages before report calculations consume them. */
export function summarizeR29Ledger(rows) {
  const stages = Object.fromEntries(R29_STAGES.map(stage => [stage, 0]));
  for (const [index, row] of rows.entries()) {
    if (!Object.hasOwn(stages, row.stage)) {
      throw new Error(`R29 ledger row ${index + 2} has unknown stage ${row.stage}`);
    }
    stages[row.stage] += 1;
  }
  return { totalGames: rows.length, stages };
}
