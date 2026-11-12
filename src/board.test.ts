import { describe, expect, it } from "vitest";
import { lastOwnStroke, mergeOps, pack, roomCode, simplify, touches, validRoom, visibleStrokes, type Op, type Pt, type Stroke } from "./board";

const stroke = (id: string, by: string, t: number, points: Pt[] = [[0, 0, 0.5], [10, 0, 0.5]]): Op => ({
  kind: "stroke",
  id,
  t,
  stroke: { id, by, colour: "#000", size: 4, tool: "pen", points, t },
});

describe("the shared board", () => {
  it("shows the same picture whatever order operations arrive in", () => {
    const ops: Op[] = [stroke("a", "ada", 1), stroke("b", "tobi", 2), { kind: "erase", id: "e1", t: 3, ids: ["a"] }, stroke("c", "ada", 4)];
    const forwards = ops.reduce<Op[]>((have, op) => mergeOps(have, [op]), []);
    const backwards = [...ops].reverse().reduce<Op[]>((have, op) => mergeOps(have, [op]), []);
    expect(visibleStrokes(forwards).map((s) => s.id)).toEqual(["b", "c"]);
    expect(visibleStrokes(backwards).map((s) => s.id)).toEqual(["b", "c"]);
  });

  it("ignores operations it has already seen", () => {
    const once = mergeOps([], [stroke("a", "ada", 1)]);
    expect(mergeOps(once, [stroke("a", "ada", 1)])).toBe(once);
  });

  it("clears everything drawn before the clear, but keeps what's drawn after", () => {
    const ops: Op[] = [stroke("a", "ada", 1), stroke("b", "tobi", 2), { kind: "clear", id: "c1", t: 5, by: "ada" }, stroke("c", "tobi", 6)];
    expect(visibleStrokes(ops).map((s) => s.id)).toEqual(["c"]);
  });

  it("undo finds your own latest stroke, not someone else's", () => {
    const ops: Op[] = [stroke("a", "ada", 1), stroke("b", "tobi", 2), stroke("c", "ada", 3), stroke("d", "tobi", 4)];
    expect(lastOwnStroke(ops, "ada")?.id).toBe("c");
    const undone = mergeOps(ops, [{ kind: "erase", id: "e", t: 5, ids: ["c"] }]);
    expect(lastOwnStroke(undone, "ada")?.id).toBe("a");
  });
});

describe("points", () => {
  it("simplifies straight runs to their ends but keeps corners", () => {
    const line: Pt[] = Array.from({ length: 50 }, (_, i) => [i, 0, 0.5]);
    expect(simplify(line)).toHaveLength(2);
    const corner: Pt[] = [...Array.from({ length: 20 }, (_, i) => [i, 0, 0.5] as Pt), ...Array.from({ length: 20 }, (_, i) => [19, i + 1, 0.5] as Pt)];
    const s = simplify(corner);
    expect(s).toHaveLength(3);
    expect(s[1]).toEqual([19, 0, 0.5]);
  });

  it("rounds points to keep messages small", () => {
    expect(pack([[10.04567, 3.99, 0.4567]])).toEqual([[10, 4, 0.46]]);
  });

  it("knows when the eraser touches a stroke", () => {
    const s = (stroke("a", "ada", 1, [[0, 0, 0.5], [100, 0, 0.5]]) as { stroke: Stroke }).stroke;
    expect(touches(s, { x: 50, y: 8 }, 6)).toBe(true);
    expect(touches(s, { x: 50, y: 20 }, 6)).toBe(false);
    expect(touches(s, { x: 120, y: 0 }, 6)).toBe(false);
  });
});

describe("rooms", () => {
  it("makes readable room codes", () => {
    const code = roomCode(() => 0.5);
    expect(code).toBe("golden-jollof-55");
    expect(validRoom(code)).toBe(true);
    expect(validRoom("DROP TABLE")).toBe(false);
  });
});
