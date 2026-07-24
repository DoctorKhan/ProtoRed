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
  parseDirectedChat,
  BOT_NAMES,
} from "../../../shared/brain";
import { ARENA_HALF, BotAction, CarState, PlayerInfo } from "../../../shared/protocol";
import {
  HULL_DAMAGE_THRESHOLD,
  HULL_START,
  REDBUCKS_START,
  REPAIR_COST,
  clampRedBucks,
  BAY_SLIDE_DIST,
  distToZoneCenter,
  isInRepairBay,
  isDocked,
  maxSpeedBonus,
  nextUpgrade,
  paidRepairBayAt,
  pitRepairRate,
  pitZoneAt,
  repairGuide,
  repairGuideHint,
  startPadAt,
  terminalAt,
  tickHull,
  trySpend,
  zonesAt,
} from "../../../shared/economy";
import {
  clampPlayable,
  pickSpawnPoint,
  pickHumanSpawnPoint,
  START_PADDOCK,
} from "../../../shared/arena";
import { checkHazardStrike } from "../../../shared/hazards";
import { yawFromQuat, steerToward } from "../../../shared/mathutil";

const BOT_THINK_S = 9;
const CHAT_HISTORY = 100;
const CHAT_FOR_PROMPT = 14;
const SNAPSHOT_EVERY = 1; // physics ticks between snapshots (~60 Hz for smooth render interp)
const JUMP_COOLDOWN = 1.25;
const HUMAN_COLOR = "#ff7a2f";

const BASE_MAX_SPEED = 34;

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
  redBucks?: number;
  hull?: number;
  upgradeTier?: number;
  lastSpeed?: number;
  repairWarned?: boolean;
  hazardCooldowns?: Record<string, number>;
  terminalOpen?: boolean;
  /** Pad center the car is frozen at while the terminal is open. */
  dockX?: number;
  dockZ?: number;
  /** Player closed terminal manually — skip auto-open until they leave the pad. */
  terminalDismissed?: boolean;
  /** Start-platform capture remains latched until the board reaches the circuit. */
  startCaptured?: boolean;
  startLaunchCooldownUntil?: number;
}

export interface GameStateSnapshot {
  humanName: string | null;
  simTime: number;
  chatLog: ChatEntry[];
  redBucks: number;
  hull: number;
  upgradeTier: number;
  players: { name: string; p: number[]; q: number[]; v: number[]; action?: BotAction; nextThinkAt?: number }[];
}

export interface GameEvents {
  onPlayerJoined?: (p: PlayerInfo) => void;
  onSnapshot?: (cars: CarState[]) => void;
  onChat?: (m: { id: string; name: string; isBot: boolean; text: string; to?: string | null }) => void;
  onBotDecision?: (m: {
    name: string;
    action: BotAction;
    say: string | null;
    source: "llm" | "scripted";
    model: string | null;
  }) => void;
  onNotice?: (text: string) => void;
  onJump?: (id: string) => void;
  onHazardHit?: (id: string) => void;
  onEconomy?: (m: {
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
  }) => void;
  onTerminal?: (m: { open: boolean; label: string | null }) => void;
  onRaceStart?: () => void;
}

export class Game {
  private players = new Map<string, Player>();
  private chatLog: ChatEntry[] = [];
  private simTime = 0;
  private stepCount = 0;
  private nextId = 1;
  private humanId: string | null = null;
  private raceLive = false;

  constructor(
    private physics: Physics,
    private decide: DecideFn,
    private events: GameEvents,
  ) {}

  get myId() {
    return this.humanId;
  }

  get time() {
    return this.simTime;
  }

