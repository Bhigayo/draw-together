# Draw Together

One board, everyone's phones. Share a link and draw together live: you see each other's strokes while they're being drawn, plus everyone's cursors and who's in the room. There's no sign-up, just a name.

- **Tools:** a pen whose line gets thicker with Apple Pencil or stylus pressure, a see-through marker, an eraser, and move/zoom (pinch with two fingers, or use the trackpad).
- **iPad:** once you've used an Apple Pencil, your fingers only move the board, so your palm won't draw by accident.
- **Undo** removes your own last stroke, never someone else's. **Clear** clears the board for everyone. **Save PNG** exports the board as an image.
- Shortcuts: P pen, M marker, E eraser, H move, Ctrl/Cmd+Z undo.

## How it stays in sync

The board is a list of operations that only ever grows (`src/board.ts`):

- Drawing adds a stroke.
- Erasing and clearing add operations that hide strokes. Nothing is ever edited or deleted.
- Every device sorts the operations the same way (by time, then id) and ignores duplicates.

So everyone ends up with exactly the same picture, whatever order messages arrive in. There's nothing to merge and nothing to conflict.

Live strokes are sent about 20 times a second, simplified with Ramer-Douglas-Peucker and rounded to keep messages small. When a stroke is finished it's saved, so anyone who joins later loads the full history. This is all covered by tests in `src/board.test.ts`.

## Test mode vs real

- **No setup:** boards sync between tabs on the same device. Open the link in two tabs to try it.
- **With Supabase:** it works across phones.
  1. Create a new Supabase project (free). In **SQL Editor**, run `supabase_setup.sql`.
  2. Copy the Project URL and the publishable key (Project Settings → API).
  3. Locally, copy `.env.example` to `.env.local` and fill both in. On GitHub, go to **Settings → Secrets and variables → Actions → Variables** and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

Boards are public to anyone with the link, like a shared doc.

## Run it

```
npm install
npm run dev
npm test
```

## Put it online (GitHub Pages)

In PowerShell, run one line at a time:

```
git init
git add -A
git commit -m "Draw Together"
git branch -M main
git remote add origin https://github.com/Bhigayo/draw-together.git
git push -u origin main
```

Then go to **Settings → Pages → Source: GitHub Actions**.
