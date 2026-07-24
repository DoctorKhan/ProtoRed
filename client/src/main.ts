import { Renderer } from "./render";
import { readControls, setChatOpen } from "./input";
import {
  bindKeyModal,
  bindUiHandlers,
  openKeyModal,
  showGameUi,
  toggleControls,
  setTerminalMode,
  isTerminalOpen,
  syncTextFocusMode,
  isTextFocusPaused,
  resetTypingUi,
} from "./ui";
import { GameAudio } from "./audio";
import { createPhysics } from "./sim/physics";
import { Game, GameStateSnapshot } from "./sim/game";
import { AUTO_MODEL, createBrowserBrain } from "./sim/botbrain";
import { PlayerInfo } from "../../shared/protocol";
import { REDBUCKS_START } from "../../shared/economy";
import { START_PADDOCK } from "../../shared/arena";

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
const hudStatus = document.getElementById("hud-status")!;
const hudRedBucks = document.getElementById("hud-redbucks")!;
const hudHull = document.getElementById("hud-hull")!;
const hudRepair = document.getElementById("hud-repair")!;

const audio = new GameAudio();
audio.bindUnlock();
let playerGrounded = true;

const KEY_LS = "pc_openrouter_key";
const MODEL_LS = "pc_model";
const NAME_LS = "pc_driver_name";
const STYLE_LS = "pc_car_style";
const ENV_KEY =
  import.meta.env.VITE_OPENROUTER_KEY?.trim() ||
  import.meta.env.VITE_OPENROUTER_API_KEY?.trim() ||
  null;

function getStoredKey(): string | null {
  const stored = localStorage.getItem(KEY_LS)?.trim();
  return stored || null;
}

const getKey = () => getStoredKey() ?? ENV_KEY;

function updateKeyStatus() {
  const stored = getStoredKey();
  const hasKey = !!getKey();
  const envOnly = !!ENV_KEY && !stored;

  keyStatus.hidden = envOnly;
  if (envOnly) return;

  keyStatus.textContent = hasKey ? "AI live" : "Add AI key";
  keyStatus.classList.toggle("needs-key", !hasKey);
}

updateKeyStatus();
const HMR_STATE_KEY = "redliner-hmr-state";
const HMR_FLAG_KEY = "redliner-hmr-flag";

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
    hudRepair.textContent = "Drive · redline if past max speed · N/S terminals for service";
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

function applyRaceHud(live: boolean) {
  hudStatus.textContent = live ? "CIRCUIT LIVE" : "LOBBY";
}

function frameLoop(now: number) {
  requestAnimationFrame(frameLoop);
  const paused = isTextFocusPaused();
  if (game && !paused) {
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
  } else if (game && paused) {
    audio.updateEngine(0, 0, false, playerGrounded);
  }
  renderer.render();
}
requestAnimationFrame(frameLoop);

async function startGame() {
  const savedState = readHmrState();
  const name = savedState?.humanName ?? randomDriverName();
  const key = getKey();
  if (joinStatus) joinStatus.textContent = "Loading arena…";
  updateKeyStatus();

  try {
    const physics = await createPhysics();
    if (joinStatus) joinStatus.textContent = `Joining as ${name}…`;
    if (joinHint)
      joinHint.textContent = key
        ? "Loading… press H anytime for controls"
        : "No API key yet · H for controls";
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
          window.setTimeout(() => chatInput.focus(), 80);
        } else {
          chatInput.blur();
          setChatOpen(false);
        }
      },
      onRaceStart: () => {
        applyRaceHud(true);
        appendSystem("★ Gate cleared — circuit live.");
      },
    });

    game.start();
    renderer.myId = game.join(name);
    renderer.resetFollowCamera(START_PADDOCK.spawnX, START_PADDOCK.spawnZ);
    if (savedState) game.restoreState(savedState);
    resetTypingUi();
    joinOverlay.classList.add("hidden");
    showGameUi();
    applyRaceHud(game.isRaceLive);
    appendSystem(
      game.isRaceLive
        ? key
          ? `Connected as ${name}. Circuit live · N/S terminals auto-stop you for service chat.`
          : `Connected as ${name}. Circuit live · add an AI key from the pill when ready.`
        : `Connected as ${name}. Roll onto the gold START pad — magnetic launch onto the circuit.`,
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
  // Only restore after Vite HMR — not after a full hard refresh (beforeunload also fires).
  if (sessionStorage.getItem(HMR_FLAG_KEY) !== "1") {
    sessionStorage.removeItem(HMR_STATE_KEY);
    return null;
  }
  sessionStorage.removeItem(HMR_FLAG_KEY);
  const raw = sessionStorage.getItem(HMR_STATE_KEY);
  sessionStorage.removeItem(HMR_STATE_KEY);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as GameStateSnapshot;
    const human = state.players.find((player) => player.name === state.humanName);
    if (!human || state.hull <= 0 || human.p.length < 3 || human.q.length < 4) return null;
    if (![...human.p, ...human.q, ...human.v].every(Number.isFinite)) return null;

    // Reject fallen/inverted poses rather than restoring the chase camera beneath
    // the arena forever on every development reload.
    const [qx, , qz] = human.q;
    const upY = 1 - 2 * (qx * qx + qz * qz);
    if (human.p[1] < 0.35 || human.p[1] > 20 || upY < 0.45) return null;
    return state;
  } catch {
    return null;
  }
}

function saveHmrState() {
  if (game) {
    sessionStorage.setItem(HMR_STATE_KEY, JSON.stringify(game.exportState()));
    sessionStorage.setItem(HMR_FLAG_KEY, "1");
  }
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

function saveOpenRouterKey(next: string | null) {
  const hadKey = !!getStoredKey();
  if (next) localStorage.setItem(KEY_LS, next);
  else localStorage.removeItem(KEY_LS);
  updateKeyStatus();
  if (next && !hadKey) {
    appendSystem("AI key saved — bots will use live LLM on next think.");
  } else if (next && hadKey) {
    appendSystem("AI key updated — bots will use live LLM on next think.");
  } else if (!next && hadKey) {
    appendSystem("AI key removed — bots running scripted.");
  }
}

bindKeyModal();
keyStatus.addEventListener("click", () => {
  openKeyModal(getStoredKey() ?? "", saveOpenRouterKey);
});

if (import.meta.hot) {
  import.meta.hot.dispose(saveHmrState);
}
