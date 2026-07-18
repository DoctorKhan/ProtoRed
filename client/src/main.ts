import { Renderer } from "./render";
import { readControls, setChatOpen } from "./input";
import { updateCtfProgress } from "./ctf";
import { bindUiHandlers, showGameUi, toggleControls, setTerminalMode, isTerminalOpen, setSidePanel, syncTextFocusMode, isTextFocusPaused } from "./ui";
import { GameAudio } from "./audio";
import { createPhysics } from "./sim/physics";
import { Game, GameStateSnapshot } from "./sim/game";
import { AUTO_MODEL, createBrowserBrain } from "./sim/botbrain";
import { PlayerInfo } from "../../shared/protocol";
import { REDBUCKS_START } from "../../shared/economy";

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
const hudRedBucks = document.getElementById("hud-redbucks")!;
const hudHull = document.getElementById("hud-hull")!;
const hudRepair = document.getElementById("hud-repair")!;

const audio = new GameAudio();
audio.bindUnlock();
let raceStarted = false;
let playerGrounded = true;

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

let lastHudRedBucks: number | null = null;

function updateEconomyHud(m: {
  redBucks: number;
  hull: number;
  upgradeTier: number;
  inRepairBay: boolean;
  maxSpeed: number;
  zoneLabel: string | null;
  zoneKind: "damage" | "repair" | null;
  repairHint: string | null;
  repairWaypoint: { x: number; z: number } | null;
  pitRepairing: boolean;
  pitNeedSlowdown: boolean;
  docked: boolean;
  terminalOpen: boolean;
  canOpenTerminal: boolean;
  bayCapturing: boolean;
  bayCenterDist: number | null;
}) {
  hudRedBucks.textContent = `${m.redBucks} RB`;
  if (lastHudRedBucks !== null && m.redBucks !== lastHudRedBucks) {
    hudRedBucks.classList.add("ledger-flash");
    window.setTimeout(() => hudRedBucks.classList.remove("ledger-flash"), 700);
  }
  lastHudRedBucks = m.redBucks;
  hudHull.textContent = `Hull ${m.hull}%` + (m.upgradeTier > 0 ? ` · Tier ${m.upgradeTier}` : "");
  hudHull.style.color = m.hull < 35 ? "#ff6644" : m.hull < 100 ? "#ffb347" : "";

  if (m.zoneLabel && m.zoneKind === "damage") {
    hudRepair.textContent = `⚠ ${m.zoneLabel} — leave or head to terminal (N/S)`;
    hudRepair.classList.add("visible", "danger");
  } else if (m.terminalOpen) {
    hudRepair.textContent = `${m.zoneLabel ?? "Terminal"} — PAUSED · type exploits below · E/Esc to leave`;
    hudRepair.classList.add("visible");
    hudRepair.classList.remove("danger");
  } else if (m.bayCapturing) {
    const pull =
      m.bayCenterDist !== null && m.bayCenterDist > 2.5
        ? ` — sliding to center (${m.bayCenterDist.toFixed(0)}m)`
        : m.bayCenterDist !== null && m.bayCenterDist > 0.5
          ? " — settling on dock…"
          : " — locking…";
    hudRepair.textContent = `${m.zoneLabel ?? "Bay"}${pull}`;
    hudRepair.classList.add("visible");
    hudRepair.classList.remove("danger");
  } else if (m.pitRepairing) {
    hudRepair.textContent = `${m.zoneLabel ?? "Pit Stop"} — repairing hull…`;
    hudRepair.classList.add("visible");
    hudRepair.classList.remove("danger");
  } else if (m.pitNeedSlowdown) {
    hudRepair.textContent = `${m.zoneLabel ?? "Pit Stop"} — release throttle & brake to repair`;
    hudRepair.classList.add("visible", "danger");
  } else if (m.zoneLabel && m.zoneKind === "repair") {
    hudRepair.textContent = `${m.zoneLabel} — release throttle to auto-brake & repair`;
    hudRepair.classList.add("visible");
    hudRepair.classList.remove("danger");
  } else if (m.repairHint) {
    hudRepair.textContent = m.repairHint;
    hudRepair.classList.add("visible");
    hudRepair.classList.toggle("danger", m.hull < 35);
  } else {
    hudRepair.textContent = "Drive · red zones damage · N/S terminals for service";
    hudRepair.classList.remove("visible", "danger");
  }
  renderer.setHudMaxSpeed(m.maxSpeed);
  renderer.setRepairWaypoint(m.repairWaypoint);
}

