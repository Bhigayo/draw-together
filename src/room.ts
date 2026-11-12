// How a board talks to other devices. Two versions with the same shape:
// - CloudRoom: Supabase (a table for the history, Realtime for live strokes, cursors and who's here).
// - LocalRoom: other tabs in this browser only, for trying it out with no setup.

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { mergeOps, type Op, type Pt } from "./board";

export type Person = { id: string; name: string; colour: string };
export type Live = { by: string; id: string; colour: string; size: number; tool: "pen" | "marker"; points: Pt[] };
export type Cursor = { by: string; x: number; y: number };

export type Handlers = {
  op(op: Op): void;
  live(l: Live, done: boolean): void;
  cursor(c: Cursor): void;
  people(p: Person[]): void;
};

export interface Room {
  kind: "cloud" | "local";
  load(): Promise<Op[]>;
  publish(op: Op): Promise<void>;
  sendLive(l: Live, done: boolean): void;
  sendCursor(c: Cursor): void;
  close(): void;
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
export const cloudReady = supabase !== null;

export function openRoom(code: string, me: Person, on: Handlers): Room {
  return supabase ? cloudRoom(supabase, code, me, on) : localRoom(code, me, on);
}

// ---------- Cloud ----------

function cloudRoom(sb: SupabaseClient, code: string, me: Person, on: Handlers): Room {
  const channel: RealtimeChannel = sb.channel(`board:${code}`, { config: { broadcast: { self: false }, presence: { key: me.id } } });
  channel
    .on("broadcast", { event: "op" }, ({ payload }) => on.op(payload as Op))
    .on("broadcast", { event: "live" }, ({ payload }) => on.live(payload.l as Live, payload.done as boolean))
    .on("broadcast", { event: "cursor" }, ({ payload }) => on.cursor(payload as Cursor))
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<Person>();
      on.people(Object.values(state).map((list) => list[0]).filter(Boolean));
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") channel.track(me);
    });

  // Live updates are throttled so a fast drawer doesn't flood the channel
  let lastLive = 0;
  let lastCursor = 0;
  return {
    kind: "cloud",
    async load() {
      const { data, error } = await sb.from("ops").select("op").eq("room", code).order("t").limit(20000);
      if (error) throw error;
      return mergeOps([], (data ?? []).map((r) => r.op as Op));
    },
    async publish(op) {
      channel.send({ type: "broadcast", event: "op", payload: op });
      const { error } = await sb.from("ops").insert({ id: op.id, room: code, t: op.t, op });
      if (error && error.code !== "23505") throw error; // 23505: already saved
    },
    sendLive(l, done) {
      const now = performance.now();
      if (!done && now - lastLive < 50) return;
      lastLive = now;
      channel.send({ type: "broadcast", event: "live", payload: { l, done } });
    },
    sendCursor(c) {
      const now = performance.now();
      if (now - lastCursor < 60) return;
      lastCursor = now;
      channel.send({ type: "broadcast", event: "cursor", payload: c });
    },
    close() {
      sb.removeChannel(channel);
    },
  };
}

// ---------- Local (tabs in this browser) ----------

function localRoom(code: string, me: Person, on: Handlers): Room {
  const bc = new BroadcastChannel(`draw-together:${code}`);
  const storeKey = `draw-together:${code}`;
  const seen = new Map<string, { p: Person; at: number }>([[me.id, { p: me, at: Date.now() }]]);
  const read = (): Op[] => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? "[]");
    } catch {
      return [];
    }
  };
  const announcePeople = () => {
    const now = Date.now();
    for (const [id, v] of seen) if (id !== me.id && now - v.at > 6000) seen.delete(id);
    on.people([...seen.values()].map((v) => v.p));
  };

  bc.onmessage = (e) => {
    const m = e.data as { type: string; [k: string]: unknown };
    if (m.type === "op") on.op(m.op as Op);
    if (m.type === "live") on.live(m.l as Live, m.done as boolean);
    if (m.type === "cursor") on.cursor(m.c as Cursor);
    if (m.type === "hello" || m.type === "here") {
      const p = m.p as Person;
      const isNew = !seen.has(p.id);
      seen.set(p.id, { p, at: Date.now() });
      if (m.type === "hello" && isNew) bc.postMessage({ type: "here", p: me });
      announcePeople();
    }
    if (m.type === "bye") {
      seen.delete((m.p as Person).id);
      announcePeople();
    }
  };
  bc.postMessage({ type: "hello", p: me });
  const beat = setInterval(() => {
    bc.postMessage({ type: "here", p: me });
    announcePeople();
  }, 2000);
  announcePeople();

  return {
    kind: "local",
    async load() {
      return mergeOps([], read());
    },
    async publish(op) {
      bc.postMessage({ type: "op", op });
      try {
        localStorage.setItem(storeKey, JSON.stringify(mergeOps(read(), [op])));
      } catch {
        // storage full; the drawing still syncs live
      }
    },
    sendLive(l, done) {
      bc.postMessage({ type: "live", l, done });
    },
    sendCursor(c) {
      bc.postMessage({ type: "cursor", c });
    },
    close() {
      clearInterval(beat);
      bc.postMessage({ type: "bye", p: me });
      bc.close();
    },
  };
}
