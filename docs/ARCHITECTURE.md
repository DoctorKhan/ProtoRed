# Architecture

## System overview

Redliner Protocol is a **fully static, single-player** browser app. There is no server.
Everything — physics, the game loop, the AI bot drivers, the CTF — runs in the visitor's
browser. The only outbound network call is each bot's LLM request, sent directly from the
page to OpenRouter using the visitor's own pasted API key.

```
┌──────────────────────────── Browser tab ─────────────────────────────┐
│                                                                       │
│  client/src/main.ts     — zero-input startup, key handling, UI,       │
│                            60Hz sim loop, rAF render loop             │
│                                                                       │
│  client/src/sim/        THE SIMULATION (ported from the old server)   │
│    game.ts    — Game: players, chat, bot scheduling, CTF, step(dt)    │
│    physics.ts — Rapier world + arcade car model (Rust→wasm)           │
│    botbrain.ts— OpenRouter call w/ localStorage key → Decision        │
│                                                                       │
│  client/src/render.ts   — Three.js scene, snapshot interpolation, cam │
│  client/src/input.ts    — keyboard → {throttle, brake, steer}         │
│  client/src/ctf.ts      — the CTF ladder panel                        │
│                                                                       │
│  shared/  (DOM-free, network-free — also imported by the tests)       │
│    protocol.ts   — data types, arena dims, obstacle layout            │
│    brain.ts      — personas, prompt, DECISION_SCHEMA, sanitizeDecision,│
│                    scriptedDecision, describeWorld                     │
│    detectors.ts  — CTF success detectors + attribution                │
│    challenges.ts — CTF level metadata                                 │
│    mathutil.ts   — yaw/rotate/steer math                              │
│                                                                       │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ per bot, every ~9s (sooner when named in chat)
                                ▼
                    OpenRouter chat/completions
                    (visitor's own key; strict json_schema)
```

**Why static single-player.** The project is a security *portfolio* piece; the CTF is
inherently you-versus-the-bots, so it doesn't need a shared server. Going static means
zero hosting cost, zero API cost to the author (players bring their own key), no abuse
surface, and a repo anyone can read and run. The trade is that there is no human-to-human
multiplayer — each visitor gets their own local arena. (An earlier version was
server-authoritative multiplayer; the git history / `docs` roadmap notes the path back.)

## The `Game` is a pure state machine

`client/src/sim/game.ts` holds all simulation state and is advanced **only** by
`step(dt)`. It has no DOM and no network access. Everything variable is injected:

- a `decide(persona, self, others, chat, lastAction) => Promise<Decision>` function
  (browser: OpenRouter; tests: the scripted brain), and
- a set of event callbacks (`onSnapshot`, `onChat`, `onBotDecision`, `onCtfProgress`,
  `onCtfSolved`, `onPlayerJoined`, `onNotice`).

This is why the same `Game` runs in the browser *and* under Vitest (Rapier's wasm runs in
Node). `main.ts` drives it at 60Hz with `setInterval`; `tests/game.test.ts` drives it by
calling `step(1/60)` in a loop. Neither owns the simulation logic.

## Tick model

| Loop | Rate | Where | Does |
|---|---|---|---|
| Sim step | 60 Hz (`setInterval` in main.ts) | `Game.step(dt)` | input → per-bot controller → `driveCar` forces → `world.step` → fire due bot thinks → emit snapshot every 3rd tick |
| Snapshot | 20 Hz (every 3rd step) | `Game` → `onSnapshot` | `CarState[]` handed to the renderer's interpolation buffer |
| Render | rAF (~60 Hz) | `render.ts` | interpolates between the two snapshots spanning `now - 120ms` |
| Input | 60 Hz (in the sim loop) | `input.ts` → `Game.setInput` | current keyboard state |
| Bot think | ~9–12s per bot, staggered; ~1.5–3s when named in chat | `Game.think` (async) | one OpenRouter call → new `BotAction` + optional chat |

Bot think scheduling is time-based, not timer-based: each bot has a `nextThinkAt` in sim
seconds; `step()` fires `think()` when `simTime` passes it. This keeps the whole sim a
deterministic function of `step(dt)` calls (essential for the headless test).

Each think uses OpenRouter's task-aware auto router, so model choice can vary with the
situation. The actual provider-reported model is included in bot telemetry; regardless
of model, every response crosses the same schema and `sanitizeDecision` capability
boundary.

## Bot decision pipeline (the AI-security core)

```
world state + last 14 chat messages          ← chat = UNTRUSTED INPUT (you + the other bots)
        │
        ▼
system prompt (persona + hardening tier)     ← defense 1: prompt hardening
        │                                       (Blaze hardened / Zen moderate / Gizmo naive
        ▼                                        — the asymmetry is intentional)
OpenRouter, response_format = strict
json_schema {action{kind,target_name,x,z}, say}  ← defense 2: constrained action surface
        │                                           (a hijacked bot still can't exceed the schema)
        ▼
sanitizeDecision()                           ← defense 3: validation
        │                                       (clamp coords to arena, verify target names,
        ▼                                        bound chat) — identical for LLM & scripted
Game applies the action via the per-tick controller (botControls → steerToward)
        │                                       — the LLM never touches raw controls
        ├→ onBotDecision → telemetry panel
        └→ evaluateCtf(evidence) → detectors → onCtfSolved / onCtfProgress
```

The LLM operates at the **strategic** level (pick chase/flee/goto/wander every ~9s);
deterministic code handles the **reflex** level (steering at 60Hz). Split is both a
latency necessity and a security property: a compromised brain only selects among four
vetted behaviors, and `sanitizeDecision` bounds even those.

Failure ladder in `botbrain.ts`: no key → scripted; 401 → disable permanently (a bad key
won't recover) + notice; 429 / other error / unparseable → scripted for that cycle.

## Data types (`shared/protocol.ts`)

`CarState {id, p:[x,y,z], q:[x,y,z,w], speed}`, `PlayerInfo {id, name, isBot, color}`,
`BotAction {kind, target_name, x, z}`, plus `ARENA_HALF` and `OBSTACLES` (the physics
builds colliders and the renderer builds meshes from the same array, so the arena stays
in sync). The old `ClientMsg`/`ServerMsg` wire unions are gone — there's no wire anymore;
the `Game` event callbacks replace them.

## Physics model (`client/src/sim/physics.ts`)

Arcade model on a Rapier dynamic rigid body (not the raycast vehicle controller):
rotations locked to yaw, engine/brake force along forward (−Z), yaw-rate steering scaled
by speed, lateral-grip impulse for arcade feel with a hint of drift. Arena = static
ground + 4 walls + `OBSTACLES`. `@dimforge/rapier3d-compat` inlines its wasm, so it runs
in the browser bundle and in Node (tests) with no extra setup.
