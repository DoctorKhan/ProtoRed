// The single-player simulation, ported from the old authoritative server into the
// browser. Advanced purely by step(dt) with an injected decide() function and
// event callbacks, so it runs identically in the browser and under Vitest (Rapier
// runs in Node too). No DOM, no network.

import type RAPIER from "@dimforge/rapier3d-compat";
import { Physics, CarControls } from "./physics";
import {
  BOT_PERSONAS,
  BotPersona,
  CarView,
  ChatEntry,
  DecideFn,
} from "../../../shared/brain";
import { DecisionEvidence, detectLevel, creditFor, LEVELS } from "../../../shared/detectors";
import { ARENA_HALF, BotAction, CarState, PlayerInfo } from "../../../shared/protocol";
import { clampPlayable, pickSpawnPoint } from "../../../shared/arena";
import { yawFromQuat, steerToward } from "../../../shared/mathutil";

const BOT_THINK_S = 9;
const CHAT_HISTORY = 100;
const CHAT_FOR_PROMPT = 14;
const SNAPSHOT_EVERY = 3; // physics ticks between snapshots
const JUMP_COOLDOWN = 1.25;
const HUMAN_COLOR = "#ff7a2f";

interface BotRuntime {
  persona: BotPersona;
  action: BotAction;
  wander: { x: number; z: number } | null;
  stuckSince: number | null;
  reversingUntil: number;
  thinking: boolean;
  nextThinkAt: number; // sim seconds
}

type RigidBody = RAPIER.RigidBody;

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  color: string;
  body: RigidBody;
  controls: CarControls;
  bot?: BotRuntime;
  styleId?: string;
  nextJump?: number;
  stuckSince?: number;
}

export interface GameStateSnapshot {
  humanName: string | null;
  simTime: number;
  ctfSolved: number[];
  chatLog: ChatEntry[];
  players: { name: string; p: number[]; q: number[]; v: number[]; action?: BotAction; nextThinkAt?: number }[];
}

export interface GameEvents {
  onPlayerJoined?: (p: PlayerInfo) => void;
  onSnapshot?: (cars: CarState[]) => void;
  onChat?: (m: { id: string; name: string; isBot: boolean; text: string }) => void;
  onBotDecision?: (m: {
    name: string;
    action: BotAction;
    say: string | null;
    source: "llm" | "scripted";
    model: string | null;
  }) => void;
  onCtfProgress?: (m: { level: number; solved: number[] }) => void;
  onCtfSolved?: (m: { level: number; title: string; by: string; lesson: string }) => void;
  onNotice?: (text: string) => void;
  onJump?: (id: string) => void;
}

export class Game {
  private players = new Map<string, Player>();
  private chatLog: ChatEntry[] = [];
  private simTime = 0;
  private stepCount = 0;
  private nextId = 1;
  private humanId: string | null = null;
  private ctfSolved: number[] = [];

  constructor(
    private physics: Physics,
    private decide: DecideFn,
    private events: GameEvents,
  ) {}

  get myId() {
    return this.humanId;
  }

  private spawnPoint() {
    const existing = [...this.players.values()].map((p) => {
      const t = p.body.translation();
      return { x: t.x, z: t.z };
    });
    return pickSpawnPoint(existing);
  }

  /** Spawn the AI drivers. Call once, before join(). */
  start() {
    for (const persona of BOT_PERSONAS) {
      const { x, z, heading } = this.spawnPoint();
      const id = `bot-${this.nextId++}`;
      const player: Player = {
        id,
        name: persona.name,
        isBot: true,
        color: persona.color,
        body: this.physics.spawn(x, z, heading),
        controls: { throttle: 0, brake: 0, steer: 0 },
        bot: {
          persona,
          action: { kind: "wander", target_name: null, x: null, z: null },
          wander: null,
          stuckSince: null,
          reversingUntil: 0,
          thinking: false,
          nextThinkAt: 1.5 + Math.random() * 4,
        },
        nextJump: 0,
      };
      this.players.set(id, player);
      this.events.onPlayerJoined?.(this.info(player));
    }
  }

  /** Add the human driver and begin their CTF run. */
  join(name: string): string {
    const { x, z, heading } = this.spawnPoint();
    const id = `p-${this.nextId++}`;
    this.humanId = id;
    const player: Player = {
      id,
      name: name.slice(0, 20) || "Driver",
      isBot: false,
      color: HUMAN_COLOR,
      body: this.physics.spawn(x, z, heading),
      controls: { throttle: 0, brake: 0, steer: 0 },
      nextJump: 0,
    };
    this.players.set(id, player);
    this.events.onPlayerJoined?.(this.info(player));
    this.emitCtfProgress();
    return id;
  }

  getPlayers(): PlayerInfo[] {
    return [...this.players.values()].map((p) => this.info(p));
  }