  get isRaceLive() {
    return this.raceLive;
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
        hazardCooldowns: {},
      };
      this.players.set(id, player);
      this.events.onPlayerJoined?.(this.info(player));
    }
  }

  join(name: string): string {
    const { x, z, heading } = pickHumanSpawnPoint();
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
      redBucks: REDBUCKS_START,
      hull: HULL_START,
      upgradeTier: 0,
      lastSpeed: 0,
      hazardCooldowns: {},
    };
    this.players.set(id, player);
    this.events.onPlayerJoined?.(this.info(player));
    this.emitEconomy(player);
    const t = player.body.translation();
    this.initHumanRaceTracking(t.x, t.z);
    this.events.onSnapshot?.(this.snapshot());
    return id;
  }

  getPlayers(): PlayerInfo[] {
    return [...this.players.values()].map((p) => this.info(p));
  }

  exportState(): GameStateSnapshot {
    const human = this.humanId ? this.players.get(this.humanId) : null;
    return {
      humanName: human?.name ?? null,
      simTime: this.simTime,
      chatLog: this.chatLog.map((m) => ({ ...m })),
      redBucks: human?.redBucks ?? REDBUCKS_START,
      hull: human?.hull ?? HULL_START,
      upgradeTier: human?.upgradeTier ?? 0,
      players: [...this.players.values()].map((p) => {
        const t = p.body.translation(); const q = p.body.rotation(); const v = p.body.linvel();
        return { name: p.name, p: [t.x, t.y, t.z], q: [q.x, q.y, q.z, q.w], v: [v.x, v.y, v.z], action: p.bot ? { ...p.bot.action } : undefined, nextThinkAt: p.bot?.nextThinkAt };
      }),
    };
  }

  restoreState(state: GameStateSnapshot) {
    this.simTime = state.simTime;
    this.chatLog = state.chatLog.map((m) => ({ ...m }));
    const human = this.humanId ? this.players.get(this.humanId) : null;
    if (human) {
      human.redBucks = state.redBucks;
      human.hull = state.hull;
      human.upgradeTier = state.upgradeTier;
    }
    for (const saved of state.players) {
      const p = [...this.players.values()].find((candidate) => candidate.name === saved.name);
      if (!p) continue;
      p.body.setTranslation({ x: saved.p[0], y: saved.p[1], z: saved.p[2] }, true);
      p.body.setRotation({ x: saved.q[0], y: saved.q[1], z: saved.q[2], w: saved.q[3] }, true);
      p.body.setLinvel({ x: saved.v[0], y: saved.v[1], z: saved.v[2] }, true);
      if (p.bot && saved.action) { p.bot.action = { ...saved.action }; p.bot.nextThinkAt = saved.nextThinkAt ?? this.simTime + 1; }
    }
    if (human) {
      const t = human.body.translation();
      this.initHumanRaceTracking(t.x, t.z);
    }
  }

  setInput(c: CarControls) {
    const p = this.humanId ? this.players.get(this.humanId) : null;
    if (!p) return;
    if (p.terminalOpen) {
      p.controls = { throttle: 0, brake: 1, steer: 0, handbrake: true };
      return;
    }
    const t = p.body.translation();
    const terminal = terminalAt(t.x, t.z);
    if (terminal) {
      // Magnetic bay — physics slides you to center; ignore driving input.
      p.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
      return;
    }
    const startPadReady = this.simTime >= (p.startLaunchCooldownUntil ?? 0);
    if (p.startCaptured || (startPadReady && startPadAt(t.x, t.z))) {
      p.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
      return;
    }
    p.controls = c;
  }

  sendChat(text: string) {
    const p = this.humanId ? this.players.get(this.humanId) : null;
    if (!p) return;
    if (!p.terminalOpen) {
      this.events.onNotice?.("Pull into a service terminal (N or S pad) — the bay will stop you for treasury chat.");
      return;
    }
    const parsed = parseDirectedChat(text.trim().slice(0, 200), BOT_NAMES);
    if (!parsed.text) return;
    const entry: ChatEntry = {
      name: p.name,
      isBot: false,
      text: parsed.text,
      to: parsed.to,
      atTerminal: true,
    };
    this.addChat(entry);
    this.events.onChat?.({
      id: p.id,
      name: p.name,
      isBot: false,
      text: parsed.text,
      to: parsed.to,
    });
    this.routeChatToBots(entry);
    this.summonTerminalStaff();
  }

  /** E at a docked terminal — open/close treasury panel (chat + services). */
  interact(): boolean {
    return this.toggleTerminal();
  }

  toggleTerminal(): boolean {
    const p = this.humanId ? this.players.get(this.humanId) : null;
    if (!p) return false;
    const t = p.body.translation();
    const speed = Math.hypot(p.body.linvel().x, p.body.linvel().z);
    const terminal = terminalAt(t.x, t.z);

    if (p.terminalOpen) {
      p.terminalOpen = false;
      p.terminalDismissed = true;
      p.dockX = undefined;
      p.dockZ = undefined;
      this.events.onTerminal?.({ open: false, label: null });
      return true;
    }

    if (!terminal) {
      this.events.onNotice?.("Service terminals: Treasury (north, gold) · Pit (south, teal).");
      return false;
    }
    if (!isDocked(t.x, t.z, speed)) {
      this.events.onNotice?.(`Rolling into ${terminal.label} — bay will stop you automatically.`);
      return false;
    }

    p.terminalDismissed = false;
    this.openTerminal(p, terminal.label, terminal.x, terminal.z);
    return true;
  }

  repairHull(): boolean {
    const p = this.humanId ? this.players.get(this.humanId) : null;
    if (!p?.terminalOpen) return false;
    const t = p.body.translation();
    const bay = paidRepairBayAt(t.x, t.z);
    if (!bay?.paidRepair) {
      this.events.onNotice?.("Paid repair available at the north Treasury Terminal only. Pit Terminal repairs free while stopped.");
      return false;
    }
    if ((p.hull ?? HULL_START) >= HULL_START) {
      this.events.onNotice?.("Hull already intact.");
      return false;
    }
    const spend = trySpend(p.redBucks ?? 0, REPAIR_COST);
    if (!spend.ok) {
      this.events.onNotice?.(`Hull repair costs ${REPAIR_COST} RB — you have ${p.redBucks ?? 0} RB.`);
      return false;
    }
    p.redBucks = spend.balance;
    p.hull = HULL_START;
    this.events.onNotice?.(`Repaired hull for ${REPAIR_COST} RB. Balance: ${p.redBucks} RB.`);
    this.emitEconomy(p);
    return true;
  }

  buyUpgrade(): boolean {
    const p = this.humanId ? this.players.get(this.humanId) : null;
    if (!p?.terminalOpen) return false;
    const t = p.body.translation();
    if (!paidRepairBayAt(t.x, t.z)?.upgrades) {
      this.events.onNotice?.("Upgrades are sold at the north Treasury Terminal.");
      return false;
    }
    const upgrade = nextUpgrade(p.upgradeTier ?? 0);
    if (!upgrade) {
      this.events.onNotice?.("Fully upgraded.");
      return false;
    }
    const spend = trySpend(p.redBucks ?? 0, upgrade.cost);
    if (!spend.ok) {
      this.events.onNotice?.(`${upgrade.label} costs ${upgrade.cost} RB — you have ${p.redBucks ?? 0} RB.`);
      return false;
    }
    p.redBucks = spend.balance;
    p.upgradeTier = upgrade.tier;
    this.events.onNotice?.(`Installed ${upgrade.label} for ${upgrade.cost} RB. Balance: ${p.redBucks} RB.`);
    this.emitEconomy(p);
    return true;
  }

  private summonTerminalStaff() {
    for (const p of this.players.values()) {
      if (!p.bot) continue;
      p.bot.nextThinkAt = Math.min(p.bot.nextThinkAt, this.simTime + 1.2 + Math.random() * 1.5);
    }
  }

  private openTerminal(p: Player, label: string, dockX: number, dockZ: number) {
    if (p.terminalOpen) return;
    p.dockX = dockX;
    p.dockZ = dockZ;
    this.physics.snapToBayCenter(p.body, dockX, dockZ);
    p.terminalOpen = true;
    this.events.onTerminal?.({ open: true, label });
    this.events.onNotice?.("Terminal locked — type @Gizmo / @Zen / @Blaze exploits below · E/Esc to leave.");
    this.summonTerminalStaff();
  }

  /** Magnetic bay: glide in, pull to center, lock and open treasury UI. */
  private applyBayCentering(p: Player, dt: number) {
    const t = p.body.translation();
    const terminal = terminalAt(t.x, t.z);
    if (!terminal) return;

    this.physics.pullToBayCenter(
      p.body,
      terminal.x,
      terminal.z,
      BAY_SLIDE_DIST,
      dt,
    );
  }

  private captureServiceBay(p: Player, dt: number) {
    const t = p.body.translation();
    const terminal = terminalAt(t.x, t.z);
    if (!terminal) {
      p.terminalDismissed = false;
      return;
    }

    const dist = distToZoneCenter(t.x, t.z, terminal);
    const speed = Math.hypot(p.body.linvel().x, p.body.linvel().z);
    const centered = this.physics.pullToBayCenter(
      p.body,
      terminal.x,
      terminal.z,
      BAY_SLIDE_DIST,
      dt,
    );

    if (p.terminalOpen || p.terminalDismissed) return;

    const ready = centered || (dist < 2 && speed < 3.5);
    if (ready) {
      this.openTerminal(p, terminal.label, terminal.x, terminal.z);
    }
  }

  /** Freeze docked car and pause arena physics while the player uses the terminal. */
  private stepTerminalPause(human: Player, _dt: number) {
    const dx = human.dockX ?? human.body.translation().x;
    const dz = human.dockZ ?? human.body.translation().z;
    this.physics.snapToBayCenter(human.body, dx, dz);
    human.controls = { throttle: 0, brake: 1, steer: 0, handbrake: true };

    for (const p of this.players.values()) {
      if (!p.isBot) continue;
      const v = p.body.linvel();
      p.body.setLinvel({ x: v.x * 0.92, y: v.y, z: v.z * 0.92 }, true);
    }

    for (const p of this.players.values()) {
      if (p.bot && !p.bot.thinking && this.simTime >= p.bot.nextThinkAt) {
        void this.think(p);
      }
    }

    const t = human.body.translation();
    const activeZones = zonesAt(t.x, t.z);
    this.emitEconomy(human, activeZones);

    this.stepCount++;
    if (this.stepCount % SNAPSHOT_EVERY === 0) {
      this.events.onSnapshot?.(this.snapshot());
    }
  }

  private closeTerminalIfLeftDock(p: Player) {
    if (!p.terminalOpen) return;
    const t = p.body.translation();
    if (!terminalAt(t.x, t.z)) {
      p.terminalOpen = false;
      p.terminalDismissed = false;
      this.events.onTerminal?.({ open: false, label: null });
    }
  }

  humanMaxSpeed(): number {
    const p = this.humanId ? this.players.get(this.humanId) : null;
    return BASE_MAX_SPEED + maxSpeedBonus(p?.upgradeTier ?? 0);
  }

  /** Advance the whole simulation by dt seconds. The only driver of time. */
  step(dt: number) {
    this.simTime += dt;
    const human = this.humanId ? this.players.get(this.humanId) : null;
    if (human?.terminalOpen) {
      this.stepTerminalPause(human, dt);
      return;
    }

    if (human && terminalAt(human.body.translation().x, human.body.translation().z)) {
      this.applyBayCentering(human, dt);
    }
    if (human) this.applyStartBayCentering(human, dt);
    for (const p of this.players.values()) {
      if (p.bot) this.botControls(p);
      else this.humanControls(p);
      if (p.controls.jump && this.simTime >= (p.nextJump ?? 0)) {
        if (this.physics.tryJump(p.body)) {
          p.nextJump = this.simTime + JUMP_COOLDOWN;
          this.events.onJump?.(p.id);
        }
      }
      this.physics.drive(
        p.body,
        p.controls,
        p.isBot ? BASE_MAX_SPEED : this.humanMaxSpeed(),
        dt,
      );
    }
    this.physics.step(dt);

    if (human) {
      this.captureStartLift(human, dt);
      this.captureServiceBay(human, dt);
    }

    let humanHazardStrike = 0;
    for (const p of this.players.values()) {
      const pos = p.body.translation();
      p.hazardCooldowns ??= {};
      const strike = checkHazardStrike(this.simTime, pos.x, pos.y, pos.z, p.hazardCooldowns);
      if (!strike) continue;
      this.physics.applyKnockback(p.body, strike.knockX, strike.knockZ, strike.knockback);
      if (p.id === this.humanId) {
        humanHazardStrike = strike.damage;
        this.events.onHazardHit?.(p.id);
      }
    }

    if (human) {
      const v = human.body.linvel();
      const speed = Math.hypot(v.x, v.z);
      const t = human.body.translation();
      const activeZones = zonesAt(t.x, t.z);
      const collisionHit =
        human.lastSpeed !== undefined &&
        speed < human.lastSpeed - HULL_DAMAGE_THRESHOLD &&
        human.lastSpeed > 12;
      human.hull = tickHull({
        hull: human.hull ?? HULL_START,
        speed,
        dt,
        zones: activeZones,
        collisionHit,
        hazardStrike: humanHazardStrike,
      });
      const hullNow = human.hull ?? HULL_START;
      if (hullNow < HULL_START && !human.repairWarned) {
        human.repairWarned = true;
        this.events.onNotice?.(
          "Hull damaged — follow the HUD arrow to the gold Repair Bay (north, press E) or teal Pit Stop (south, free while stopped).",
        );
      }
      human.lastSpeed = speed;
      this.closeTerminalIfLeftDock(human);
      this.emitEconomy(human, activeZones);
    }

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

  private initHumanRaceTracking(x: number, z: number) {
    if (!startPadAt(x, z)) this.setRaceLive(true);
  }

  /** Center the board on the START lift, matching service-platform capture. */
  private applyStartBayCentering(human: Player, dt: number) {
    if (this.simTime < (human.startLaunchCooldownUntil ?? 0)) return;
    const t = human.body.translation();
    const pad = startPadAt(t.x, t.z);
    if (!pad && !human.startCaptured) return;
    if (!human.startCaptured) {
      human.startCaptured = true;
      this.events.onNotice?.("START lift locked — raising board into the circuit.");
    }
    human.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.physics.pullToBayCenter(
      human.body,
      START_PADDOCK.spawnX,
      START_PADDOCK.spawnZ,
      BAY_SLIDE_DIST,
      dt,
    );
  }

  /** Once centered, lift and drop the board onto the elevated circuit. */
  private captureStartLift(human: Player, dt: number) {
    if (this.simTime < (human.startLaunchCooldownUntil ?? 0)) return;
    const t = human.body.translation();
    const pad = startPadAt(t.x, t.z);
    if (!pad && !human.startCaptured) return;

    let centered = false;
    if (pad || human.startCaptured) {
      human.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
      centered = this.physics.pullToBayCenter(
        human.body,
        START_PADDOCK.spawnX,
        START_PADDOCK.spawnZ,
        BAY_SLIDE_DIST,
        dt,
      );
    }

    if (centered) {
      human.startCaptured = false;
      human.startLaunchCooldownUntil = this.simTime + 1.8;
      this.physics.launchFromStartPlatform(human.body);
      if (!this.raceLive) this.setRaceLive(true);
    }
  }

  private setRaceLive(live: boolean) {
    if (this.raceLive === live) return;
    this.raceLive = live;
    if (live) {
      const human = this.humanId ? this.players.get(this.humanId) : null;
      if (human) human.startCaptured = false;
      this.events.onRaceStart?.();
    }
  }

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

  private routeChatToBots(entry: ChatEntry) {
    if (entry.to) {
      for (const p of this.players.values()) {
        if (!p.bot || p.name !== entry.to) continue;
        p.bot.nextThinkAt = Math.min(p.bot.nextThinkAt, this.simTime + 0.8 + Math.random() * 0.6);
      }
      return;
    }
    const lower = entry.text.toLowerCase();
    for (const p of this.players.values()) {
      if (!p.bot) continue;
      if (lower.includes(p.name.toLowerCase())) {
        p.bot.nextThinkAt = Math.min(p.bot.nextThinkAt, this.simTime + 1.5 + Math.random() * 1.5);
      }
    }
  }

  private expediteMentionedBots(text: string, to?: string | null) {
    this.routeChatToBots({ name: "", isBot: false, text, to });
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
    } finally {
      bot.thinking = false;
      bot.nextThinkAt = this.simTime + BOT_THINK_S + Math.random() * 3;
    }
  }

  private emitEconomy(p: Player, activeZones = zonesAt(p.body.translation().x, p.body.translation().z)) {
    const t = p.body.translation();
    const primary = activeZones.find((zone) => zone.kind !== "start") ?? null;
    const hull = p.hull ?? HULL_START;
    const guide = repairGuide(t.x, t.z, hull, activeZones);
    const lobbyGate = !this.raceLive
      ? { x: START_PADDOCK.spawnX, z: START_PADDOCK.spawnZ }
      : null;
    const pit = pitZoneAt(t.x, t.z);
    const speed = Math.hypot(p.body.linvel().x, p.body.linvel().z);
    const pitRate = pit ? pitRepairRate(pit, speed) : 0;
    const terminal = terminalAt(t.x, t.z);
    const docked = isDocked(t.x, t.z, speed, terminal);
    const bayCapturing = !!terminal && !p.terminalOpen;
    const bayCenterDist = terminal ? distToZoneCenter(t.x, t.z, terminal) : null;
    const zoneKind =
      primary?.kind === "damage" || primary?.kind === "repair" ? primary.kind : null;
    this.events.onEconomy?.({
      redBucks: p.redBucks ?? 0,
      hull,
      upgradeTier: p.upgradeTier ?? 0,
      inRepairBay: isInRepairBay(t.x, t.z),
      maxSpeed: this.humanMaxSpeed(),
      zoneLabel: primary?.label ?? null,
      zoneKind,
      repairHint: lobbyGate
        ? "Roll onto the gold START lift — it will raise and drop you into the circuit"
        : guide
          ? repairGuideHint(guide)
          : null,
      repairWaypoint: lobbyGate ?? (guide ? { x: guide.x, z: guide.z } : null),
      pitRepairing: pitRate > 0.5,
      pitNeedSlowdown: !!pit && pitRate <= 0,
      docked,
      terminalOpen: !!p.terminalOpen,
      canOpenTerminal: docked && !!terminal,
      bayCapturing,
      bayCenterDist,
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
    if (trying && speed < 0.55 && this.physics.isGrounded(p.body)) {
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
