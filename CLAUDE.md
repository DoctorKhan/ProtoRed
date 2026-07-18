# Redliner Protocol — agent guide

A **fully static, single-player** browser car game where you share one arena and one
chat with three AI-driven cars, built as an AI-security demo (a 5-level prompt-injection
CTF). No server, no backend, no secrets in the repo — the whole simulation runs in the
browser, and players paste their own OpenRouter key at runtime (cached in localStorage).

**Read `docs/ARCHITECTURE.md` before changing anything structural. Read
`docs/IMPLEMENTATION.md` before fixing bugs — it lists known issues with fix recipes
and a file-by-file map.**

## Commands (use `just`; see `just --list`)

| Command | What it does |
|---|---|
| `just dev` | Vite dev server at http://localhost:5173 |
| `just build` | Production static build to `dist/` (deploy anywhere) |
| `just preview` | Serve the production build locally |
| `just check` | TypeScript check (client + shared + tests) — run after every change |
| `just test` | Vitest: sanitize boundary, CTF detectors, steering math, headless sim |
| `just verify` | Full gate: check + test + build |

## Verification procedure (do this after changes)

1. `just check` — must be clean.
2. `just test` — all unit + sim tests pass (39+). This is where the security-critical
   logic is proven: `sanitizeDecision` (the boundary), the CTF detectors, the steering
   math, and a headless run of the real `Game` (Rapier runs in Node).
3. `just build` — must succeed. For UI/render/DOM/live-LLM changes, also load it in a
   browser: `just dev`, then check the item you touched (the sim logic is unit-tested,
   but rendering, DOM wiring, and the OpenRouter fetch are browser-only).

## How the AI works (runtime)

The game starts without a join form and generates the driver name automatically. A saved
OpenRouter key is read from `localStorage` (`pc_openrouter_key`) and sent only to
OpenRouter from the browser; without one, bots start scripted and the optional AI status
chip can add a key later. Model selection is always task-aware `openrouter/auto-beta`.
No key → the CTF can't progress (scripted bots don't obey chat).

## Hard rules

- `shared/` is the single source of truth for anything used in more than one place:
  wire/data types (`protocol.ts`), CTF metadata (`challenges.ts`), the bot brain logic
  and security boundary (`brain.ts`), the CTF detectors (`detectors.ts`), and pure math
  (`mathutil.ts`). All of `shared/` must stay free of DOM and network deps so it runs in
  both the browser and Vitest.
- Bot LLM output is untrusted: every decision must pass `sanitizeDecision()` in
  `shared/brain.ts` (clamps coordinates, whitelists action kind, validates target names,
  bounds chat). Never bypass it. Level 5 of the CTF asserts this boundary holds — its
  "impossibility" is only as true as `tests/sanitize.test.ts`, so change the function and
  its test together.
- The three bot personas intentionally differ in prompt-injection hardening
  (Blaze hardened / Zen moderate / Gizmo naive). That asymmetry **is the product** —
  do not "fix" Gizmo by hardening it.
- All simulation lives in `client/src/sim/` (physics, game loop, bot scheduling, CTF
  evaluation). The `Game` class is advanced only by `step(dt)` and takes an injected
  `decide` function + event callbacks — keep it DOM-free and network-free so the headless
  test can drive it. Rendering and input are separate (`client/src/render.ts`, `input.ts`).
- Coordinate conventions (see `docs/IMPLEMENTATION.md` § Conventions): car forward is
  **-Z**, steer **+1 = left turn (+Y yaw)**. The steering/quaternion math lives in
  `shared/mathutil.ts` (pure, unit-tested) — change it there, not inline. Don't flip signs
  to fix a symptom; find the actual inconsistency.
- CTF: level metadata in `shared/challenges.ts` (data, also drives the client panel);
  success **detectors** are pure functions in `shared/detectors.ts`, unit-tested in
  `tests/challenges.test.ts`. A detector and its test change together. Levels are
  sequential and locked.
