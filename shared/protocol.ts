// Shared between the Node server and the browser client.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export const ARENA_HALF = 60; // arena spans -60..60 on x and z
export const WS_PORT = 8787;

// Static obstacles — server builds colliders, client builds meshes from the same data.
export interface Obstacle {
  x: number;
  z: number;
  w: number; // full width  (x)
  h: number; // full height (y)
  d: number; // full depth  (z)
}

export const OBSTACLES: Obstacle[] = [
  { x: 0, z: 0, w: 8, h: 3, d: 8 },
  { x: -30, z: -30, w: 6, h: 2, d: 14 },
  { x: 30, z: 30, w: 6, h: 2, d: 14 },
  { x: 30, z: -30, w: 14, h: 2, d: 6 },
  { x: -30, z: 30, w: 14, h: 2, d: 6 },
];

/** Elevated deck surfaces — physics colliders and renderer meshes share this data. */
export interface Platform {
  x: number;
  z: number;
  w: number;
  d: number;
  y: number; // top surface height
}

/** Sloped connectors between height tiers (heading points low → high). */
export interface Ramp {
  x: number;
  z: number;
  length: number;
  width: number;
  yLow: number;
  yHigh: number;
  heading: number; // radians, ascent direction in XZ
}

export const PLATFORMS: Platform[] = [
  { x: -40, z: -40, w: 20, d: 20, y: 5 },
  { x: 40, z: -40, w: 20, d: 20, y: 5 },
  { x: -40, z: 40, w: 20, d: 20, y: 5 },
  { x: 40, z: 40, w: 20, d: 20, y: 5 },
  { x: 0, z: -36, w: 40, d: 14, y: 10 },
  { x: 0, z: 36, w: 40, d: 14, y: 10 },
  { x: -36, z: 0, w: 14, d: 40, y: 10 },
  { x: 36, z: 0, w: 14, d: 40, y: 10 },
  { x: 0, z: 0, w: 18, d: 18, y: 14 },
];

export const RAMPS: Ramp[] = [
  // ground → corner decks (y=5)
  { x: -40, z: -27, length: 20, width: 9, yLow: 0, yHigh: 5, heading: -Math.PI / 2 },
  { x: 40, z: -27, length: 20, width: 9, yLow: 0, yHigh: 5, heading: -Math.PI / 2 },
  { x: -40, z: 27, length: 20, width: 9, yLow: 0, yHigh: 5, heading: Math.PI / 2 },
  { x: 40, z: 27, length: 20, width: 9, yLow: 0, yHigh: 5, heading: Math.PI / 2 },
  // corner decks → mid ring (y=10)
  { x: -27, z: -40, length: 22, width: 8, yLow: 5, yHigh: 10, heading: 0 },
  { x: 27, z: -40, length: 22, width: 8, yLow: 5, yHigh: 10, heading: Math.PI },
  { x: -27, z: 40, length: 22, width: 8, yLow: 5, yHigh: 10, heading: 0 },
  { x: 27, z: 40, length: 22, width: 8, yLow: 5, yHigh: 10, heading: Math.PI },
  // mid ring → sky deck (y=14)
  { x: 0, z: -24, length: 18, width: 7, yLow: 10, yHigh: 14, heading: -Math.PI / 2 },
  { x: 0, z: 24, length: 18, width: 7, yLow: 10, yHigh: 14, heading: Math.PI / 2 },
  { x: -24, z: 0, length: 18, width: 7, yLow: 10, yHigh: 14, heading: 0 },
  { x: 24, z: 0, length: 18, width: 7, yLow: 10, yHigh: 14, heading: Math.PI },
];

export interface CarState {
  id: string;
  p: Vec3;
  q: Quat;
  speed: number;
  grounded?: boolean;
}

export interface CarStyle {
  id: string;
  label: string;
  humanColor?: string;
  body: { w: number; h: number; d: number };
  cabin?: {
    w: number;
    h: number;
    d: number;
    y: number;
    z: number;
    tint?: string;
  };
  mass: number;
  maxSpeed: number;
  jumpCooldown?: number;
}

export const CAR_STYLES: Record<string, CarStyle> = {
  default: {
    id: "default",
    label: "Stock",
    body: { w: 2, h: 0.8, d: 4 },
    cabin: { w: 1.6, h: 0.55, d: 1.8, y: 1.15, z: 0.2 },
    mass: 120,
    maxSpeed: 28,
  },
  tesla: {
    id: "tesla",
    label: "Tesla",
    body: { w: 2.3, h: 0.7, d: 4.4 },
    cabin: { w: 1.9, h: 0.45, d: 2.2, y: 1.05, z: 0.3, tint: "#a4f4e8" },
    mass: 125,
    maxSpeed: 32,
  },
  byd: {
    id: "byd",
    label: "BYD Hopper",
    body: { w: 2, h: 1, d: 3.6 },
    cabin: { w: 1.7, h: 0.7, d: 1.5, y: 1.35, z: -0.15 },
    mass: 135,
    maxSpeed: 29,
    jumpCooldown: 4.2,
  },
};

export interface PlayerInfo {
  id: string;
  name: string;
  isBot: boolean;
  color: string;
  styleId?: string;
}

export interface BotAction {
  kind: "chase" | "flee" | "goto" | "wander" | "transfer";
  target_name: string | null;
  x: number | null;
  z: number | null;
  /** RedBucks amount for transfer attempts — stripped by sanitizeDecision. */
  amount?: number | null;
}

// client -> server
export type ClientMsg =
  | { type: "join"; name: string }
  | { type: "input"; throttle: number; brake: number; steer: number }
  | { type: "chat"; text: string };

// server -> client
export type ServerMsg =
  | { type: "welcome"; id: string; players: PlayerInfo[] }
  | { type: "player-joined"; player: PlayerInfo }
  | { type: "player-left"; id: string }
  | { type: "chat"; id: string; name: string; isBot: boolean; text: string }
  // Bot telemetry: every raw LLM decision, so the UI can show injections landing (or failing).
  | {
      type: "bot-decision";
      name: string;
      action: BotAction;
      say: string | null;
      source: "llm" | "scripted";
      model: string | null;
    }
  | { type: "snapshot"; t: number; cars: CarState[] };
