# Redliner Protocol

A browser car game where you share one arena and one chat with three **AI-driven cars**.
Runs **entirely in your browser**: no server, no backend, and no secrets in the repo.

## What it is

Drive a physics-based circuit, manage hull damage and RedBucks upgrades at service
terminals, and banter with three AI drivers over shared chat. The bots read chat to
decide what to chase, flee, or say — so you get emergent racing behavior without a
backend.

The **Bot Telemetry** panel (top right) shows every raw LLM decision when an API key
is configured.

## Stack

- **Everything client-side** (`client/`): Vite + TypeScript. Three.js rendering with
  snapshot interpolation; [Rapier](https://rapier.rs) physics (Rust→WebAssembly) in
  the browser; the whole simulation in `client/src/sim/`.
- **Shared logic** (`shared/`): data types, bot brain, and pure math — DOM-free so the
  same code runs in the browser and under tests.
- **Bot brains**: OpenRouter, called directly from the browser with the player's own key.

## Run it

```sh
just install
just dev       # http://localhost:5173
just test      # unit + headless-sim suite
just verify    # check + test + build
```

Always open the game through `just dev` or `just preview`. Do not double-click
`dist/index.html` — browsers block ES modules and WebAssembly from `file://`.

The game starts immediately with an automatically generated driver identity. If an
**OpenRouter** API key was previously saved, it is reused; otherwise the bots run in
scripted mode and the optional AI status chip can add one later.

> Security note: the key lives in `localStorage` and is used from client-side JavaScript.
> That's fine here because it's *your* key and the page loads no third-party scripts.

## Deploy (static)

```sh
just build            # -> dist/
npx gh-pages -d dist  # or upload dist/ via GitHub Actions Pages
```

No env vars or secrets to configure — players bring their own key in the UI.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, tick model, bot pipeline.
- [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md) — file-by-file guide and tuning constants.
- [`CLAUDE.md`](CLAUDE.md) — commands and conventions for contributors.

## Related

The prompt-injection CTF lives in
[`capability-wall`](https://github.com/DoctorKhan/capability-wall) — a chat-only
security portfolio piece. Pair it with
[`multi-agent-data-segregation`](https://github.com/DoctorKhan/multi-agent-data-segregation)
for multi-agent data-boundary demos.
