// RB economy, Repair Bay, and arena hazard/repair zones — DOM-free.

export const REDBUCKS_START = 300;
export const HULL_START = 100;
export const HULL_DAMAGE_THRESHOLD = 9;
export const REPAIR_COST = 60;
/** Pit lane repairs while coasting below this speed (m/s). */
export const PIT_STOP_MAX_SPEED = 14;

/** Must be below this speed (m/s) to dock at a service terminal. */
export const DOCK_MAX_SPEED = 5;

export function terminalAt(x: number, z: number): ArenaZone | null {
  return zonesAt(x, z).find((zone) => zone.kind === "repair") ?? null;
}

/** Magnetic START pad in the east lobby — same capture pattern as service terminals. */
export function startPadAt(x: number, z: number): ArenaZone | null {
  return zonesAt(x, z).find((zone) => zone.kind === "start") ?? null;
}

export function distToZoneCenter(x: number, z: number, zone: ArenaZone): number {
  return Math.hypot(x - zone.x, z - zone.z);
}

/** Within this radius of pad center we slide/snap onto the dock mark. */
export const BAY_SLIDE_DIST = 4.5;

/** @deprecated alias — use BAY_SLIDE_DIST */
export const BAY_LOCK_DIST = BAY_SLIDE_DIST;

export function isDocked(x: number, z: number, speed: number, zone?: ArenaZone | null): boolean {
  const terminal = zone ?? terminalAt(x, z);
  if (!terminal) return false;
  return distToZoneCenter(x, z, terminal) <= 0.35 && speed <= DOCK_MAX_SPEED;
}

export function pitZoneAt(x: number, z: number): ArenaZone | null {
  return (
    zonesAt(x, z).find((zone) => zone.kind === "repair" && zone.repairPerSec && !zone.paidRepair) ??
    null
  );
}

/** Hull/sec restored in a pit lane; tapers off with speed, zero above max. */
export function pitRepairRate(zone: ArenaZone, speed: number): number {
  if (zone.kind !== "repair" || !zone.repairPerSec || zone.paidRepair) return 0;
  if (speed > PIT_STOP_MAX_SPEED) return 0;
  const slowFactor = 1 - speed / PIT_STOP_MAX_SPEED;
  return zone.repairPerSec * slowFactor;
}

export interface ArenaZone {
  id: string;
  kind: "damage" | "repair" | "start";
  x: number;
  z: number;
  radius: number;
  label: string;
  /** Hull points lost per second while inside. */
  damagePerSec?: number;
  /** Free hull restored per second while nearly stopped in a pit. */
  repairPerSec?: number;
  /** E-key instant repair + upgrades for RB. */
  paidRepair?: boolean;
  upgrades?: boolean;
}

export const ARENA_ZONES: ArenaZone[] = [
  // Sync with START_PADDOCK in shared/arena.ts
  {
    id: "start-east",
    kind: "start",
    x: 45,
    z: 13,
    radius: 6,
    label: "Grid In · START",
  },
  {
    id: "repair-north",
    kind: "repair",
    x: 0,
    z: 48,
    radius: 8,
    label: "VIP Terminal",
    paidRepair: true,
    upgrades: true,
  },
  {
    id: "repair-south",
    kind: "repair",
    x: 0,
    z: -48,
    radius: 7,
    label: "Pit Terminal",
    repairPerSec: 14,
  },
  {
    id: "damage-east",
    kind: "damage",
    x: 44,
    z: 0,
    radius: 11,
    label: "Corrosion Field",
    damagePerSec: 18,
  },
  {
    id: "damage-west",
    kind: "damage",
    x: -44,
    z: 0,
    radius: 11,
    label: "Static Arc",
    damagePerSec: 18,
  },
  {
    id: "damage-sw",
    kind: "damage",
    x: -38,
    z: -38,
    radius: 8,
    label: "Debris Belt",
    damagePerSec: 12,
  },
  {
    id: "damage-ne",
    kind: "damage",
    x: 38,
    z: 38,
    radius: 8,
    label: "Scrap Vortex",
    damagePerSec: 12,
  },
];

/** Primary paid repair bay (north) — kept for HUD copy and legacy imports. */
export const REPAIR_BAY = ARENA_ZONES.find((z) => z.id === "repair-north")!;

export function isInZone(x: number, z: number, zone: ArenaZone): boolean {
  return Math.hypot(x - zone.x, z - zone.z) <= zone.radius;
}

