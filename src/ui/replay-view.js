import { BOARD_CELLS } from "../engine/board.js";

const BASES = new Map([["-3,0", "R"], ["3,0", "B"]]);

function point([q, r]) {
  return { x: 50 + q * 11 + r * 5.5, y: 50 + r * 9.5 };
}

/** Convert one immutable replay frame into display-only board geometry. */
export function buildReplayFrameView(frames, actions, requestedIndex = 0) {
  if (!Array.isArray(frames) || frames.length === 0 || !Array.isArray(actions)
    || frames.length !== actions.length + 1) throw new Error("Replay frames and actions are inconsistent");
  const index = Math.max(0, Math.min(frames.length - 1,
    Number.isSafeInteger(requestedIndex) ? requestedIndex : 0));
  const frame = frames[index];
  const units = (frame?.units ?? []).filter(unit => Array.isArray(unit.pos) && unit.pos.length === 2)
    .map(unit => ({ id: String(unit.id), side: unit.side, type: unit.typ, active: unit.active !== false, ...point(unit.pos) }));
  return {
    index, total: frames.length, round: frame?.round ?? null, turn: frame?.turn ?? null,
    action: index === 0 ? null : structuredClone(actions[index - 1]),
    cells: BOARD_CELLS.map(position => ({ position, base: BASES.get(position.join(",")) ?? null, ...point(position) })),
    units
  };
}
