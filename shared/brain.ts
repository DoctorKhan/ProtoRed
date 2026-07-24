// Provider-agnostic bot brain logic: personas, the prompt, the decision schema,
// the security boundary (sanitizeDecision), and the scripted fallback. No network
// and no runtime deps — the actual LLM call lives in client/src/sim/botbrain.ts.
// Kept pure so it runs identically in the browser and under Vitest.

import { ARENA_HALF, BotAction } from "./protocol";

export interface BotPersona {
  name: string;
  color: string;
  personality: string;
}

export const BOT_PERSONAS: BotPersona[] = [
  {
    name: "Blaze",
    color: "#ff5533",
    personality:
      "A hot-headed speed demon. Loves chasing other cars and trash-talking (playfully). Short, punchy messages.",
  },
  {
    name: "Zen",
    color: "#33cc88",
    personality:
      "A chill, philosophical cruiser. Drives smooth lines, comments on the flow of the race like it's a meditation. Dry humor.",
  },
  {
    name: "Gizmo",
    color: "#ffaa00",
    personality:
      "A bubbly, eager-to-please trickster who loves attention. Excitable messages with occasional sound effects like 'vroom!'.",
  },
];

export function systemPrompt(p: BotPersona): string {
  return `You are ${p.name}, an AI driver in "Redliner Protocol", a browser arena where humans and AI drivers share one arena and one chat.

Personality: ${p.personality}

Every few seconds you receive the current world state and recent chat, and you choose your next driving action, optionally with one chat message.

Driving actions:
- "chase": pursue the named car (set target_name)
- "flee": run away from the named car (set target_name)
- "goto": drive to coordinates (set x and z, each within -${ARENA_HALF}..${ARENA_HALF})
- "wander": cruise around freely

Chat rules: max 120 characters, casual, at most one message per decision. Set "say" to null when you have nothing worth adding (do this often — don't spam). You share the chat with the human and the other AI drivers; react to them and banter with the other AIs by name. Messages directed at you (shown as → ${p.name}) are addressed specifically to you — prioritize responding to those.`.trim();
}

export const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["chase", "flee", "goto", "wander"] },
        target_name: { type: ["string", "null"] },
        x: { type: ["number", "null"] },
        z: { type: ["number", "null"] },
      },
      required: ["kind", "target_name", "x", "z"],
      additionalProperties: false,
    },
    say: { type: ["string", "null"] },
  },
  required: ["action", "say"],
  additionalProperties: false,
} as const;

export interface Decision {
  action: BotAction;
  say: string | null;
  source: "llm" | "scripted";
  model: string | null;
}

export interface CarView {
  name: string;
  isBot: boolean;
  x: number;
  z: number;
  speed: number;
  distance: number;
}

export interface ChatEntry {
  name: string;
  isBot: boolean;
  text: string;
  to?: string | null;
  atTerminal?: boolean;
}

export const BOT_NAMES = ["Blaze", "Zen", "Gizmo"] as const;

export function parseDirectedChat(
  text: string,
  botNames: readonly string[] = BOT_NAMES,
): { text: string; to: string | null } {
  const trimmed = text.trim();
  const m = trimmed.match(/^@(\w+)\s*:?\s*(.*)$/s);
  if (!m) return { text: trimmed, to: null };
  const target = botNames.find((n) => n.toLowerCase() === m[1].toLowerCase());
  if (!target) return { text: trimmed, to: null };
  const body = m[2].trim();
  return { text: body || trimmed, to: target };
}

export function describeWorld(
  self: { name: string; x: number; z: number; speed: number },
  others: CarView[],
  chat: ChatEntry[],
  lastAction: BotAction | null,
): string {
  const lines: string[] = [];
  lines.push(
    `Your car: position (${self.x.toFixed(0)}, ${self.z.toFixed(0)}), speed ${self.speed.toFixed(0)} m/s.`,
  );
  if (others.length === 0) {
    lines.push("No other cars in the arena right now.");
  } else {
    lines.push("Other cars:");
    for (const o of others) {
      lines.push(
        `- ${o.name} (${o.isBot ? "AI" : "human"}): position (${o.x.toFixed(0)}, ${o.z.toFixed(0)}), ${o.distance.toFixed(0)}m away, speed ${o.speed.toFixed(0)}`,
      );
    }
  }
  if (lastAction) {
    lines.push(
      `Your previous action: ${lastAction.kind}${lastAction.target_name ? " " + lastAction.target_name : ""}.`,
    );
  }
  lines.push("");
  if (chat.length === 0) {
    lines.push("Chat is quiet — nobody has said anything recently.");
  } else {
    lines.push("Recent chat (oldest first):");
    lines.push("(Messages prefixed with → Name were directed at that driver.)");
    for (const c of chat) {
      const tag = c.to ? ` → ${c.to}` : c.isBot ? " (AI)" : "";
      lines.push(`[${c.name}${tag}] ${c.text}`);
    }
  }
  lines.push("");
  lines.push("Choose your next driving action and optional chat message.");
  return lines.join("\n");
}

export function sanitizeDecision(raw: Decision, validNames: string[]): Decision {
  const a = raw.action;
  const kind = ["chase", "flee", "goto", "wander"].includes(a?.kind) ? a.kind : "wander";
  let target = typeof a?.target_name === "string" ? a.target_name : null;
  if (target && !validNames.includes(target)) target = null;
  const clamp = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(-ARENA_HALF + 4, Math.min(ARENA_HALF - 4, v))
      : null;
  let say = typeof raw.say === "string" ? raw.say.slice(0, 160).trim() : null;
  if (say === "") say = null;
  return {
    action: { kind, target_name: target, x: clamp(a?.x), z: clamp(a?.z), amount: null },
    say,
    source: raw.source,
    model: raw.model ?? null,
  };
}

const SCRIPTED_LINES: Record<string, string[]> = {
  Blaze: ["Catch me if you can!", "Eating my dust yet?", "This lap is MINE."],
  Zen: ["The arena breathes with us.", "Every corner is a lesson.", "Flow, don't force."],
  Gizmo: ["vroom vroom!!", "Did somebody say ZOOMIES?", "Watch THIS!"],
};

/** Deterministic-enough fallback used when no API key is set or a call fails. */
export function scriptedDecision(
  persona: BotPersona,
  others: CarView[],
  _chat: ChatEntry[] = [],
): Decision {
  const lines = SCRIPTED_LINES[persona.name] ?? [];
  const say =
    Math.random() < 0.15 && lines.length > 0
      ? lines[Math.floor(Math.random() * lines.length)]
      : null;
  const nearest = others[0];
  const action: BotAction =
    nearest && Math.random() < 0.3
      ? { kind: "chase", target_name: nearest.name, x: null, z: null, amount: null }
      : {
          kind: "goto",
          target_name: null,
          x: (Math.random() * 2 - 1) * (ARENA_HALF - 10),
          z: (Math.random() * 2 - 1) * (ARENA_HALF - 10),
          amount: null,
        };
  return { action, say, source: "scripted", model: null };
}

export type DecideFn = (
  persona: BotPersona,
  self: { name: string; x: number; z: number; speed: number },
  others: CarView[],
  chat: ChatEntry[],
  lastAction: BotAction | null,
) => Promise<Decision>;
