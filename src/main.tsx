import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import Board from "./Board";
import { newId, personColour, roomCode, validRoom } from "./board";
import { cloudReady, type Person } from "./room";

function readRoom() {
  const m = /^#\/r\/([a-z0-9-]+)$/.exec(location.hash);
  return m && validRoom(m[1]) ? m[1] : null;
}

/** You: the name is remembered on this device, and each tab gets its own id (so two tabs are two people). */
function useMe() {
  const [me, setMe] = useState<{ id: string; name: string }>(() => {
    let id = "";
    let name = "";
    try {
      id = sessionStorage.getItem("draw-together:id") ?? "";
      name = localStorage.getItem("draw-together:name") ?? "";
      if (!id) sessionStorage.setItem("draw-together:id", (id = newId()));
    } catch {
      id ||= newId();
    }
    return { id, name };
  });
  const save = (name: string) => {
    const next = { ...me, name: name.trim().slice(0, 20) };
    setMe(next);
    try {
      localStorage.setItem("draw-together:name", next.name);
    } catch {
      // fine without it
    }
  };
  return [me, save] as const;
}

function App() {
  const [room, setRoom] = useState(readRoom);
  const [me, saveName] = useMe();
  const [name, setName] = useState(me.name);
  const [join, setJoin] = useState("");
  useEffect(() => {
    const on = () => setRoom(readRoom());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  const person: Person = useMemo(() => ({ id: me.id, name: me.name || "Guest", colour: personColour(me.id) }), [me]);

  if (room && me.name) return <Board key={room} code={room} me={person} />;

  return (
    <main className="home">
      <div className="hero">
        <p className="eyebrow">Live, shared, instant</p>
        <h1>
          Draw
          <br />
          <em>Together</em>
        </h1>
        <p className="lede">One board, everyone's phones. See each other's strokes as they happen, with no sign-up. Send the link and start drawing.</p>
      </div>
      <form
        className="start"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          saveName(name);
          if (!room) location.hash = `#/r/${roomCode()}`;
        }}
      >
        <label>
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="So friends know who's drawing" maxLength={20} autoFocus />
        </label>
        <button className="primary" disabled={!name.trim()}>
          {room ? `Join ${room}` : "Start a board"}
        </button>
      </form>
      {!room && (
        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault();
            const code = join.trim().toLowerCase().split("/r/").pop()!;
            if (validRoom(code) && name.trim()) {
              saveName(name);
              location.hash = `#/r/${code}`;
            }
          }}
        >
          <input value={join} onChange={(e) => setJoin(e.target.value)} placeholder="Got a code? e.g. neon-tiger-42" aria-label="Board code" />
          <button className="pill" disabled={!validRoom(join.trim().toLowerCase().split("/r/").pop() ?? "") || !name.trim()}>
            Join
          </button>
        </form>
      )}
      {!cloudReady && <p className="fine">Test mode: boards sync between tabs on this device. Add your Supabase details to draw across devices (see the README).</p>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
