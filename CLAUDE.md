# CLAUDE.md — Redliner Protocol (game)

Browser car game with AI bot drivers. No server, no backend, no secrets in the repo.

## Commands

| Command | What it does |
|---------|--------------|
| `just install` | npm install |
| `just dev` | Vite dev server at http://localhost:5173 |
| `just test` | Vitest: steering math, headless sim |
| `just verify` | check + test + build |

## Architecture

- `shared/` — wire types (`protocol.ts`), bot brain (`brain.ts`), pure math. No DOM, no network.
- `client/src/sim/` — physics, game loop, bot scheduling. `Game` is stepped by `step(dt)`.
- `client/src/sim/botbrain.ts` — OpenRouter calls; falls back to `scriptedDecision`.
- `sanitizeDecision` in `shared/brain.ts` clamps model output (coords, targets, chat length).

## Notes

- The prompt-injection CTF is in [`capability-wall`](https://github.com/DoctorKhan/capability-wall) (chat-only). This repo is the racing game.
- No key → bots run scripted (random driving + occasional banter).
