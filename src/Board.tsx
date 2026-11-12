import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BOARD_H,
  BOARD_W,
  lastOwnStroke,
  mergeOps,
  newId,
  pack,
  simplify,
  touches,
  visibleStrokes,
  widthAt,
  type Op,
  type Pt,
  type Stroke,
} from "./board";
import { openRoom, type Cursor, type Live, type Person, type Room } from "./room";

const COLOURS = ["#111111", "#ffffff", "#ff4d6d", "#ff9f1c", "#ffd60a", "#2ec27e", "#3a86ff", "#8b5cf6"];
const SIZES = [3, 7, 16];
type Tool = "pen" | "marker" | "eraser" | "hand";
type View = { scale: number; x: number; y: number };

/** Draws one stroke. Pens vary in width with pressure; markers are wide and see-through. */
function paint(ctx: CanvasRenderingContext2D, s: { colour: string; size: number; tool: "pen" | "marker"; points: Pt[] }) {
  const pts = s.points;
  if (!pts.length) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.colour;
  ctx.fillStyle = s.colour;
  if (s.tool === "marker") {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = s.size * 2.4;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], widthAt(s.size, pts[0][2]) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Smooth curve through midpoints, one segment at a time so the width can follow the pressure
  let prev = { x: pts[0][0], y: pts[0][1] };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1] ?? a;
    const mid = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
    ctx.lineWidth = widthAt(s.size, a[2]);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.quadraticCurveTo(a[0], a[1], mid.x, mid.y);
    ctx.stroke();
    prev = mid;
  }
}

