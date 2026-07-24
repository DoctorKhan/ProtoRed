/** In-game HUD chrome: controls overlay, dock hints, terminal panel. */

import { isChatOpen, setChatOpen } from "./input";

const gameUi = document.getElementById("game-ui")!;
const controlsOverlay = document.getElementById("controls-overlay")!;
const controlsBtn = document.getElementById("btn-controls")!;
const dockHint = document.getElementById("dock-hint")!;
const driveHint = document.getElementById("drive-hint")!;
const terminalPanel = document.getElementById("terminal-panel")!;
const terminalTitle = document.getElementById("terminal-title")!;
const focusScrim = document.getElementById("focus-scrim")!;
const chatInput = document.getElementById("chat-input") as HTMLInputElement | null;
const keyModal = document.getElementById("key-modal")!;
const keyModalInput = document.getElementById("key-modal-input") as HTMLInputElement;

let controlsOpen = false;
let terminalOpen = false;
let keyModalOpen = false;
let keyModalOnSave: ((key: string | null) => void) | null = null;

export function showGameUi() {
  gameUi.classList.add("ready");
}

export function isControlsOpen() {
  return controlsOpen;
}

export function isTerminalOpen() {
  return terminalOpen;
}

export function isKeyModalOpen() {
  return keyModalOpen;
}

/** True while typing in terminal/chat — pauses driving, not rendering. */
export function isTextFocusPaused() {
  return (
    keyModalOpen ||
    terminalOpen ||
    isChatOpen() ||
    (chatInput !== null && document.activeElement === chatInput)
  );
}

export function syncTextFocusMode() {
  const typing = isTextFocusPaused();
  focusScrim.classList.toggle("open", typing);
  focusScrim.setAttribute("aria-hidden", typing ? "false" : "true");
  document.body.classList.toggle("text-focus", typing);
  return typing;
}

/** Close terminal/chat overlays so the arena is visible on boot. */
export function resetTypingUi() {
  terminalOpen = false;
  terminalPanel.classList.remove("open");
  terminalPanel.setAttribute("aria-hidden", "true");
  driveHint.style.display = "block";
  setChatOpen(false);
  chatInput?.blur();
  focusScrim.classList.remove("open");
  focusScrim.setAttribute("aria-hidden", "true");
  document.body.classList.remove("text-focus");
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

export function openKeyModal(currentKey: string, onSave: (key: string | null) => void) {
  keyModalOnSave = onSave;
  keyModalOpen = true;
  keyModal.classList.add("open");
  keyModal.setAttribute("aria-hidden", "false");
  keyModalInput.value = currentKey;
  window.setTimeout(() => {
    keyModalInput.focus();
    keyModalInput.select();
  }, 0);
  syncTextFocusMode();
}

export function closeKeyModal() {
  if (!keyModalOpen) return;
  keyModalOpen = false;
  keyModalOnSave = null;
  keyModal.classList.remove("open");
  keyModal.setAttribute("aria-hidden", "true");
  keyModalInput.value = "";
  keyModalInput.blur();
  syncTextFocusMode();
}

function saveKeyModal() {
  const handler = keyModalOnSave;
  const next = keyModalInput.value.trim();
  closeKeyModal();
  handler?.(next || null);
}

export function bindKeyModal() {
  document.getElementById("key-modal-save")?.addEventListener("click", saveKeyModal);
  document.getElementById("key-modal-cancel")?.addEventListener("click", closeKeyModal);
  keyModal.addEventListener("click", (e) => {
    if (e.target === keyModal) closeKeyModal();
  });
  keyModalInput.addEventListener("keydown", (e) => {
    if (e.code === "Enter") {
      saveKeyModal();
      e.preventDefault();
    }
  });
}

export function bindUiHandlers(opts: {
  onEscape: () => boolean;
  onCloseTerminal?: () => void;
}) {
  controlsBtn.addEventListener("click", () => toggleControls());
  controlsOverlay.addEventListener("click", (e) => {
    if (e.target === controlsOverlay) toggleControls(false);
  });

  document.getElementById("terminal-close")?.addEventListener("click", () => {
    opts.onCloseTerminal?.();
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyH" && document.activeElement !== document.getElementById("chat-input")) {
      toggleControls();
      e.preventDefault();
      return;
    }
    if (e.code === "Escape" && controlsOpen) {
      toggleControls(false);
      e.preventDefault();
      return;
    }
    if (e.code === "Escape" && keyModalOpen) {
      closeKeyModal();
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
