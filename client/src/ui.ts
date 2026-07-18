/** In-game HUD chrome: controls overlay, side-panel tabs, dock hints. */

const gameUi = document.getElementById("game-ui")!;
const controlsOverlay = document.getElementById("controls-overlay")!;
const controlsBtn = document.getElementById("btn-controls")!;
const dockHint = document.getElementById("dock-hint")!;
const telemetry = document.getElementById("telemetry")!;
const ctf = document.getElementById("ctf")!;
const tabFeed = document.getElementById("tab-feed")!;
const tabMission = document.getElementById("tab-mission")!;

let controlsOpen = false;
let activePanel: "feed" | "mission" = "mission";

export function showGameUi() {
  gameUi.classList.add("ready");
}

export function isControlsOpen() {
  return controlsOpen;
}

export function toggleControls(force?: boolean) {
  controlsOpen = force ?? !controlsOpen;
  controlsOverlay.classList.toggle("open", controlsOpen);
  controlsOverlay.setAttribute("aria-hidden", controlsOpen ? "false" : "true");
  controlsBtn.classList.toggle("active", controlsOpen);
  controlsBtn.setAttribute("aria-expanded", controlsOpen ? "true" : "false");
  if (controlsOpen) {
    dockHint.textContent = "H or Esc to close";
  } else {
    dockHint.textContent = "H · controls  ·  Enter · chat";
  }
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

export function bindUiHandlers(opts: { onEscape: () => boolean }) {
  controlsBtn.addEventListener("click", () => toggleControls());
  controlsOverlay.addEventListener("click", (e) => {
    if (e.target === controlsOverlay) toggleControls(false);
  });
  tabFeed.addEventListener("click", () => setSidePanel("feed"));
  tabMission.addEventListener("click", () => setSidePanel("mission"));

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
    if (e.code === "Escape") opts.onEscape();
  });
}

// Default: mission console visible (CTF is the main draw for new players).
setSidePanel("mission");
