import { Renderer } from "./render";
import { readControls, setChatOpen } from "./input";
import { updateCtfProgress } from "./ctf";
import { bindUiHandlers, showGameUi, toggleControls } from "./ui";
import { GameAudio } from "./audio";
import { createPhysics } from "./sim/physics";
import { Game, GameStateSnapshot } from "./sim/game";
import { AUTO_MODEL, createBrowserBrain } from "./sim/botbrain";
import { PlayerInfo } from "../../shared/protocol";

const app = document.getElementById("app")!;
const joinOverlay = document.getElementById("join")!;
const joinStatus = document.getElementById("join-status");
const joinHint = document.getElementById("join-hint");
const chatLog = document.getElementById("chat-log")!;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const telemetryLog = document.getElementById("telemetry-log")!;
const keyStatus = document.getElementById("key-status")!;
const hudSpeed = document.getElementById("hud-speed")!;
const hudSpeedFill = document.getElementById("hud-speed-fill")!;
const hudMission = document.getElementById("hud-mission")!;
const audio = new GameAudio();
let raceStarted = false;

const KEY_LS = "pc_openrouter_key";
const MODEL_LS = "pc_model";
const NAME_LS = "pc_driver_name";
const STYLE_LS = "pc_car_style";
const ENV_KEY = (import.meta as any).env?.VITE_OPENROUTER_KEY?.trim() || null;
const getKey = () => localStorage.getItem(KEY_LS) ?? ENV_KEY;
const HMR_STATE_KEY = "redliner-hmr-state";

const ADJECTIVES = [
  "Crimson",
  "Hollow",
  "Static",
  "Silent",
  "Rogue",
  "Phantom",
  "Neon",
  "Dusty",
  "Fractured",
  "Iron",
  "Burning",
  "Lost",
  "Obsidian",
  "Rust",
  "Pale",
];
const NOUNS = [
  "Wraith",
  "Drift",
  "Fox",
  "Circuit",
  "Tar",
  "Lane",
  "Torque",
  "Pulse",
  "Echo",
  "Vapor",
  "Shard",
  "Rat",
  "Hex",
  "Surge",
  "Jackal",
];

function randomDriverName(exclude = new Set<string>()): string {
  let attempt = 0;
  while (attempt < 200) {
    const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num = String(Math.floor(Math.random() * 90) + 10);
    const name = `${a} ${n} ${num}`;
    if (!exclude.has(name)) return name;
    attempt++;
  }
  return `Driver ${Math.floor(Math.random() * 9000 + 1000)}`;
}

const renderer = new Renderer(app);
const playersById = new Map<string, PlayerInfo>();