export default function Board({ code, me }: { code: string; me: Person }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const room = useRef<Room | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([me]);
  const [tool, setTool] = useState<Tool>("pen");
  const [colour, setColour] = useState(COLOURS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const lives = useRef(new Map<string, { l: Live; at: number }>());
  const cursors = useRef(new Map<string, Cursor & { at: number }>());
  const [, tick] = useState(0); // re-render cursors
  const mine = useRef<Live | null>(null);
  const dirty = useRef(true);
  const viewRef = useRef(view);
  viewRef.current = view;
  const opsRef = useRef(ops);
  opsRef.current = ops;

  const strokes = useMemo(() => visibleStrokes(ops), [ops]);
  const strokesRef = useRef<Stroke[]>(strokes);
  strokesRef.current = strokes;

  // ---------- Connect ----------
  useEffect(() => {
    const r = openRoom(code, me, {
      op: (op) => {
        setOps((have) => mergeOps(have, [op]));
        if (op.kind === "stroke") lives.current.delete(op.id);
      },
      live: (l, done) => {
        if (done) setTimeout(() => lives.current.delete(l.id), 3000);
        else lives.current.set(l.id, { l, at: Date.now() });
        dirty.current = true;
      },
      cursor: (c) => {
        cursors.current.set(c.by, { ...c, at: Date.now() });
        tick((n) => n + 1);
      },
      people: setPeople,
    });
    room.current = r;
    r.load()
      .then((loaded) => setOps((have) => mergeOps(have, loaded)))
      .catch((e) => {
        console.error(e);
        setError("Couldn't load this board. Check your connection and refresh.");
      })
      .finally(() => setLoading(false));
    const sweep = setInterval(() => {
      const now = Date.now();
      for (const [id, c] of cursors.current) if (now - c.at > 4000) cursors.current.delete(id);
      for (const [id, l] of lives.current) if (now - l.at > 8000) lives.current.delete(id);
      tick((n) => n + 1);
    }, 1000);
    return () => {
      clearInterval(sweep);
      r.close();
    };
  }, [code, me]);

  const publish = useCallback((op: Op) => {
    setOps((have) => mergeOps(have, [op]));
    room.current?.publish(op).catch(() => setError("A change didn't save. Check your connection; it'll show for others once you're back online."));
  }, []);

  // ---------- Fit the board to the screen ----------
  const fit = useCallback(() => {
    const el = host.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const scale = Math.min(width / BOARD_W, height / BOARD_H) * 0.96;
    setView({ scale, x: (width - BOARD_W * scale) / 2, y: (height - BOARD_H * scale) / 2 });
  }, []);
  useEffect(() => {
    fit();
    const ro = new ResizeObserver(() => {
      const c = canvas.current!;
      c.width = c.clientWidth * devicePixelRatio;
      c.height = c.clientHeight * devicePixelRatio;
      dirty.current = true;
    });
    ro.observe(host.current!);
    addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      removeEventListener("resize", fit);
    };
  }, [fit]);

  // ---------- Render ----------
  // Strokes are redrawn as vectors at screen resolution, so they stay sharp at any zoom
  useEffect(() => {
    dirty.current = true;
  }, [strokes]);

  useEffect(() => {
    dirty.current = true;
  }, [view]);

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!dirty.current && !mine.current && lives.current.size === 0) return;
      dirty.current = false;
      const c = canvas.current;
      if (!c) return;
      const ctx = c.getContext("2d")!;
      const v = viewRef.current;
      const d = devicePixelRatio;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(v.scale * d, 0, 0, v.scale * d, v.x * d, v.y * d);
      ctx.fillStyle = "#fbfaf7";
      ctx.shadowColor = "rgba(0,0,0,0.25)";
      ctx.shadowBlur = 30;
      ctx.fillRect(0, 0, BOARD_W, BOARD_H);
      ctx.shadowBlur = 0;
      for (const st of strokesRef.current) paint(ctx, st);
      for (const { l } of lives.current.values()) paint(ctx, l);
      if (mine.current) paint(ctx, mine.current);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---------- Input ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; mid: { x: number; y: number }; view: View } | null>(null);
  const penSeen = useRef(false);
  const points = useRef<Pt[]>([]);
  const erasedNow = useRef(new Set<string>());

  const toBoard = (e: { clientX: number; clientY: number }) => {
    const r = host.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (e.clientX - r.left - v.x) / v.scale, y: (e.clientY - r.top - v.y) / v.scale };
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = host.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const startGesture = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a) return;
    gesture.current = {
      dist: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
      mid: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a,
      view: viewRef.current,
    };
  };

  const cancelStroke = () => {
    mine.current = null;
    points.current = [];
    dirty.current = true;
  };

  function eraseAt(p: { x: number; y: number }) {
    const r = 12 / viewRef.current.scale;
    const hits = strokesRef.current.filter((s) => !erasedNow.current.has(s.id) && touches(s, p, r)).map((s) => s.id);
    if (hits.length) {
      hits.forEach((id) => erasedNow.current.add(id));
      publish({ kind: "erase", id: newId(), t: Date.now(), ids: hits });
    }
  }

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "pen") penSeen.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    // Two fingers, the hand tool, or a finger after a pencil has been used: move and zoom
    const panning = tool === "hand" || pointers.current.size > 1 || (penSeen.current && e.pointerType === "touch") || e.button === 1;
    if (panning) {
      cancelStroke();
      startGesture();
      return;
    }
    const p = toBoard(e);
    if (tool === "eraser") {
      erasedNow.current.clear();
      eraseAt(p);
      return;
    }
    points.current = [[p.x, p.y, e.pressure || 0.5]];
    mine.current = { by: me.id, id: newId(), colour, size, tool, points: points.current };
    dirty.current = true;
  };

  const onMove = (e: React.PointerEvent) => {
    const p = toBoard(e);
    room.current?.sendCursor({ by: me.id, x: p.x, y: p.y });
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    if (gesture.current) {
      const g = gesture.current;
      const [a, b] = [...pointers.current.values()];
      const mid = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
      const zoom = b && g.dist ? Math.min(6, Math.max(0.2, (g.view.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist)) : g.view.scale;
      // Keep the point between the fingers fixed while zooming
      const bx = (g.mid.x - g.view.x) / g.view.scale;
      const by = (g.mid.y - g.view.y) / g.view.scale;
      setView({ scale: zoom, x: mid.x - bx * zoom, y: mid.y - by * zoom });
      return;
    }
    if (tool === "eraser") return eraseAt(p);
    if (!mine.current) return;
    // Use every coalesced event for smooth lines on fast moves
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const q = toBoard(ev);
      points.current.push([q.x, q.y, ev.pressure || 0.5]);
    }
    mine.current = { ...mine.current, points: points.current };
    room.current?.sendLive({ ...mine.current, points: pack(simplify(points.current, 0.8)) }, false);
    dirty.current = true;
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (gesture.current) {
      if (pointers.current.size) startGesture();
      else gesture.current = null;
      return;
    }
    if (!mine.current) return;
    const live = mine.current;
    const finished: Stroke = { id: live.id, by: me.id, colour: live.colour, size: live.size, tool: live.tool, points: pack(simplify(points.current)), t: Date.now() };
    room.current?.sendLive({ ...live, points: finished.points }, true);
    publish({ kind: "stroke", id: finished.id, t: finished.t, stroke: finished });
    mine.current = null;
    points.current = [];
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = host.current!.getBoundingClientRect();
    const v = viewRef.current;
    if (e.ctrlKey || e.metaKey) {
      const zoom = Math.min(6, Math.max(0.2, v.scale * Math.exp(-e.deltaY * 0.01)));
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView({ scale: zoom, x: mx - ((mx - v.x) / v.scale) * zoom, y: my - ((my - v.y) / v.scale) * zoom });
    } else setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
  };

  // Stop the page itself scrolling or zooming while drawing
  useEffect(() => {
    const el = host.current!;
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", stop, { passive: false });
    el.addEventListener("touchmove", stop, { passive: false });
    return () => {
      el.removeEventListener("wheel", stop);
      el.removeEventListener("touchmove", stop);
    };
  }, []);

  // ---------- Actions ----------
  const undo = () => {
    const s = lastOwnStroke(opsRef.current, me.id);
    if (s) publish({ kind: "erase", id: newId(), t: Date.now(), ids: [s.id] });
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
      const tools: Record<string, Tool> = { p: "pen", m: "marker", e: "eraser", h: "hand" };
      if (!e.metaKey && !e.ctrlKey && tools[e.key]) setTool(tools[e.key]);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportPng = () => {
    const out = document.createElement("canvas");
    out.width = BOARD_W;
    out.height = BOARD_H;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#fbfaf7";
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    for (const st of strokesRef.current) paint(ctx, st);
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = `${code}.png`;
    a.click();
  };

  const share = async () => {
    const link = location.href;
    try {
      if (navigator.share) await navigator.share({ title: "Draw with me", url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // share sheet closed
    }
  };

  const others = people.filter((p) => p.id !== me.id);
  const nameOf = (id: string) => people.find((p) => p.id === id);

  return (
    <div className="board-page">
      <header className="bar">
        <a href="#/" className="logo" aria-label="Draw Together home">
          ✦
        </a>
        <span className="room-code">{code}</span>
        <div className="people" aria-label={`${people.length} here`}>
          {[me, ...others].slice(0, 6).map((p) => (
            <span key={p.id} className="avatar" style={{ background: p.colour }} title={p.id === me.id ? `${p.name} (you)` : p.name}>
              {p.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
          {people.length > 6 && <span className="avatar more">+{people.length - 6}</span>}
        </div>
        <button className="pill" onClick={share}>
          {copied ? "Link copied" : "Invite"}
        </button>
      </header>

      {room.current?.kind === "local" && (
        <p className="local-note">Test mode: drawing syncs between tabs on this device only. Connect Supabase to draw with friends on other phones.</p>
      )}
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}

      <div
        className={`surface tool-${tool}`}
        ref={host}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      >
        <canvas ref={canvas} className="board-canvas" />
        {[...cursors.current.values()].map((c) => {
          const p = nameOf(c.by);
          if (!p) return null;
          return (
            <span key={c.by} className="cursor" style={{ transform: `translate(${view.x + c.x * view.scale}px, ${view.y + c.y * view.scale}px)`, ["--c" as string]: p.colour }}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M1 1l6 15 2.2-6.3L16 7.5z" fill="var(--c)" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              <b>{p.name}</b>
            </span>
          );
        })}
        {loading && <span className="loading-board">Loading the board…</span>}
      </div>

      <div className="toolbar" role="toolbar" aria-label="Drawing tools">
        <div className="group">
          {(
            [
              ["pen", "Pen", "M3 21l3.5-1 11-11-2.5-2.5-11 11zM14.5 6l2.5-2.5 2.5 2.5L17 8.5"],
              ["marker", "Marker", "M4 20h6M15 4l5 5-8 8H7v-5z"],
              ["eraser", "Eraser", "M7 20h12M5 14l8-8 6 6-6 6H9z"],
              ["hand", "Move", "M8 13V5.5a1.5 1.5 0 013 0V11m0-5.5V4a1.5 1.5 0 013 0v7m0-5a1.5 1.5 0 013 0v8a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L4.3 14a1.5 1.5 0 012.4-1.8L8 14"],
            ] as [Tool, string, string][]
          ).map(([t, label, d]) => (
            <button key={t} className={`tool ${tool === t ? "on" : ""}`} aria-pressed={tool === t} aria-label={label} title={label} onClick={() => setTool(t)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={d} />
              </svg>
            </button>
          ))}
        </div>
        <div className="group colours" role="radiogroup" aria-label="Colour">
          {COLOURS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={colour === c}
              aria-label={c}
              className={`swatch ${colour === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => {
                setColour(c);
                if (tool === "eraser" || tool === "hand") setTool("pen");
              }}
            />
          ))}
        </div>
        <div className="group" role="radiogroup" aria-label="Size">
          {SIZES.map((s) => (
            <button key={s} role="radio" aria-checked={size === s} aria-label={`Size ${s}`} className={`size ${size === s ? "on" : ""}`} onClick={() => setSize(s)}>
              <span style={{ width: Math.max(4, s * 0.9), height: Math.max(4, s * 0.9) }} />
            </button>
          ))}
        </div>
        <div className="group">
          <button className="tool" onClick={undo} aria-label="Undo your last stroke" title="Undo (Ctrl+Z)">
            ↶
          </button>
          <button className="tool" onClick={fit} aria-label="Fit board to screen" title="Fit to screen">
            ⤢
          </button>
          <button className="tool" onClick={exportPng} aria-label="Save as PNG" title="Save PNG">
            ⤓
          </button>
          {confirmClear ? (
            <button
              className="pill danger"
              onClick={() => {
                publish({ kind: "clear", id: newId(), t: Date.now(), by: me.id });
                setConfirmClear(false);
              }}
            >
              Clear for everyone?
            </button>
          ) : (
            <button className="tool" onClick={() => setConfirmClear(true)} aria-label="Clear the board" title="Clear">
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
