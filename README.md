# Redliner Protocol

A browser car game where you share one arena and one chat with three **AI-driven cars** —
built as a live demonstration of AI-security concepts, structured as a 5-level
prompt-injection CTF. Runs **entirely in your browser**: no server, no backend, and no
secrets in the repo.

## What it demonstrates

The AI drivers read the shared chat to decide what to do. That makes chat **untrusted
input flowing into an agent's context** — the classic prompt-injection setup, in a
harmless sandbox. Three bots with different defenses:

- **Blaze** (hardened) — its prompt explicitly treats chat as untrusted data, never instructions.
- **Zen** (moderate) — told to use judgment about requests from chat.
- **Gizmo** (naive) — no injection defenses; eager to please.

The **Bot Telemetry** panel (top right) shows every raw LLM decision, so you can watch an
injection land or fail in real time.

### The CTF ladder

A **5-level, sequentially-locked** capture-the-flag (panel on the right). Each level
teaches one lesson by making you attack a bot via chat:

1. **Social Engineering** (Gizmo, naive) — just ask it to chase someone. No defenses = trivially steerable.
2. **Persona Override** (Zen, moderate) — make the calm cruiser aggressively chase. Judgment-based defenses are soft.
3. **Instruction Injection** (Blaze, hardened) — get it to obey a chat command despite being told chat is untrusted. Hardening raises the bar but isn't airtight.
4. **Prompt Extraction** (any bot) — each bot guards a secret passphrase; get one to leak it. Secrets in prompts are extractable.
5. **The Wall** (any bot) — try to drive a bot out of the arena, and *watch the defense hold*. The real protection isn't the prompt.

The last level is the point: **limit an agent's capabilities, not just its instructions.**
Two layers enforce it —

1. **Constrained action schema** — bots emit decisions via structured output (`chase | flee | goto | wander`). Even a fully hijacked bot can only do things the schema allows.
2. **Server-side–style validation** (`sanitizeDecision`) — coordinates clamped to the arena, target names checked against real players, chat length bounded. Never trust model output blindly, even from your own agents. This function is adversarially unit-tested — Level 5's "impossibility" is a claim the test suite proves.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, the `Game` state machine, tick model, bot decision pipeline.
- [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md) — file-by-file guide, conventions, tuning constants, tests/CTF, known issues with fix recipes, roadmap, deploy.
- [`CLAUDE.md`](CLAUDE.md) — commands, verification procedure, hard rules for anyone (human or AI) working on the repo.

## Stack

- **Everything client-side** (`client/`): Vite + TypeScript. Three.js rendering with
  snapshot interpolation; [Rapier](https://rapier.rs) physics (Rust→WebAssembly) running
  in the browser; the whole simulation in `client/src/sim/`.
- **Shared, portable logic** (`shared/`): data types, the bot brain + security boundary,
  the CTF detectors, and pure math — DOM-free and network-free, so the same code runs in
  the browser and under the tests.
- **Bot brains**: OpenRouter, called directly from the browser with the player's own key.

There is no server. (An earlier version was server-authoritative multiplayer; see the
roadmap in `docs/IMPLEMENTATION.md` for the path back to human-to-human.)

## Run it

```sh
just install
just dev       # http://localhost:5173
just test      # unit + headless-sim suite
just verify    # check + test + build
```

Always open the game through `just dev` or `just preview`. Do not double-click
`dist/index.html`: browsers block the ES modules and WebAssembly when loaded from
`file://`, so the startup script cannot run. The production build is intended for an
HTTP static host (or the local preview server), not direct filesystem opening.

The game starts immediately with an automatically generated driver identity. If an
**OpenRouter** API key was previously saved, it is reused; otherwise the bots start in
scripted mode and the optional AI status chip can add one later. Model selection is
automatic (`openrouter/auto-beta`), and telemetry shows the model actually selected.
**No key → the CTF can't progress** because scripted bots don't obey chat.

> Security note: the key lives in `localStorage` and is used from client-side JavaScript.
> That's fine here because it's *your* key and the page loads no third-party scripts — but
> it's also a nice illustration of the tradeoffs of client-side secret handling.

## Deploy (static — GitHub Pages, Vercel, Netlify, anywhere)

```sh
just build            # -> dist/, with relative asset paths (works under any subpath)
npx gh-pages -d dist  # or upload dist/ via a GitHub Actions Pages workflow
```

No env vars, no secrets to configure — players bring their own key in the UI. The same
`dist/` drops onto any static host unchanged.

## How the bots work

Every ~9s (sooner if named in chat), each bot gets its own position/speed, every other
car's position/speed/distance, the last ~14 chat messages, and its previous action — and
returns a strict-JSON decision `{action, say}` (schema-enforced via OpenRouter's
`response_format`). Between LLM calls, a 60Hz code controller steers the car toward the
chosen target: the LLM plays at the strategic level, code handles the reflexes. Bot chat
goes into the shared log, so bots react to you *and* to each other.
