# Orbz

A real-time multiplayer arena game. 2–6 players join via a 4-letter room code, fly a glowing circle around a dark space arena, eat orbs to grow, and absorb smaller players. The last one floating wins. Built on HTML5 Canvas + Supabase Realtime, with a global leaderboard.

![Orbz menu](https://img.shields.io/badge/HTML5-Canvas-orange?style=flat-square) ![Supabase](https://img.shields.io/badge/Supabase-Realtime-3FCF8E?style=flat-square) ![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square)

## Features

- **Multiplayer rooms (2–6 players)** — share a 4-letter code with friends to play together.
- **Canvas rendering** at devicePixelRatio with glow trails, pulsing orbs, twinkling parallax stars.
- **Supabase Realtime broadcast** at 20Hz for player positions; presence for the lobby; broadcast events for eats, eliminations, game start/end.
- **Eat-to-grow physics** — your radius (and score) grows by `√(r² + orb²)`. To absorb another player you need to be 15% larger than them.
- **Spectate mode** — eliminated players keep watching the round play out, camera following the current leader.
- **Global leaderboard** — final scores persist to Supabase Postgres and show across rooms.
- **Auto host re-election** — if the original host leaves, the next-earliest joiner takes over orb spawning.
- **Dark space visuals** — radial gradients, neon glow, glassmorphism UI panels.

## Quick start

```bash
git clone https://github.com/joseb33w/orbz.git
cd orbz
npm install
cp .env.example .env   # then fill in your Supabase values
npm run dev
```

Open http://localhost:5173 in two browser tabs (or share with a friend's machine on the same network). One creates a room, the other joins with the 4-letter code, then the host clicks Start.

### Production build

```bash
npm run build
npm run preview
```

Vite outputs to `dist/`. The build is configured with `base: './'` so it can be hosted at any sub-path.

## Configuration

All three env vars are required (see `.env.example`):

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | Public anon (publishable) key — safe to ship in the browser. |
| `VITE_TABLE_PREFIX` | Prefix applied to the leaderboard table name (`<prefix>_leaderboard`), so this app can share one Supabase project with other apps without colliding. |

## Backend schema

A single Postgres table — `<VITE_TABLE_PREFIX>_leaderboard` — backs the global leaderboard. RLS is enabled with public read + public insert (no leaderboard mutation/deletion is supported). The table has the columns:

```
id                   uuid primary key
user_id              text       -- per-device UUID stored in localStorage
player_name          text       -- 1–24 chars
score                int        -- 0–1,000,000
room_code            text       -- exactly 4 chars
survival_seconds     int        -- 0–7200
players_eliminated   int        -- 0–100
won                  boolean
created_at           timestamptz default now()
```

Each round, every player POSTs their own final stats; the leaderboard view orders by `score desc`.

## How the realtime sync works

Each room is a Supabase Realtime channel named `orbz_room_<CODE>`. The protocol uses three Realtime primitives:

- **Presence** (`track` / `presenceState`) — tracks who is in the lobby. The earliest `joined_at` is treated as the host.
- **Broadcast** — five game events:
  - `state` (sent by each player at 20Hz) — `{ id, x, y, r, alive, name, color, eliminations }`
  - `orb_state` (sent by host every ~700ms) — full orb list, authoritative
  - `orb_eaten` (sent when any player eats an orb) — peers remove it locally and mark it in a dedup set so a stale `orb_state` can't re-add it
  - `player_eaten` (sent by the eater) — victim flips `alive=false`, eater's new radius is broadcast
  - `game_start` / `game_end` — host emits, all clients apply
- **Per-player local simulation** — each client runs the same physics deterministically; broadcasts overwrite remote players' state. The host is authoritative for orbs and for declaring game-end.

There's no central server. Two clients in the same room talk through Supabase's Realtime relay.

## Controls

- **WASD** or **Arrow keys** — move your circle. Speed slows as you grow.
- **Eat orbs** — touch them. Score = round(π × r²).
- **Absorb players** — overlap a player whose radius is at least 15% smaller than yours.
- **After elimination** — camera follows the current leader until the round ends.

## Known limitations

- No anti-cheat. The client is authoritative for its own movement and eats. Fine for friendly play; not OK for ranked tournaments.
- New players who arrive mid-round wait in the lobby until the host starts a new round.
- Hard arena edges — no toroidal wrap.

## License

MIT