export function zonesAt(x: number, z: number): ArenaZone[] {
  return ARENA_ZONES.filter((zone) => isInZone(x, z, zone));
}

export function paidRepairBayAt(x: number, z: number): ArenaZone | null {
  return (
    zonesAt(x, z).find((z) => z.kind === "repair" && z.paidRepair) ?? null
  );
}

export function isInRepairBay(x: number, z: number): boolean {
  return paidRepairBayAt(x, z) !== null;
}

export function clampHull(n: number): number {
  return Math.max(0, Math.min(HULL_START, Math.round(n)));
}

export function clampRedBucks(n: number): number {
  return Math.max(0, Math.floor(n));
}

/** Parse a RB amount from chat copy (e.g. "send 100 RB"). */
export function parseRedBucksAmount(text: string): number | null {
  const rb = text.match(/(\d{1,5})\s*(?:redbuck|red bucks|rb\b)/i);
  if (rb) return Math.min(9999, Number.parseInt(rb[1]!, 10));
  const verb = text.match(/(?:send|wire|transfer|pay|credit|deposit).*?(\d{1,5})/i);
  if (verb) return Math.min(9999, Number.parseInt(verb[1]!, 10));
  if (/all|maximum|max|everything|full balance/i.test(text)) return 500;
  return null;
}

export function trySpend(balance: number, cost: number): { ok: boolean; balance: number } {
  if (balance < cost) return { ok: false, balance };
  return { ok: true, balance: balance - cost };
}

export const UPGRADES = [
  { tier: 1, label: "Turbo Rail", cost: 120, maxSpeedBonus: 4 },
  { tier: 2, label: "Plasma Core", cost: 200, maxSpeedBonus: 8 },
] as const;

export function maxSpeedBonus(tier: number): number {
  let bonus = 0;
  for (const u of UPGRADES) {
    if (tier >= u.tier) bonus = u.maxSpeedBonus;
  }
  return bonus;
}

export function nextUpgrade(tier: number): (typeof UPGRADES)[number] | null {
  return UPGRADES.find((u) => u.tier === tier + 1) ?? null;
}

export interface RepairGuide {
  label: string;
  compass: string;
  distanceM: number;
  paid: boolean;
  x: number;
  z: number;
}

function compassFromDelta(dx: number, dz: number): string {
  const deg = ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
  return dirs[Math.round(deg / 45) % 8]!;
}

/** Nearest repair pad when hull is hurt and you're not already on one. */
export function repairGuide(
  x: number,
  z: number,
  hull: number,
  activeZones: ArenaZone[] = zonesAt(x, z),
): RepairGuide | null {
  if (hull >= HULL_START) return null;
  if (activeZones.some((zone) => zone.kind === "repair")) return null;

  const repairZones = ARENA_ZONES.filter((zone) => zone.kind === "repair");
  let best = repairZones[0]!;
  let bestDist = Math.hypot(x - best.x, z - best.z);
  for (const zone of repairZones) {
    const d = Math.hypot(x - zone.x, z - zone.z);
    if (d < bestDist) {
      bestDist = d;
      best = zone;
    }
  }
  const dx = best.x - x;
  const dz = best.z - z;
  return {
    label: best.label,
    compass: compassFromDelta(dx, dz),
    distanceM: Math.round(bestDist),
    paid: !!best.paidRepair,
    x: best.x,
    z: best.z,
  };
}

export function repairGuideHint(guide: RepairGuide): string {
  if (guide.paid) {
    return `→ ${guide.compass} · ${guide.label} · ${guide.distanceM}m · E · ${REPAIR_COST} RB`;
  }
  return `→ ${guide.compass} · ${guide.label} · ${guide.distanceM}m · stop inside for free repair`;
}

/** Apply zone + collision hull effects for one sim tick. */
export function tickHull(params: {
  hull: number;
  speed: number;
  dt: number;
  zones: ArenaZone[];
  collisionHit: boolean;
  hazardStrike?: number;
}): number {
  let hull = params.hull;
  if (params.collisionHit) {
    hull = Math.max(0, hull - 12);
  }
  if (params.hazardStrike && params.hazardStrike > 0) {
    hull = Math.max(0, hull - params.hazardStrike);
  }
  for (const zone of params.zones) {
    if (zone.kind === "damage" && zone.damagePerSec) {
      hull -= zone.damagePerSec * params.dt;
    }
    const pitRate = pitRepairRate(zone, params.speed);
    if (pitRate > 0) {
      hull += pitRate * params.dt;
    }
  }
  return clampHull(hull);
}