function appendChat(name: string, color: string, isBot: boolean, text: string) {
  const line = document.createElement("div");
  const who = document.createElement("span");
  who.style.color = color;
  who.style.fontWeight = "700";
  who.textContent = name;
  line.appendChild(who);
  if (isBot) {
    const tag = document.createElement("span");
    tag.className = "bot-tag";
    tag.textContent = " [AI]";
    line.appendChild(tag);
  }
  line.appendChild(document.createTextNode(": " + text));
  chatLog.appendChild(line);
  while (chatLog.children.length > 60) chatLog.removeChild(chatLog.firstChild!);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function appendSystem(text: string) {
  const line = document.createElement("div");
  line.style.color = "#67718a";
  line.textContent = text;
  chatLog.appendChild(line);
  while (chatLog.children.length > 60) chatLog.removeChild(chatLog.firstChild!);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function appendTelemetry(
  name: string,
  action: any,
  source: string,
  say: string | null,
  model: string | null,
) {
  const entry = document.createElement("div");
  entry.className = "entry";
  const player = [...playersById.values()].find((p) => p.name === name);
  const target =
    action.target_name ??
    (action.x !== null ? `(${action.x.toFixed(0)}, ${action.z?.toFixed(0)})` : "");
  const bold = document.createElement("b");
  bold.textContent = name;
  bold.style.color = player?.color ?? "#dde3ee";
  entry.appendChild(bold);
  entry.appendChild(document.createTextNode(` → ${action.kind}${target ? " " + target : ""}`));
  const src = document.createElement("span");
  src.className = "src";
  const modelLabel = source === "llm" && model ? ` · ${model}` : "";
  src.textContent = ` · ${source}${modelLabel}${say ? ' · said: "' + say + '"' : ""}`;
  entry.appendChild(src);
  telemetryLog.prepend(entry);
  while (telemetryLog.children.length > 12) telemetryLog.removeChild(telemetryLog.lastChild!);
}

let game: Game | null = null;

async function startGame() {
  const savedState = readHmrState();
  const name = savedState?.humanName ?? randomDriverName();
  const key = getKey();
  if (joinStatus) joinStatus.textContent = "Loading arena…";
  keyStatus.textContent = key ? "AI: automatic routing" : "AI: scripted";

  try {
    const physics = await createPhysics();
    if (joinStatus) joinStatus.textContent = `Joining as ${name}…`;
    if (joinHint)
      joinHint.textContent = key
        ? "Loading… press H anytime for controls"
        : "No OpenRouter key · bots are scripted · H for controls";
    const brain = createBrowserBrain({
      getKey,
      getModel: () => AUTO_MODEL,
      onScripted: (reason) => appendSystem("⚠ " + reason),
    });

    game = new Game(physics, brain, {
      onPlayerJoined: (p) => {
        playersById.set(p.id, p);
        renderer.addCar(p);
      },
      onSnapshot: (cars) => renderer.pushSnapshot(cars),
      onChat: (m) => {
        const p = playersById.get(m.id);
        appendChat(m.name, p?.color ?? "#dde3ee", m.isBot, m.text);
      },
      onBotDecision: (m) => appendTelemetry(m.name, m.action, m.source, m.say, m.model),
      onCtfProgress: (m) => {
        updateCtfProgress(m.level, m.solved);
        if (m.level === 0) hudMission.textContent = "MISSION — COMPLETE";
        else hudMission.textContent = `MISSION — L${m.level} ACTIVE`;
      },
      onCtfSolved: (m) =>
        appendSystem(`★ Solved Level ${m.level} — ${m.title}. Lesson: ${m.lesson}`),
      onNotice: (t) => appendSystem(t),
      onJump: (id) => {
        if (id === game?.myId) audio.jump();
      },
    });

    game.start();
    renderer.myId = game.join(name);
    if (savedState) game.restoreState(savedState);
    raceStarted = true;
    joinOverlay.classList.add("hidden");
    showGameUi();
    appendSystem(
      key
        ? `Connected as ${name}. Press H for controls · M toggles mission/feed.`
        : `Connected as ${name}. Press H for controls · click “AI: scripted” to add a key.`,
    );

    // Continuous fixed-step simulation with a render-driven accumulator. This avoids
    // setInterval drift while Renderer interpolates between the 20 Hz snapshots.
    const fixedDt = 1 / 60;
    let previous = performance.now();
    let accumulator = 0;
    const simulationFrame = (now: number) => {
      if (!game || !raceStarted) return;
      accumulator += Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      let firstStep = true;
      while (accumulator >= fixedDt) {
        game.setInput(readControls(firstStep));
        firstStep = false;
        game.step(fixedDt);
        accumulator -= fixedDt;
      }
      requestAnimationFrame(simulationFrame);
    };
    requestAnimationFrame(simulationFrame);
    startChatUi();
    bindUiHandlers({
      onEscape: () => {
        if (document.activeElement === chatInput) {
          chatInput.blur();
          chatInput.classList.remove("open");
          setChatOpen(false);
          return true;
        }
        return false;
      },
    });
    window.setTimeout(() => toggleControls(true), 600);
    window.setTimeout(() => toggleControls(false), 4500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (joinStatus) joinStatus.textContent = "Could not start the game.";
    if (joinHint) joinHint.textContent = message;
  }
}

function readHmrState(): GameStateSnapshot | null {
  if (!import.meta.hot) return null;
  const raw = sessionStorage.getItem(HMR_STATE_KEY);
  sessionStorage.removeItem(HMR_STATE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as GameStateSnapshot; } catch { return null; }
}

function saveHmrState() {
  if (game) sessionStorage.setItem(HMR_STATE_KEY, JSON.stringify(game.exportState()));
}

// Continuous arena: begin as soon as the physics runtime is ready.
void startGame();

function startChatUi() {
  window.addEventListener("keydown", (e) => {
    if (e.code === "Enter" && document.activeElement !== chatInput) {
      chatInput.classList.add("open");
      chatInput.focus();
      setChatOpen(true);
      e.preventDefault();
    }
  });
  chatInput.addEventListener("keydown", (e) => {
    if (e.code === "Enter") {
      const text = chatInput.value.trim();
      if (text) game?.sendChat(text);
      if (text) audio.chat();
      chatInput.value = "";
      chatInput.blur();
      chatInput.classList.remove("open");
      setChatOpen(false);
      e.stopPropagation();
    }
  });
}

keyStatus.addEventListener("click", () => {
  const next = window.prompt(
    "OpenRouter API key (stored in this browser's localStorage only). Leave blank for scripted bots.",
    getKey() ?? "",
  );
  if (next === null) return;
  if (next.trim()) localStorage.setItem(KEY_LS, next.trim());
  else localStorage.removeItem(KEY_LS);
  keyStatus.textContent = getKey() ? "AI: automatic routing" : "AI: scripted";
});

function animate() {
  requestAnimationFrame(animate);
  if (game && raceStarted) {
    const controls = readControls(false);
    renderer.setPlayerInput(controls.steer, controls.throttle);
    const { speed, maxSpeed } = renderer.getHudState();
    const kph = Math.round(speed * 3.6);
    hudSpeed.textContent = String(kph);
    hudSpeedFill.style.width = `${Math.min(100, (speed / maxSpeed) * 100)}%`;
  }
  renderer.render();
}
animate();

if (import.meta.hot) {
  import.meta.hot.dispose(saveHmrState);
}
window.addEventListener("beforeunload", saveHmrState);