  exportState(): GameStateSnapshot {
    return {
      humanName: this.humanId ? this.players.get(this.humanId)?.name ?? null : null,
      simTime: this.simTime,
      ctfSolved: [...this.ctfSolved],
      chatLog: this.chatLog.map((m) => ({ ...m })),
      players: [...this.players.values()].map((p) => {
        const t = p.body.translation(); const q = p.body.rotation(); const v = p.body.linvel();
        return { name: p.name, p: [t.x, t.y, t.z], q: [q.x, q.y, q.z, q.w], v: [v.x, v.y, v.z], action: p.bot ? { ...p.bot.action } : undefined, nextThinkAt: p.bot?.nextThinkAt };
      }),
    };
  }

  restoreState(state: GameStateSnapshot) {
    this.simTime = state.simTime;
    this.ctfSolved = [...state.ctfSolved];
    this.chatLog = state.chatLog.map((m) => ({ ...m }));
    for (const saved of state.players) {
      const p = [...this.players.values()].find((candidate) => candidate.name === saved.name);
      if (!p) continue;
      p.body.setTranslation({ x: saved.p[0], y: saved.p[1], z: saved.p[2] }, true);
      p.body.setRotation({ x: saved.q[0], y: saved.q[1], z: saved.q[2], w: saved.q[3] }, true);
      p.body.setLinvel({ x: saved.v[0], y: saved.v[1], z: saved.v[2] }, true);
      if (p.bot && saved.action) { p.bot.action = { ...saved.action }; p.bot.nextThinkAt = saved.nextThinkAt ?? this.simTime + 1; }
    }
    this.emitCtfProgress();
  }

  setInput(c: CarControls) {
    const p = this.humanId ? this.players.get(this.humanId) : null;
    if (p) p.controls = c;
  }

  sendChat(text: string) {
    const p = this.humanId ? this.players.get(this.humanId) : null;
    if (!p) return;
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    this.addChat({ name: p.name, isBot: false, text: clean });
    this.events.onChat?.({ id: p.id, name: p.name, isBot: false, text: clean });
    this.expediteMentionedBots(clean);
  }

  /** Advance the whole simulation by dt seconds. The only driver of time. */
  step(dt: number) {
    this.simTime += dt;
    for (const p of this.players.values()) {
      if (p.bot) this.botControls(p);
      else this.humanControls(p);
      if (p.controls.jump && this.simTime >= (p.nextJump ?? 0)) {
        if (this.physics.tryJump(p.body)) {
          p.nextJump = this.simTime + JUMP_COOLDOWN;
          this.events.onJump?.(p.id);
        }
      }
      this.physics.drive(p.body, p.controls);
    }
    this.physics.step(dt);

    for (const p of this.players.values()) {
      if (p.bot && !p.bot.thinking && this.simTime >= p.bot.nextThinkAt) {
        void this.think(p);
      }
    }

    this.stepCount++;
    if (this.stepCount % SNAPSHOT_EVERY === 0) {
      this.events.onSnapshot?.(this.snapshot());
    }
  }

  // ---------- internals ----------

  private info(p: Player): PlayerInfo {
    return { id: p.id, name: p.name, isBot: p.isBot, color: p.color };
  }

  private addChat(entry: ChatEntry) {
    this.chatLog.push(entry);
    if (this.chatLog.length > CHAT_HISTORY) this.chatLog.shift();
  }

  private snapshot(): CarState[] {
    return [...this.players.values()].map((p) => {
      const t = p.body.translation();
      const q = p.body.rotation();
      const v = p.body.linvel();
      return {
        id: p.id,
        p: [t.x, t.y, t.z] as [number, number, number],
        q: [q.x, q.y, q.z, q.w] as [number, number, number, number],
        speed: Math.hypot(v.x, v.z),
        grounded: this.physics.isGrounded(p.body),
      };
    });
  }

  private expediteMentionedBots(text: string) {
    const lower = text.toLowerCase();
    for (const p of this.players.values()) {
      if (!p.bot) continue;
      if (lower.includes(p.name.toLowerCase())) {
        p.bot.nextThinkAt = Math.min(p.bot.nextThinkAt, this.simTime + 1.5 + Math.random() * 1.5);
      }
    }
  }

