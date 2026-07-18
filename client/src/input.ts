export interface Controls {
  throttle: number;
  brake: number;
  steer: number;
  handbrake?: boolean;
  jump?: boolean;
  interact?: boolean;
}

const keys = new Set<string>();
let chatOpen = false;
let steerValue = 0;
let jumpQueued = false;
let interactQueued = false;
const STEER_RESPONSE = 0.24;
const STEER_RETURN = 0.2;

export function isChatOpen() {
  return chatOpen;
}

export function setChatOpen(open: boolean) {
  chatOpen = open;
}

window.addEventListener("keydown", (e) => {
  const terminalOpen = document.getElementById("terminal-panel")?.classList.contains("open");
  const menuOpen = document.getElementById("controls-overlay")?.classList.contains("open");
  const typing =
    chatOpen ||
    terminalOpen ||
    document.activeElement === document.getElementById("chat-input");
  if (typing && e.code !== "Escape" && e.code !== "KeyE") return;
  if (e.code === "Space" && !e.repeat && !menuOpen) jumpQueued = true;
  if (e.code === "KeyE" && !e.repeat && !menuOpen) interactQueued = true;
  keys.add(e.code);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight"].includes(e.code)) {
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  steerValue = 0;
  jumpQueued = false;
  interactQueued = false;
});

export function readControls(consumeJump = true, consumeInteract = true): Controls {
  const terminalOpen = document.getElementById("terminal-panel")?.classList.contains("open");
  if (chatOpen || terminalOpen) {
    return {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      jump: false,
      interact: false,
    };
  }

  const up = keys.has("KeyW") || keys.has("ArrowUp");
  const down = keys.has("KeyS") || keys.has("ArrowDown");
  const left = keys.has("KeyA") || keys.has("ArrowLeft");
  const right = keys.has("KeyD") || keys.has("ArrowRight");
  const targetSteer = (left ? 1 : 0) - (right ? 1 : 0);
  steerValue += (targetSteer - steerValue) *
    (targetSteer === 0 ? STEER_RETURN : STEER_RESPONSE);
  if (Math.abs(steerValue) < 0.01) steerValue = 0;

  const jump = jumpQueued;
  const interact = interactQueued;
  if (consumeJump && jumpQueued) jumpQueued = false;
  if (consumeInteract && interactQueued) interactQueued = false;

  return {
    throttle: up ? 1 : 0,
    brake: down ? 1 : 0,
    steer: steerValue,
    handbrake: keys.has("ShiftLeft") || keys.has("ShiftRight"),
    jump,
    interact,
  };
}
