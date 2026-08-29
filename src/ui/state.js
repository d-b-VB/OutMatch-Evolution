function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

export function createLabState({ runs = [], generations = [], settings = null } = {}) {
  requireArray(runs, "Lab runs");
  requireArray(generations, "Lab generations");
  const selectedRunId = settings?.selectedRunId ?? runs[0]?.runId ?? null;
  const runExists = selectedRunId === null || runs.some(run => run.runId === selectedRunId);
  const runId = runExists ? selectedRunId : runs[0]?.runId ?? null;
  const available = generations.filter(generation => generation.runId === runId);
  const selectedGeneration = settings?.selectedRunId === runId
    && available.some(generation => generation.generation === settings.selectedGeneration)
    ? settings.selectedGeneration
    : available[0]?.generation ?? null;
  return { runs: structuredClone(runs), generations: structuredClone(generations), selectedRunId: runId, selectedGeneration };
}

export function selectRun(state, runId) {
  if (!state.runs.some(run => run.runId === runId)) throw new Error(`Unknown run ${runId}`);
  const generations = state.generations.filter(generation => generation.runId === runId);
  return { ...state, selectedRunId: runId, selectedGeneration: generations[0]?.generation ?? null };
}

export function selectGeneration(state, generation) {
  if (!state.generations.some(item => item.runId === state.selectedRunId && item.generation === generation)) {
    throw new Error(`Unknown generation ${generation}`);
  }
  return { ...state, selectedGeneration: generation };
}

export function selectedLabRecords(state) {
  return {
    run: state.runs.find(run => run.runId === state.selectedRunId) ?? null,
    generation: state.generations.find(item => item.runId === state.selectedRunId
      && item.generation === state.selectedGeneration) ?? null
  };
}
