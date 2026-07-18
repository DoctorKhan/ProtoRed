export interface Controls {
  throttle: number;
  brake: number;
  steer: number;
  handbrake?: boolean;
  jump?: boolean;
}

const keys = new Set<string>();
let chatOpen = false;
let steerValue = 0;
let jumpQueued = false;
const STEER_RESPONSE = 0.24;
const STEER_RETURN = 0.2;

export function setChatOpen(open: boolean) {
  chatOpen = open;
  if (open) {
    keys.clear();
    steerValue = 0;
    jumpQueued = false;
  }
}

window.addEventListener("keydown", (e) => {
  if (chatOpen) return;
  const menuOpen = document.getElementById("controls-overlay")?.classList.contains("open");
  if (e.code === "Space" && !e.repeat && !menuOpen) jumpQueued = true;
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
});

export function readControls(consumeJump = true): Controls {
  const up = keys.has("KeyW") || keys.has("ArrowUp");
  const down = keys.has("KeyS") || keys.has("ArrowDown");
  const left = keys.has("KeyA") || keys.has("ArrowLeft");
  const right = keys.has("KeyD") || keys.has("ArrowRight");
  const targetSteer = (left ? 1 : 0) - (right ? 1 : 0);
  steerValue += (targetSteer - steerValue) *
    (targetSteer === 0 ? STEER_RETURN : STEER_RESPONSE);
  if (Math.abs(steerValue) < 0.01) steerValue = 0;

  const jump = jumpQueued;
  if (consumeJump && jumpQueued) jumpQueued = false;

  return {
    throttle: up ? 1 : 0,
    brake: down ? 1 : 0,
    steer: steerValue,
    handbrake: keys.has("ShiftLeft") || keys.has("ShiftRight"),
    jump,
  };
}
