// The shared board, as a list of operations that only ever grows.
// Strokes are added, and erases and clears are added too (they hide strokes rather than delete them).
// Because nothing is ever edited in place, every device that has the same operations shows exactly the
// same picture, whatever order they arrived in. No conflicts to resolve.

export const BOARD_W = 1600;
export const BOARD_H = 1200;

export type Pt = [x: number, y: number, pressure: number];

export type Stroke = {
  id: string;
  by: string; // user id
  colour: string;
  size: number;
  tool: "pen" | "marker";
  points: Pt[];
  t: number; // when it was finished, ms
};

export type Op =
  | { kind: "stroke"; id: string; t: number; stroke: Stroke }
  | { kind: "erase"; id: string; t: number; ids: string[] }
  | { kind: "clear"; id: string; t: number; by: string };

export function newId() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Puts operations in one agreed order: by time, then id. Every device sorts the same way. */
export const sortOps = (ops: Op[]) => [...ops].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Adds operations, ignoring any already seen (the same op can arrive twice: once live, once from storage). */
export function mergeOps(have: Op[], incoming: Op[]): Op[] {
  const seen = new Set(have.map((o) => o.id));
  const fresh = incoming.filter((o) => !seen.has(o.id) && (seen.add(o.id), true));
  return fresh.length ? sortOps([...have, ...fresh]) : have;
}

/** The strokes you can see: everything drawn after the last clear, minus anything erased. */
export function visibleStrokes(ops: Op[]): Stroke[] {
  const sorted = sortOps(ops);
  let lastClear = -Infinity;
  const erased = new Set<string>();
  for (const op of sorted) {
    if (op.kind === "clear") lastClear = Math.max(lastClear, op.t);
    if (op.kind === "erase") op.ids.forEach((id) => erased.add(id));
  }
  return sorted.flatMap((op) => (op.kind === "stroke" && op.t > lastClear && !erased.has(op.id) ? [op.stroke] : []));
}

/** Your most recent stroke that's still showing, for undo. */
export function lastOwnStroke(ops: Op[], userId: string) {
  return visibleStrokes(ops)
    .filter((s) => s.by === userId)
    .at(-1);
}

// ---------- Points ----------

const distToSegment = (p: { x: number; y: number }, a: Pt, b: Pt) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy));
};

/** Ramer-Douglas-Peucker: drops points that don't change the shape, so strokes are small to send. */
export function simplify(points: Pt[], tolerance = 0.6): Pt[] {
  if (points.length < 3) return points;
  let maxD = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = distToSegment({ x: points[i][0], y: points[i][1] }, first, last);
    if (d > maxD) {
      maxD = d;
      index = i;
    }
  }
  if (maxD <= tolerance) return [first, last];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

/** Rounds points to keep messages small: whole board units and two decimals of pressure. */
export const pack = (points: Pt[]): Pt[] => points.map(([x, y, p]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100]);

/** Does the eraser at `p` (radius `r`) touch this stroke? */
export function touches(stroke: Stroke, p: { x: number; y: number }, r: number) {
  const reach = r + stroke.size / 2;
  const pts = stroke.points;
  if (pts.length === 1) return Math.hypot(p.x - pts[0][0], p.y - pts[0][1]) <= reach;
  for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= reach) return true;
  return false;
}

/** Width at a point: pressure from an Apple Pencil or stylus thickens the line; mice and fingers report 0.5. */
export const widthAt = (size: number, pressure: number) => size * (0.45 + Math.min(1, pressure || 0.5) * 1.1);

// ---------- Rooms ----------

const WORDS_A = ["neon", "lime", "velvet", "cosmic", "sunny", "midnight", "golden", "rapid", "quiet", "loud", "fresh", "lucky"];
const WORDS_B = ["tiger", "mango", "comet", "canvas", "rhythm", "pixel", "jollof", "dragon", "falcon", "orbit", "lotus", "breeze"];

export function roomCode(random = Math.random) {
  const pick = (a: string[]) => a[Math.floor(random() * a.length)];
  return `${pick(WORDS_A)}-${pick(WORDS_B)}-${10 + Math.floor(random() * 90)}`;
}

export const validRoom = (code: string) => /^[a-z]+-[a-z]+-\d{2}$/.test(code);

/** A friendly colour for each person's cursor, picked from their id so it's the same everywhere. */
export function personColour(id: string) {
  const palette = ["#ff5ea8", "#5ec8ff", "#ffb020", "#8b6bff", "#2fd08a", "#ff6b4a", "#00c2c7"];
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