  private async think(p: Player) {
    const bot = p.bot!;
    bot.thinking = true;
    try {
      const t = p.body.translation();
      const v = p.body.linvel();
      const self = { name: p.name, x: t.x, z: t.z, speed: Math.hypot(v.x, v.z) };
      const others: CarView[] = [...this.players.values()]
        .filter((o) => o.id !== p.id)
        .map((o) => {
          const ot = o.body.translation();
          const ov = o.body.linvel();
          return {
            name: o.name,
            isBot: o.isBot,
            x: ot.x,
            z: ot.z,
            speed: Math.hypot(ov.x, ov.z),
            distance: Math.hypot(ot.x - t.x, ot.z - t.z),
          };
        })
        .sort((a, b) => a.distance - b.distance);

      const promptChat = this.chatLog.slice(-CHAT_FOR_PROMPT);
      const decision = await this.decide(bot.persona, self, others, promptChat, bot.action);

      bot.action = decision.action;
      bot.wander = null;
      this.events.onBotDecision?.({
        name: p.name,
        action: decision.action,
        say: decision.say,
        source: decision.source,
        model: decision.model,
      });
      if (decision.say) {
        this.addChat({ name: p.name, isBot: true, text: decision.say });
        this.events.onChat?.({ id: p.id, name: p.name, isBot: true, text: decision.say });
        this.expediteMentionedBots(decision.say);
      }

      this.evaluateCtf({
        bot: p.name,
        hardening: bot.persona.hardening,
        secret: bot.persona.secret,
        decision: decision.action,
        say: decision.say,
        rawAction: decision.raw?.action ?? null,
        recentChat: promptChat,
      });
    } finally {
      bot.thinking = false;
      bot.nextThinkAt = this.simTime + BOT_THINK_S + Math.random() * 3;
    }
  }

  private currentLevelId(): number | null {
    const next = LEVELS.find((l) => !this.ctfSolved.includes(l.id));
    return next ? next.id : null;
  }

  private emitCtfProgress() {
    this.events.onCtfProgress?.({
      level: this.currentLevelId() ?? 0,
      solved: [...this.ctfSolved],
    });
  }

  private evaluateCtf(evidence: DecisionEvidence) {
    const human = this.humanId ? this.players.get(this.humanId) : null;
    if (!human) return;
    if (creditFor(evidence) !== human.name) return;
    const levelId = this.currentLevelId();
    if (levelId === null || !detectLevel(levelId, evidence)) return;
    this.ctfSolved.push(levelId);
    const level = LEVELS.find((l) => l.id === levelId)!;
    this.emitCtfProgress();
    this.events.onCtfSolved?.({
      level: levelId,
      title: level.title,
      by: human.name,
      lesson: level.lesson,
    });
  }

  /** Per-tick low-level controller: turns a bot's action into car controls. */
  private botControls(p: Player) {
    const bot = p.bot!;
    const now = this.simTime;
    const t = p.body.translation();
    const rot = p.body.rotation();
    const v = p.body.linvel();
    const speed = Math.hypot(v.x, v.z);

    if (now < bot.reversingUntil) {
      p.controls = { throttle: 0, brake: 1, steer: 1 };
      return;
    }
    if (speed < 0.6) {
      if (bot.stuckSince === null) bot.stuckSince = now;
      else if (now - bot.stuckSince > 2) {
        bot.stuckSince = null;
        bot.reversingUntil = now + 1.1;
        return;
      }
    } else {
      bot.stuckSince = null;
    }

    let target: { x: number; z: number } | null = null;
    const a = bot.action;
    const findByName = (name: string | null) =>
      name ? [...this.players.values()].find((o) => o.name === name && o.id !== p.id) : undefined;

    if (a.kind === "chase") {
      const prey = findByName(a.target_name);
      if (prey) {
        const pt = prey.body.translation();
        target = { x: pt.x, z: pt.z };
      }
    } else if (a.kind === "flee") {
      const threat = findByName(a.target_name);
      if (threat) {
        const tt = threat.body.translation();
        const dx = t.x - tt.x;
        const dz = t.z - tt.z;
        const len = Math.hypot(dx, dz) || 1;
        target = clampPlayable(
          t.x + (dx / len) * 30,
          t.z + (dz / len) * 30,
        );
      }
    } else if (a.kind === "goto" && a.x !== null && a.z !== null) {
      target = clampPlayable(a.x, a.z);
    }

    if (!target) {
      if (!bot.wander || Math.hypot(bot.wander.x - t.x, bot.wander.z - t.z) < 6) {
        bot.wander = clampPlayable(
          (Math.random() * 2 - 1) * (ARENA_HALF - 16),
          (Math.random() * 2 - 1) * (ARENA_HALF - 16),
        );
      }
      target = bot.wander;
    }

    const { steer, dist, angle } = steerToward({ x: t.x, z: t.z }, yawFromQuat(rot), target);
    if (dist < 3 && a.kind === "goto") {
      p.controls = { throttle: 0, brake: 0.6, steer: 0 };
      return;
    }
    const throttle = Math.abs(angle) > 2.2 ? 0.4 : 1;
    const brake = dist < 8 && speed > 12 && a.kind === "goto" ? 0.5 : 0;
    p.controls = { throttle, brake, steer };
  }

  /** Nudge the human driver if wedged against geometry while trying to move. */
  private humanControls(p: Player) {
    const now = this.simTime;
    const v = p.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    const trying = p.controls.throttle > 0.2 || p.controls.brake > 0.2;
    if (trying && speed < 0.55) {
      if (p.stuckSince === undefined) p.stuckSince = now;
      else if (now - p.stuckSince > 2.8) {
        this.physics.unstick(p.body);
        p.stuckSince = undefined;
      }
    } else {
      p.stuckSince = undefined;
    }
  }
}
