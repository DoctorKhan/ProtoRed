/** In-game HUD chrome: controls overlay, side-panel tabs, dock hints, terminal panel. */

import { isChatOpen } from "./input";

const gameUi = document.getElementById("game-ui")!;
const controlsOverlay = document.getElementById("controls-overlay")!;
const controlsBtn = document.getElementById("btn-controls")!;
const dockHint = document.getElementById("dock-hint")!;
const driveHint = document.getElementById("drive-hint")!;
const terminalPanel = document.getElementById("terminal-panel")!;
const terminalTitle = document.getElementById("terminal-title")!;
const focusScrim = document.getElementById("focus-scrim")!;
const chatInput = document.getElementById("chat-input") as HTMLInputElement | null;
const telemetry = document.getElementById("telemetry")!;
const ctf = document.getElementById("ctf")!;
const tabFeed = document.getElementById("tab-feed")!;
const tabMission = document.getElementById("tab-mission")!;

let controlsOpen = false;
let terminalOpen = false;
let activePanel: "feed" | "mission" = "mission";

export function showGameUi() {
  gameUi.classList.add("ready");
}

export function isControlsOpen() {
  return controlsOpen;
}

export function isTerminalOpen() {
  return terminalOpen;
}

/** True while the 3D view is blanked and sim/render are paused for typing. */
export function isTextFocusPaused() {
  return focusScrim.classList.contains("open");
}

export function syncTextFocusMode() {
  const typing =
    terminalOpen ||
    isChatOpen() ||
    (chatInput !== null && document.activeElement === chatInput);
  focusScrim.classList.toggle("open", typing);
  focusScrim.setAttribute("aria-hidden", typing ? "false" : "true");
  document.body.classList.toggle("text-focus", typing);
  return typing;
}

export function setTerminalMode(open: boolean, label: string | null = null) {
  terminalOpen = open;
  terminalPanel.classList.toggle("open", open);
  terminalPanel.setAttribute("aria-hidden", open ? "false" : "true");
  driveHint.style.display = open ? "none" : "block";
  if (open && label) {
    terminalTitle.textContent = label.toUpperCase();
  }
  refreshDockHint();
  syncTextFocusMode();
}

function refreshDockHint() {
  if (controlsOpen) {
    dockHint.textContent = "H or Esc to close";
  } else if (terminalOpen) {
    dockHint.textContent = "E or Esc · leave terminal";
  } else {
    dockHint.textContent = "H · controls · roll into N/S terminal";
  }
}

export function toggleControls(force?: boolean) {
  controlsOpen = force ?? !controlsOpen;
  controlsOverlay.classList.toggle("open", controlsOpen);
  controlsOverlay.setAttribute("aria-hidden", controlsOpen ? "false" : "true");
  controlsBtn.classList.toggle("active", controlsOpen);
  controlsBtn.setAttribute("aria-expanded", controlsOpen ? "true" : "false");
  refreshDockHint();
}

export function setSidePanel(panel: "feed" | "mission") {
  activePanel = panel;
  telemetry.classList.toggle("hidden", panel !== "feed");
  ctf.classList.toggle("hidden", panel !== "mission");
  tabFeed.classList.toggle("active", panel === "feed");
  tabMission.classList.toggle("active", panel === "mission");
  tabFeed.setAttribute("aria-selected", panel === "feed" ? "true" : "false");
  tabMission.setAttribute("aria-selected", panel === "mission" ? "true" : "false");
}

export function bindUiHandlers(opts: {
  onEscape: () => boolean;
  onCloseTerminal?: () => void;
}) {
  controlsBtn.addEventListener("click", () => toggleControls());
  controlsOverlay.addEventListener("click", (e) => {
    if (e.target === controlsOverlay) toggleControls(false);
  });
  tabFeed.addEventListener("click", () => setSidePanel("feed"));
  tabMission.addEventListener("click", () => setSidePanel("mission"));

  document.getElementById("terminal-close")?.addEventListener("click", () => {
    opts.onCloseTerminal?.();
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyH" && document.activeElement !== document.getElementById("chat-input")) {
      toggleControls();
      e.preventDefault();
      return;
    }
    if (e.code === "KeyM" && document.activeElement !== document.getElementById("chat-input")) {
      setSidePanel(activePanel === "mission" ? "feed" : "mission");
      e.preventDefault();
      return;
    }
    if (e.code === "Escape" && controlsOpen) {
      toggleControls(false);
      e.preventDefault();
      return;
    }
    if (e.code === "Escape" && terminalOpen) {
      opts.onCloseTerminal?.();
      e.preventDefault();
      return;
    }
    if (
      e.code === "KeyE" &&
      terminalOpen &&
      document.activeElement !== document.getElementById("chat-input")
    ) {
      opts.onCloseTerminal?.();
      e.preventDefault();
      return;
    }
    if (e.code === "Escape") opts.onEscape();
  });
}

setSidePanel("mission");