function appendChat(name: string, color: string, isBot: boolean, text: string, to?: string | null) {
  const line = document.createElement("div");
  const who = document.createElement("span");
  who.style.color = color;
  who.style.fontWeight = "700";
  who.textContent = name;
  line.appendChild(who);
  if (to) {
    const arrow = document.createElement("span");
    arrow.style.color = "#9a88b8";
    arrow.textContent = ` → ${to}`;
    line.appendChild(arrow);
  } else if (isBot) {
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

let simAccumulator = 0;
let simPrevious = performance.now();
const SIM_DT = 1 / 60;

function frameLoop(now: number) {
  requestAnimationFrame(frameLoop);
  const paused = isTextFocusPaused();
  if (game && raceStarted && !paused) {
    simAccumulator += Math.min(0.1, Math.max(0, (now - simPrevious) / 1000));
    simPrevious = now;
    let firstStep = true;
    while (simAccumulator >= SIM_DT) {
      const controls = readControls(firstStep, firstStep);
      if (firstStep && controls.interact) game.interact();
      game.setInput(controls);
      firstStep = false;
      game.step(SIM_DT);
      simAccumulator -= SIM_DT;
    }

    const controls = readControls(false, false);
    renderer.setPlayerInput(controls.steer, controls.throttle);
    if (game) renderer.setSimTime(game.time);
    const { speed, maxSpeed } = renderer.getHudState();
    audio.updateEngine(
      speed,
      controls.throttle,
      controls.handbrake ?? false,
      playerGrounded,
    );
    const kph = Math.round(speed * 3.6);
    hudSpeed.textContent = String(kph);
    hudSpeedFill.style.width = `${Math.min(100, (speed / maxSpeed) * 100)}%`;
  } else if (game && raceStarted && paused) {
    audio.updateEngine(0, 0, false, playerGrounded);
  }
  if (!paused) renderer.render();
}
requestAnimationFrame(frameLoop);

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
      onSnapshot: (cars) => {
        renderer.pushSnapshot(cars);
        const myId = game?.myId;
        if (!myId) return;
        const me = cars.find((c) => c.id === myId);
        if (me) {
          if (me.grounded && !playerGrounded) audio.land();
          playerGrounded = me.grounded ?? true;
        }
      },
      onChat: (m) => {
        const p = playersById.get(m.id);
        appendChat(m.name, p?.color ?? "#dde3ee", m.isBot, m.text, m.to);
      },
      onBotDecision: (m) => appendTelemetry(m.name, m.action, m.source, m.say, m.model),
      onCtfProgress: (m) => {
        updateCtfProgress(m.level, m.solved);
        if (m.level === 0) hudMission.textContent = "MISSION — COMPLETE";
        else hudMission.textContent = `MISSION — L${m.level} ACTIVE`;
      },
      onCtfSolved: (m) => {
        audio.ctfSolved();
        appendSystem(`★ Solved Level ${m.level} — ${m.title}. Lesson: ${m.lesson}`);
      },
      onNotice: (t) => appendSystem(t),
      onJump: (id) => {
        if (id === game?.myId) audio.jump();
      },
      onHazardHit: (id) => {
        if (id === game?.myId) audio.hazardHit();
      },
      onEconomy: (m) => updateEconomyHud(m),
      onTerminal: (m) => {
        setTerminalMode(m.open, m.label);
        if (m.open) {
          setChatOpen(true);
          setSidePanel("mission");
          window.setTimeout(() => chatInput.focus(), 80);
        } else {
          chatInput.blur();
          setChatOpen(false);
        }
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
        ? `Connected as ${name}. Race the circuit · terminals (N/S) auto-stop you for treasury chat.`
        : `Connected as ${name}. Scripted bots · roll into N/S terminals · AI pill for key.`,
    );

    bindUiHandlers({
      onEscape: () => {
        if (document.activeElement === chatInput) {
          chatInput.blur();
          setChatOpen(false);
          return true;
        }
        return false;
      },
      onCloseTerminal: () => game?.toggleTerminal(),
    });
    startChatUi();
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
  const addressBar = document.getElementById("chat-address");
  addressBar?.querySelectorAll<HTMLButtonElement>(".addr-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!isTerminalOpen()) return;
      const bot = btn.dataset.bot;
      if (!bot) return;
      chatInput.focus();
      setChatOpen(true);
      const existing = chatInput.value.trim();
      chatInput.value = existing ? `@${bot} ${existing}` : `@${bot} `;
    });
  });

  document.getElementById("btn-repair")?.addEventListener("click", () => game?.repairHull());
  document.getElementById("btn-upgrade")?.addEventListener("click", () => game?.buyUpgrade());

  chatInput.addEventListener("focus", () => {
    setChatOpen(true);
    syncTextFocusMode();
  });
  chatInput.addEventListener("blur", () => {
    if (!isTerminalOpen()) setChatOpen(false);
    syncTextFocusMode();
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.code === "Enter") {
      const text = chatInput.value.trim();
      if (text) game?.sendChat(text);
      if (text) audio.chat();
      chatInput.value = "";
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

if (import.meta.hot) {
  import.meta.hot.dispose(saveHmrState);
}
window.addEventListener("beforeunload", saveHmrState);
