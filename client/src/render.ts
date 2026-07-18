import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { ARENA_HALF, CarState, OBSTACLES, PLATFORMS, RAMPS, PlayerInfo } from "../../shared/protocol";
import { ARENA_ZONES } from "../../shared/economy";
import { ARENA_HAZARDS, ArenaHazard, hazardAngle } from "../../shared/hazards";
import { HOVER_HEIGHT } from "./sim/physics";
import { yawFromQuat, deltaYaw } from "../../shared/mathutil";

interface TrailPoint {
  x: number;
  z: number;
}

interface CarView {
  root: THREE.Group;
  bank: THREE.Group;
  plasma: THREE.Mesh;
  plasmaCore: THREE.Mesh;
  railL: THREE.Mesh;
  railR: THREE.Mesh;
  hoverRing: THREE.Mesh;
  deckStrip: THREE.Mesh;
  heroAura: THREE.Group | null;
  trailLine: THREE.Line;
  trailPoints: TrailPoint[];
  lastTrailX: number;
  lastTrailZ: number;
  lastYaw: number;
  smoothYaw: number;
  displayX: number;
  displayY: number;
  displayZ: number;
  lastSpeed: number;
  isPlayer: boolean;
}

interface Snapshot {
  recvTime: number;
  cars: Map<string, CarState>;
}

const INTERP_DELAY_MS = 120;
const BOARD_Y = 1.05;
const VISUAL_Y_OFFSET = HOVER_HEIGHT - BOARD_Y;
const MAX_SPEED = 34;
/** Chase cam: close behind the board like Mario Kart (not far chase-cam). */
const CAM_DIST_MIN = 8.5;
const CAM_DIST_MAX = 11.5;
const CAM_HEIGHT_MIN = 4.8;
const CAM_HEIGHT_MAX = 6.2;
const VOID = 0x0c0616;
const TIDE_TEAL = 0x42ffd8;
const TIDE_MAGENTA = 0xff5cab;
const TIDE_GOLD = 0xffc86b;
const TIDE_VIOLET = 0x8b6cff;
const TIDE_DIM = 0x3a2858;
const PEARL = 0xf2e6ff;

const patternTextures = new Map<string, THREE.CanvasTexture>();

function accentCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

function patternTexture(
  key: string,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  size = 256,
): THREE.CanvasTexture {
  const cached = patternTextures.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0a0414";
  ctx.fillRect(0, 0, size, size);
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  patternTextures.set(key, tex);
  return tex;
}

function drawSonarRipples(ctx: CanvasRenderingContext2D, size: number, accent: number) {
  const cx = size / 2;
  const cy = size / 2;
  const color = accentCss(accent);
  ctx.strokeStyle = color;
  for (let i = 1; i <= 9; i++) {
    ctx.globalAlpha = 0.08 + (i % 3) * 0.05;
    ctx.lineWidth = i % 2 === 0 ? 1.5 : 1;
    ctx.beginPath();
    ctx.arc(cx, cy, (size / 20) * i, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.35);
  ctx.bezierCurveTo(cx + size * 0.2, cy, cx - size * 0.15, cy + size * 0.25, cx, cy + size * 0.38);
  ctx.stroke();
}

function drawCoralHex(ctx: CanvasRenderingContext2D, size: number, accent: number) {
  const color = accentCss(accent);
  const alt = accentCss(TIDE_MAGENTA);
  const r = size / 11;
  const h = r * Math.sqrt(3);
  for (let row = -1; row < 13; row++) {
    for (let col = -1; col < 13; col++) {
      const cx = col * r * 1.5 + (row % 2 ? r * 0.75 : 0);
      const cy = row * h * 0.5;
      const filled = (row + col) % 4 === 0;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const x = cx + r * 0.88 * Math.cos(a);
        const y = cy + r * 0.88 * Math.sin(a);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      if (filled) {
        ctx.fillStyle = (row + col) % 2 === 0 ? color : alt;
        ctx.globalAlpha = 0.12;
        ctx.fill();
      }
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function drawDeckArt(ctx: CanvasRenderingContext2D, size: number, accent: number) {
  const color = accentCss(accent);
  const alt = accentCss(TIDE_VIOLET);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    const y = size * (0.28 + i * 0.22);
    ctx.moveTo(size * 0.08, y);
    ctx.bezierCurveTo(size * 0.3, y - size * 0.12, size * 0.72, y + size * 0.1, size * 0.92, y - size * 0.04);
    ctx.stroke();
  }
  ctx.strokeStyle = alt;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.52, size * 0.11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.52, size * 0.04, 0, Math.PI * 2);
  ctx.fill();
}

function drawRibVeins(ctx: CanvasRenderingContext2D, size: number, accent: number) {
  const color = accentCss(accent);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    const x = size * (0.12 + i * 0.18);
    ctx.globalAlpha = 0.2 + (i % 2) * 0.12;
    ctx.beginPath();
    ctx.moveTo(x, size * 0.05);
    ctx.bezierCurveTo(x + size * 0.04, size * 0.35, x - size * 0.05, size * 0.65, x + size * 0.02, size * 0.95);
    ctx.stroke();
  }
}

type PatternKind = "sonar" | "coral" | "deck" | "veins";

function surfaceMaterial(
  kind: PatternKind,
  repeatX: number,
  repeatY: number,
  accent = TIDE_TEAL,
  intensity = 0.32,
): THREE.MeshStandardMaterial {
  const key = `${kind}-${accent}`;
  const baseTex = patternTexture(key, (ctx, size) => {
    if (kind === "sonar") drawSonarRipples(ctx, size, accent);
    else if (kind === "coral") drawCoralHex(ctx, size, accent);
    else if (kind === "deck") drawDeckArt(ctx, size, accent);
    else drawRibVeins(ctx, size, accent);
  });
  const tex = baseTex.clone();
  tex.repeat.set(repeatX, repeatY);
  return new THREE.MeshStandardMaterial({
    color: 0x120a1c,
    map: tex,
    emissiveMap: tex,
    emissive: accent,
    emissiveIntensity: intensity,
    roughness: 0.22,
    metalness: 0.72,
  });
}

function structureMaterial(accent = TIDE_VIOLET): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x140818,
    roughness: 0.14,
    metalness: 0.62,
    emissive: accent,
    emissiveIntensity: 0.14,
    clearcoat: 0.85,
    clearcoatRoughness: 0.18,
  });
}

function addFaceDecal(
  group: THREE.Group,
  w: number,
  h: number,
  d: number,
  accent = TIDE_TEAL,
) {
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.94, d * 0.94),
    surfaceMaterial("coral", Math.max(1, w / 3), Math.max(1, d / 3), accent, 0.34),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = h / 2 + 0.01;
  group.add(top);

  const mkSide = (rotY: number, px: number, pz: number, sw: number, sh: number) => {
    const side = new THREE.Mesh(
      new THREE.PlaneGeometry(sw * 0.94, sh * 0.94),
      surfaceMaterial("veins", Math.max(1, sw / 2), Math.max(1, sh / 2), accent, 0.24),
    );
    side.rotation.y = rotY;
    side.position.set(px, 0, pz);
    group.add(side);
  };
  mkSide(0, 0, -d / 2 - 0.01, w, h);
  mkSide(Math.PI, 0, d / 2 + 0.01, w, h);
  mkSide(Math.PI / 2, w / 2 + 0.01, 0, d, h);
  mkSide(-Math.PI / 2, -w / 2 - 0.01, 0, d, h);
}

function addTopSpirals(group: THREE.Group, w: number, d: number, y: number, accent: number) {
  const verts: number[] = [];
  const segs = 24;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const ang = t * Math.PI * 3;
    const rad = (0.12 + t * 0.38) * Math.min(w, d);
    verts.push(Math.cos(ang) * rad, y, Math.sin(ang) * rad, Math.cos(ang + 0.4) * rad * 0.92, y, Math.sin(ang + 0.4) * rad * 0.92);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  group.add(
    new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.38 }),
    ),
  );
}

function makeLabel(text: string, color: string): THREE.Sprite {
  const font = "bold 34px ui-monospace, Menlo, monospace";
  const padX = 28;
  const canvasH = 64;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const textW = measure.measureText(text).width;
  const canvasW = Math.ceil(textW + padX * 2);

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.fillStyle = color;
  ctx.fillText(text, canvasW / 2, canvasH / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  const worldW = 6 * (canvasW / 256);
  sprite.scale.set(worldW, 0.9, 1);
  sprite.position.set(0, 1.35, 0);
  sprite.renderOrder = 1001;
  (sprite.material as THREE.SpriteMaterial).depthTest = false;
  return sprite;
}

function yawQuat(yaw: number, target: THREE.Quaternion) {
  target.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
}

function makeAuroraBackdrop(): THREE.Group {
  const group = new THREE.Group();
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 512, 256);
  grad.addColorStop(0, "rgba(66, 255, 216, 0)");
  grad.addColorStop(0.35, "rgba(66, 255, 216, 0.35)");
  grad.addColorStop(0.55, "rgba(255, 92, 171, 0.45)");
  grad.addColorStop(0.75, "rgba(139, 108, 255, 0.25)");
  grad.addColorStop(1, "rgba(12, 6, 22, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 5; i++) {
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(220, 55 + i * 8), mat.clone());
    sheet.position.set((i - 2) * 28, 22 + i * 3, -ARENA_HALF + 8 - i * 4);
    sheet.rotation.y = (i - 2) * 0.22;
    sheet.rotation.x = -0.08;
    group.add(sheet);
  }
  return group;
}

function makeFloatingMotes(): THREE.Group {
  const group = new THREE.Group();
  const colors = [TIDE_TEAL, TIDE_MAGENTA, TIDE_GOLD, TIDE_VIOLET];
  const geo = new THREE.SphereGeometry(0.12, 6, 6);
  for (let i = 0; i < 48; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: colors[i % colors.length],
      transparent: true,
      opacity: 0.35 + (i % 3) * 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mote = new THREE.Mesh(geo, mat);
    mote.position.set(
      (Math.random() - 0.5) * ARENA_HALF * 1.6,
      3 + Math.random() * 14,
      (Math.random() - 0.5) * ARENA_HALF * 1.6,
    );
    mote.scale.setScalar(0.6 + Math.random() * 1.4);
    group.add(mote);
  }
  return group;
}

function wireframeShell(geometry: THREE.BufferGeometry, color: number, opacity = 0.92): THREE.LineSegments {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

function glowMaterial(
  color: number,
  intensity: number,
  opts?: { transparent?: boolean; opacity?: number },
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.04,
    metalness: 0.12,
    transparent: opts?.transparent ?? false,
    opacity: opts?.opacity ?? 1,
    depthWrite: !(opts?.transparent ?? false),
    blending: opts?.transparent ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: opts?.transparent ? THREE.DoubleSide : THREE.FrontSide,
  });
}

function buildHoverboard(bank: THREE.Group, player: PlayerInfo) {
  const color = new THREE.Color(player.color);
  const glow = color.getHex();
  const accent2 = color.clone().lerp(new THREE.Color(TIDE_MAGENTA), 0.42).getHex();
  const hero = !player.isBot;

  const shellMat = new THREE.MeshPhysicalMaterial({
    color: 0x120a1e,
    metalness: 0.42,
    roughness: 0.16,
    emissive: glow,
    emissiveIntensity: hero ? 0.42 : 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });

  const pod = new THREE.Mesh(new THREE.SphereGeometry(0.52, 16, 12), shellMat);
  pod.scale.set(1.38, 0.34, 1.95);
  pod.position.set(0, 0.06, 0.06);
  bank.add(pod);

  for (const side of [-1, 1] as const) {
    const wing = new THREE.Mesh(
      new RoundedBoxGeometry(1.48, 0.042, 2.72, 10, 0.32),
      shellMat,
    );
    wing.position.set(side * 0.84, 0.038, 0.1);
    wing.rotation.set(0.05, side * 0.34, side * -0.1);
    bank.add(wing);

    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 8),
      glowMaterial(accent2, hero ? 2.6 : 1.5),
    );
    tip.position.set(side * 1.58, 0.048, 0.72);
    bank.add(tip);
  }

  const crest = new THREE.Mesh(
    new THREE.ConeGeometry(0.11, 0.38, 8),
    glowMaterial(glow, hero ? 2.0 : 1.2),
  );
  crest.position.set(0, 0.11, -1.88);
  crest.rotation.x = -Math.PI / 2 - 0.25;
  bank.add(crest);

  const deckArt = new THREE.Mesh(
    new THREE.PlaneGeometry(2.55, 3.35),
    surfaceMaterial("deck", 1.1, 1.5, glow, hero ? 0.3 : 0.18),
  );
  deckArt.rotation.x = -Math.PI / 2;
  deckArt.position.set(0, 0.092, 0.08);
  bank.add(deckArt);

  const railL = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 3.25, 6),
    glowMaterial(glow, hero ? 2.0 : 1.25),
  );
  railL.rotation.x = Math.PI / 2;
  railL.position.set(-1.08, 0.062, 0.08);
  bank.add(railL);

  const railR = railL.clone();
  railR.position.x = 1.08;
  bank.add(railR);

  const deckStrip = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 10, 8),
    glowMaterial(PEARL, hero ? 1.3 : 0.75, { transparent: true, opacity: 0.82 }),
  );
  deckStrip.position.set(0, 0.098, -0.15);
  bank.add(deckStrip);

  for (const side of [-1, 1] as const) {
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.038, 1.15, 6, 1, true),
      glowMaterial(accent2, hero ? 1.5 : 0.9, { transparent: true, opacity: 0.5 }),
    );
    tail.position.set(side * 0.32, 0.028, 1.98);
    tail.rotation.x = Math.PI / 2 + 0.18;
    bank.add(tail);
  }

  const hoverRing = new THREE.Mesh(
    new THREE.RingGeometry(0.48, 1.38, 52),
    new THREE.MeshBasicMaterial({
      color: accent2,
      transparent: true,
      opacity: hero ? 0.44 : 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  hoverRing.rotation.x = -Math.PI / 2;
  hoverRing.position.y = -0.048;
  bank.add(hoverRing);

  const hoverCore = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 32),
    new THREE.MeshBasicMaterial({
      color: glow,
      transparent: true,
      opacity: hero ? 0.32 : 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  hoverCore.rotation.x = -Math.PI / 2;
  hoverCore.position.y = -0.042;
  bank.add(hoverCore);

  const plasmaCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 10, 10),
    glowMaterial(accent2, 3.6, { transparent: true, opacity: 0.9 }),
  );
  plasmaCore.position.set(0, 0.03, 2.05);
  plasmaCore.visible = false;
  bank.add(plasmaCore);

  const plasma = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 1.0, 14, 1, true),
    glowMaterial(glow, 2.8, { transparent: true, opacity: 0.68 }),
  );
  plasma.position.set(0, 0.03, 2.1);
  plasma.rotation.x = Math.PI;
  plasma.visible = false;
  bank.add(plasma);

  bank.add(makeLabel(player.name + (player.isBot ? " ✦" : ""), player.color));

  let heroAura: THREE.Group | null = null;
  if (hero) {
    const auraGeo = new THREE.IcosahedronGeometry(2.25, 2);
    heroAura = new THREE.Group();
    heroAura.position.y = 0.14;

    const veil = new THREE.Mesh(
      auraGeo,
      new THREE.MeshBasicMaterial({
        color: glow,
        transparent: true,
        opacity: 0.035,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      }),
    );
    veil.renderOrder = 997;

    const edges = wireframeShell(auraGeo, glow, 0.12);
    edges.renderOrder = 998;
    const edgeMat = edges.material as THREE.LineBasicMaterial;
    edgeMat.depthTest = false;
    edgeMat.transparent = true;
    edgeMat.opacity = 0.14;
    edgeMat.blending = THREE.AdditiveBlending;

    heroAura.add(veil, edges);
    bank.add(heroAura);
  }

  return { railL, railR, hoverRing, deckStrip, plasma, plasmaCore, heroAura, isPlayer: hero };
}

function buildCrystalObstacle(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  const radius = Math.min(w, d) * 0.48;
  const geo = new THREE.CylinderGeometry(radius * 0.82, radius * 1.1, h, 7);
  group.add(new THREE.Mesh(geo, structureMaterial(TIDE_MAGENTA)));

  const bands = [TIDE_TEAL, TIDE_MAGENTA, TIDE_GOLD, TIDE_VIOLET];
  for (let i = 0; i < 4; i++) {
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.04, 0.045, 6, 28),
      glowMaterial(bands[i % bands.length], 1.15, { transparent: true, opacity: 0.72 }),
    );
    torus.rotation.x = Math.PI / 2;
    torus.position.y = -h / 2 + (i + 1) * (h / 5);
    group.add(torus);
  }

  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 0.72, h * 0.2, 7),
    glowMaterial(TIDE_TEAL, 0.95),
  );
  tip.position.y = h / 2 + h * 0.09;
  group.add(tip);

  addTopSpirals(group, w, d, h / 2 + 0.03, TIDE_GOLD);
  return group;
}

function makeTrailLine(color: number): THREE.Line {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
  const accent = new THREE.Color(color).lerp(new THREE.Color(TIDE_MAGENTA), 0.35).getHex();
  return new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      linewidth: 2,
    }),
  );
}

function buildArenaHazard(h: ArenaHazard): THREE.Group {
  const pivotY = (h.yLow + h.yHigh) / 2;
  const group = new THREE.Group();
  group.position.set(h.x, pivotY, h.z);

  const hazardRed = 0xff3344;
  const hazardCore = 0xff8866;
  const armMat = new THREE.MeshStandardMaterial({
    color: hazardRed,
    emissive: hazardRed,
    emissiveIntensity: 1.4,
    metalness: 0.35,
    roughness: 0.4,
  });
  const tipMat = new THREE.MeshBasicMaterial({
    color: hazardCore,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pivot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.75, h.yHigh - h.yLow, 10),
    new THREE.MeshStandardMaterial({
      color: TIDE_DIM,
      emissive: hazardRed,
      emissiveIntensity: 0.55,
      metalness: 0.5,
      roughness: 0.55,
    }),
  );
  group.add(pivot);

  const armGroup = new THREE.Group();
  const count = h.armCount ?? 1;
  for (let i = 0; i < count; i++) {
    const arm = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(h.armLength, 0.32, h.armHalfWidth * 2),
      armMat,
    );
    beam.position.x = h.armLength / 2;
    arm.add(beam);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 10), tipMat);
    tip.position.set(h.armLength - 0.2, 0, 0);
    arm.add(tip);
    arm.rotation.y = (i * Math.PI) / Math.max(1, count === 2 ? 2 : count);
    armGroup.add(arm);
  }
  group.add(armGroup);

  const floorY = h.yLow - pivotY - 0.02;
  const warn = new THREE.Mesh(
    new THREE.RingGeometry(1.4, 2.2, 24),
    new THREE.MeshBasicMaterial({
      color: hazardRed,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  warn.rotation.x = -Math.PI / 2;
  warn.position.y = floorY;
  group.add(warn);

  const sweep = new THREE.Mesh(
    new THREE.RingGeometry(h.armLength - 0.6, h.armLength + 0.15, 48),
    new THREE.MeshBasicMaterial({
      color: hazardRed,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  sweep.rotation.x = -Math.PI / 2;
  sweep.position.y = floorY + 0.02;
  group.add(sweep);

  group.userData.hazard = h;
  group.userData.armGroup = armGroup;
  group.userData.warn = warn;
  group.userData.sweep = sweep;
  return group;
}

export interface HudState {
  speed: number;
  maxSpeed: number;
}

export class Renderer {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private cars = new Map<string, CarView>();
  private snapshots: Snapshot[] = [];
  private cameraBlockers: THREE.Object3D[] = [];
  private cameraRay = new THREE.Raycaster();
  private tmpCamDesired = new THREE.Vector3();
  private tmpCamFocus = new THREE.Vector3();
  private tmpCamDir = new THREE.Vector3();
  private lookTarget = new THREE.Vector3();
  private smoothCamPull = CAM_DIST_MIN;
  private cameraInitialized = false;
  private playerSteer = 0;
  private playerSpeed = 0;
  private playerYawRate = 0;
  private lastFrameMs = performance.now();
  private hudMaxSpeed = MAX_SPEED;
  private repairMarker = new THREE.Group();
  private hazardMeshes: THREE.Group[] = [];
  private simTime = 0;
  myId: string | null = null;

  constructor(container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(
      64,
      window.innerWidth / window.innerHeight,
      0.1,
      500,
    );
    this.camera.position.set(0, 40, 70);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(VOID);
    this.scene.fog = new THREE.FogExp2(0x180828, 0.0022);

    const trackStatic = (obj: THREE.Object3D) => {
      this.scene.add(obj);
    };
    const trackCameraBlocker = (obj: THREE.Object3D) => {
      this.scene.add(obj);
      this.cameraBlockers.push(obj);
    };

    const fill = new THREE.HemisphereLight(0x4a1868, 0x06010c, 0.55);
    this.scene.add(fill);
    const key = new THREE.DirectionalLight(0xffb8e8, 0.35);
    key.position.set(-25, 45, 18);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x42ffd8, 0.22);
    rim.position.set(30, 20, -25);
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
      surfaceMaterial("sonar", ARENA_HALF / 2.5, ARENA_HALF / 2.5, TIDE_TEAL, 0.26),
    );
    ground.rotation.x = -Math.PI / 2;
    trackStatic(ground);
    this.scene.add(makeAuroraBackdrop());
    this.scene.add(makeFloatingMotes());
    this.scene.add(makeFloatingMotes());

    const mkWall = (x: number, z: number, w: number, d: number) => {
      const geo = new THREE.BoxGeometry(w, 4, d);
      const shell = new THREE.Group();
      shell.add(new THREE.Mesh(geo, structureMaterial(TIDE_VIOLET)));
      addFaceDecal(shell, w, 4, d, TIDE_GOLD);
      shell.position.set(x, 2, z);
      trackCameraBlocker(shell);
    };
    mkWall(0, -ARENA_HALF - 1, ARENA_HALF * 2 + 4, 2);
    mkWall(0, ARENA_HALF + 1, ARENA_HALF * 2 + 4, 2);
    mkWall(-ARENA_HALF - 1, 0, 2, ARENA_HALF * 2 + 4);
    mkWall(ARENA_HALF + 1, 0, 2, ARENA_HALF * 2 + 4);

    for (const o of OBSTACLES) {
      const obs = buildCrystalObstacle(o.w, o.h, o.d);
      obs.position.set(o.x, o.h / 2, o.z);
      trackCameraBlocker(obs);
    }

    const padMat = structureMaterial(TIDE_TEAL);
    for (const p of PLATFORMS) {
      const radius = Math.min(p.w, p.d) * 0.45;
      const deckGroup = new THREE.Group();
      deckGroup.add(
        new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.9, radius * 1.05, 0.36, 8), padMat),
      );
      const top = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 0.86, 8),
        surfaceMaterial("coral", 2.2, 2.2, TIDE_MAGENTA, 0.38),
      );
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.19;
      deckGroup.add(top);
      addTopSpirals(deckGroup, p.w, p.d, 0.21, TIDE_GOLD);
      deckGroup.position.set(p.x, p.y - 0.15, p.z);
      trackStatic(deckGroup);

      const pillarH = Math.max(0.5, p.y - 0.35);
      if (pillarH > 0.8) {
        const mkRoot = (px: number, pz: number) => {
          const rootVerts: number[] = [];
          for (let i = 0; i <= 6; i++) {
            const t = i / 6;
            rootVerts.push(px, pillarH * (1 - t), pz, px + Math.sin(t * 4) * 0.15, pillarH * (1 - t) - 0.2, pz + Math.cos(t * 3) * 0.12);
          }
          const rootGeo = new THREE.BufferGeometry();
          rootGeo.setAttribute("position", new THREE.Float32BufferAttribute(rootVerts, 3));
          const roots = new THREE.LineSegments(
            rootGeo,
            new THREE.LineBasicMaterial({ color: TIDE_VIOLET, transparent: true, opacity: 0.45 }),
          );
          trackStatic(roots);
        };
        mkRoot(p.x - p.w / 2 + 1.2, p.z - p.d / 2 + 1.2);
        mkRoot(p.x + p.w / 2 - 1.2, p.z - p.d / 2 + 1.2);
        mkRoot(p.x - p.w / 2 + 1.2, p.z + p.d / 2 - 1.2);
        mkRoot(p.x + p.w / 2 - 1.2, p.z + p.d / 2 - 1.2);
      }
    }

    const rampMat = structureMaterial(TIDE_MAGENTA);
    for (const r of RAMPS) {
      const pitch = Math.atan2(r.yHigh - r.yLow, r.length);
      const geo = new THREE.BoxGeometry(r.width, 0.28, r.length);
      const rampGroup = new THREE.Group();
      rampGroup.add(new THREE.Mesh(geo, rampMat));
      addFaceDecal(rampGroup, r.width, 0.28, r.length, TIDE_GOLD);
      rampGroup.position.set(r.x, (r.yLow + r.yHigh) / 2, r.z);
      rampGroup.rotation.order = "YXZ";
      rampGroup.rotation.y = r.heading;
      rampGroup.rotation.x = pitch;
      trackStatic(rampGroup);
    }

    for (const zone of ARENA_ZONES) {
      const zR = zone.radius;
      const group = new THREE.Group();
      const isDamage = zone.kind === "damage";
      const accent = isDamage ? 0xff4422 : zone.paidRepair ? TIDE_GOLD : TIDE_TEAL;
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(zR * 0.92, zR, 0.1, 32),
        surfaceMaterial("coral", 3.2, 3.2, accent, isDamage ? 0.42 : 0.5),
      );
      pad.position.y = 0.06;
      group.add(pad);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(zR * 0.7, zR * 0.94, 32),
        new THREE.MeshBasicMaterial({
          color: accent,
          transparent: true,
          opacity: isDamage ? 0.35 : 0.45,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.13;
      group.add(ring);
      if (!isDamage) {
        const beacon = new THREE.PointLight(accent, 0.9, zR * 2, 2);
        beacon.position.y = 2.2;
        group.add(beacon);
        const labelColor = zone.paidRepair ? "#ffcc55" : "#55eedd";
        const labelText = zone.paidRepair ? "Repair Bay · E" : "Pit Stop · free";
        const label = makeLabel(labelText, labelColor);
        label.position.set(0, 4.5, 0);
        label.scale.multiplyScalar(1.1);
        group.add(label);
        const column = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.28, 10, 8, 1, true),
          new THREE.MeshBasicMaterial({
            color: accent,
            transparent: true,
            opacity: 0.28,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        column.position.y = 5;
        group.add(column);
      } else {
        const warn = makeLabel(`⚠ ${zone.label}`, "#ff6644");
        warn.position.set(0, 3.8, 0);
        warn.scale.multiplyScalar(0.95);
        group.add(warn);
      }
      group.position.set(zone.x, 0, zone.z);
      trackStatic(group);
    }

    for (const h of ARENA_HAZARDS) {
      const hazard = buildArenaHazard(h);
      trackStatic(hazard);
      this.hazardMeshes.push(hazard);
    }

    const markerBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.45, 22, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: TIDE_GOLD,
        transparent: true,
        opacity: 0.38,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    markerBeam.position.y = 11;
    markerBeam.name = "repair-beam";
    this.repairMarker.add(markerBeam);
    const markerRing = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 2.4, 32),
      new THREE.MeshBasicMaterial({
        color: TIDE_GOLD,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    markerRing.rotation.x = -Math.PI / 2;
    markerRing.position.y = 0.14;
    markerRing.name = "repair-ring";
    this.repairMarker.add(markerRing);
    this.repairMarker.visible = false;
    this.scene.add(this.repairMarker);

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setPlayerInput(steer: number, _throttle: number) {
    this.playerSteer = steer;
  }

  setSimTime(t: number) {
    this.simTime = t;
  }

  setHudMaxSpeed(maxSpeed: number) {
    this.hudMaxSpeed = maxSpeed;
  }

  /** Highlight the nearest repair pad when hull is damaged. */
  setRepairWaypoint(waypoint: { x: number; z: number } | null) {
    this.repairMarker.visible = waypoint !== null;
    if (waypoint) this.repairMarker.position.set(waypoint.x, 0, waypoint.z);
  }

  getHudState(): HudState {
    return { speed: this.playerSpeed, maxSpeed: this.hudMaxSpeed };
  }

  addCar(player: PlayerInfo) {
    if (this.cars.has(player.id)) return;
    const root = new THREE.Group();
    const bank = new THREE.Group();
    root.add(bank);

    const parts = buildHoverboard(bank, player);
    const glowHex = new THREE.Color(player.color).getHex();
    const trailLine = makeTrailLine(glowHex);
    this.scene.add(trailLine);
    this.scene.add(root);

    this.cars.set(player.id, {
      root,
      bank,
      plasma: parts.plasma,
      plasmaCore: parts.plasmaCore,
      railL: parts.railL,
      railR: parts.railR,
      hoverRing: parts.hoverRing,
      deckStrip: parts.deckStrip,
      heroAura: parts.heroAura,
      trailLine,
      trailPoints: [],
      lastTrailX: NaN,
      lastTrailZ: NaN,
      lastYaw: 0,
      smoothYaw: NaN,
      displayX: NaN,
      displayY: NaN,
      displayZ: NaN,
      lastSpeed: 0,
      isPlayer: parts.isPlayer,
    });
  }

  removeCar(id: string) {
    const view = this.cars.get(id);
    if (view) {
      this.scene.remove(view.root);
      this.scene.remove(view.trailLine);
      view.trailLine.geometry.dispose();
      (view.trailLine.material as THREE.Material).dispose();
      this.cars.delete(id);
    }
  }

  pushSnapshot(cars: CarState[]) {
    this.snapshots.push({
      recvTime: performance.now(),
      cars: new Map(cars.map((c) => [c.id, c])),
    });
    if (this.snapshots.length > 30) this.snapshots.shift();
  }

  private updateLightTrail(view: CarView, x: number, z: number, speed: number, grounded: boolean) {
    if (!grounded || speed < 4) return;
    const dist = Number.isNaN(view.lastTrailX)
      ? 999
      : Math.hypot(x - view.lastTrailX, z - view.lastTrailZ);
    const spacing = THREE.MathUtils.lerp(1.4, 0.45, Math.min(1, speed / MAX_SPEED));
    if (dist < spacing) return;

    view.trailPoints.push({ x, z });
    view.lastTrailX = x;
    view.lastTrailZ = z;

    const isPlayer = this.myId !== null && view === this.cars.get(this.myId);
    const maxPts = isPlayer ? 140 : 80;
    while (view.trailPoints.length > maxPts) view.trailPoints.shift();

    const positions = new Float32Array(view.trailPoints.length * 3);
    for (let i = 0; i < view.trailPoints.length; i++) {
      positions[i * 3] = view.trailPoints[i].x;
      positions[i * 3 + 1] = 0.07;
      positions[i * 3 + 2] = view.trailPoints[i].z;
    }
    view.trailLine.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    view.trailLine.geometry.computeBoundingSphere();

    const mat = view.trailLine.material as THREE.LineBasicMaterial;
    mat.opacity = THREE.MathUtils.lerp(0.45, 0.92, Math.min(1, speed / MAX_SPEED));
  }

  /** Pull the chase cam forward when tall walls would hide the board. */
  private resolveCameraPosition(focus: THREE.Vector3, desired: THREE.Vector3, frameDt: number): THREE.Vector3 {
    this.tmpCamDir.copy(desired).sub(focus);
    const dist = this.tmpCamDir.length();
    if (dist < 0.01) return desired;
    this.tmpCamDir.multiplyScalar(1 / dist);
    this.cameraRay.set(focus, this.tmpCamDir);
    this.cameraRay.far = dist;
    const hits = this.cameraRay.intersectObjects(this.cameraBlockers, true);
    const hit = hits.find((h) => (h.object as THREE.Mesh).isMesh);
    let targetPull = dist;
    if (hit && hit.distance < dist - 0.6) {
      targetPull = Math.max(2.2, hit.distance - 0.6);
    }
    this.smoothCamPull += (targetPull - this.smoothCamPull) * Math.min(1, frameDt * 4);
    return focus.clone().add(this.tmpCamDir.clone().multiplyScalar(this.smoothCamPull));
  }

  private tmpQa = new THREE.Quaternion();
  private tmpQb = new THREE.Quaternion();
  private tmpYawQ = new THREE.Quaternion();

  render() {
    const nowMs = performance.now();
    const frameDt = Math.min(0.05, Math.max(1 / 240, (nowMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = nowMs;
    const renderTime = nowMs - INTERP_DELAY_MS;
    const pulse = 0.5 + Math.sin(this.simTime * 4.2) * 0.22;

    for (const hg of this.hazardMeshes) {
      const h = hg.userData.hazard as ArenaHazard;
      const armGroup = hg.userData.armGroup as THREE.Group;
      armGroup.rotation.y = hazardAngle(h, this.simTime);
      const warn = hg.userData.warn as THREE.Mesh;
      const sweep = hg.userData.sweep as THREE.Mesh;
      (warn.material as THREE.MeshBasicMaterial).opacity = 0.28 + pulse * 0.28;
      (sweep.material as THREE.MeshBasicMaterial).opacity = 0.08 + pulse * 0.1;
    }

    let a: Snapshot | null = null;
    let b: Snapshot | null = null;
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (this.snapshots[i].recvTime <= renderTime) {
        a = this.snapshots[i];
        b = this.snapshots[i + 1] ?? null;
        break;
      }
    }
    if (!a) a = this.snapshots[0] ?? null;

    if (a) {
      const alpha = b
        ? Math.min(1, (renderTime - a.recvTime) / (b.recvTime - a.recvTime || 1))
        : 1;
      for (const [id, view] of this.cars) {
        const ca = a.cars.get(id);
        if (!ca) continue;
        const cb = b?.cars.get(id);

        let px = ca.p[0];
        let py = ca.p[1];
        let pz = ca.p[2];
        let speed = ca.speed;
        let qx = ca.q[0];
        let qy = ca.q[1];
        let qz = ca.q[2];
        let qw = ca.q[3];

        if (cb) {
          px += (cb.p[0] - ca.p[0]) * alpha;
          py += (cb.p[1] - ca.p[1]) * alpha;
          pz += (cb.p[2] - ca.p[2]) * alpha;
          speed += (cb.speed - ca.speed) * alpha;

          const posJump = Math.hypot(cb.p[0] - ca.p[0], cb.p[2] - ca.p[2]);
          const hardStop = cb.speed - ca.speed < -4;
          if (posJump > 1.6 || hardStop) {
            px = ca.p[0] + (cb.p[0] - ca.p[0]) * alpha;
            pz = ca.p[2] + (cb.p[2] - ca.p[2]) * alpha;
            if (hardStop) {
              px = cb.p[0];
              pz = cb.p[2];
              py = cb.p[1];
            }
          }
          this.tmpQa.set(ca.q[0], ca.q[1], ca.q[2], ca.q[3]);
          this.tmpQb.set(cb.q[0], cb.q[1], cb.q[2], cb.q[3]);
          this.tmpQa.slerp(this.tmpQb, alpha);
          qx = this.tmpQa.x;
          qy = this.tmpQa.y;
          qz = this.tmpQa.z;
          qw = this.tmpQa.w;
        }

        const rawYaw = yawFromQuat({ x: qx, y: qy, z: qz, w: qw });
        if (!Number.isFinite(view.smoothYaw)) view.smoothYaw = rawYaw;
        else view.smoothYaw += deltaYaw(view.smoothYaw, rawYaw) * Math.min(1, frameDt * 14);

        const grounded = cb?.grounded ?? ca.grounded ?? py < HOVER_HEIGHT + 0.18;
        const visualY = py - VISUAL_Y_OFFSET;
        const posBlend = Math.min(1, frameDt * (view.isPlayer ? 10 : 14));
        if (!Number.isFinite(view.displayX)) view.displayX = px;
        else view.displayX += (px - view.displayX) * posBlend;
        if (!Number.isFinite(view.displayY)) view.displayY = visualY;
        else view.displayY += (visualY - view.displayY) * posBlend;
        if (!Number.isFinite(view.displayZ)) view.displayZ = pz;
        else view.displayZ += (pz - view.displayZ) * posBlend;

        yawQuat(view.smoothYaw, this.tmpYawQ);
        view.root.position.set(view.displayX, view.displayY, view.displayZ);
        view.root.quaternion.copy(this.tmpYawQ);

        const yawStep = deltaYaw(view.lastYaw, view.smoothYaw);
        const yawRate = yawStep / frameDt;
        const accel = speed - view.lastSpeed;
        const vy = cb ? (cb.p[1] - ca.p[1]) / (b!.recvTime - a.recvTime || 1) : 0;
        view.lastYaw = view.smoothYaw;
        view.lastSpeed = speed;

        const bankFromSteer = id === this.myId ? this.playerSteer * 0.22 : 0;
        const bankFromTurn = THREE.MathUtils.clamp(-yawRate * 0.08, -0.22, 0.22);
        view.bank.rotation.z = THREE.MathUtils.lerp(
          view.bank.rotation.z,
          bankFromSteer + bankFromTurn,
          Math.min(1, frameDt * 10),
        );
        const pitch = grounded ? 0 : THREE.MathUtils.clamp(-vy * 0.04, -0.22, 0.18);
        view.bank.rotation.x = THREE.MathUtils.lerp(
          view.bank.rotation.x,
          pitch,
          Math.min(1, frameDt * 8),
        );

        const boosting = grounded && speed > 8 && accel > 0.08;
        const jumping = !grounded && vy > 0.5;
        const cruiseGlow = grounded ? 0.55 + Math.min(1, speed / MAX_SPEED) * 0.55 : 0.35;
        const t = performance.now() * 0.001;

        view.plasma.visible = boosting || jumping;
        view.plasmaCore.visible = boosting || jumping;
        if (boosting) {
          const thrust = 0.8 + Math.min(1, speed / MAX_SPEED) * 0.65;
          view.plasma.scale.set(thrust, 0.55 + accel * 0.45, thrust);
          view.plasmaCore.scale.setScalar(0.9 + accel * 0.35);
          const railBoost = view.isPlayer ? 2.2 : 1.6;
          (view.railL.material as THREE.MeshStandardMaterial).emissiveIntensity = railBoost;
          (view.railR.material as THREE.MeshStandardMaterial).emissiveIntensity = railBoost;
          (view.deckStrip.material as THREE.MeshStandardMaterial).emissiveIntensity =
            view.isPlayer ? 1.1 : 0.75;
        } else if (jumping) {
          view.plasma.scale.set(1.15, 1.35, 1.15);
          view.plasmaCore.scale.set(1.4, 1.4, 1.4);
          const jumpGlow = view.isPlayer ? 2.6 : 2.0;
          (view.railL.material as THREE.MeshStandardMaterial).emissiveIntensity = jumpGlow;
          (view.railR.material as THREE.MeshStandardMaterial).emissiveIntensity = jumpGlow;
        } else {
          view.bank.rotation.x = THREE.MathUtils.lerp(view.bank.rotation.x, 0, Math.min(1, frameDt * 7));
          const idleRail = (view.isPlayer ? 1.35 : 1.0) * cruiseGlow;
          (view.railL.material as THREE.MeshStandardMaterial).emissiveIntensity = idleRail;
          (view.railR.material as THREE.MeshStandardMaterial).emissiveIntensity = idleRail;
          (view.deckStrip.material as THREE.MeshStandardMaterial).emissiveIntensity =
            (view.isPlayer ? 0.75 : 0.5) * cruiseGlow;
        }

        if (grounded) {
          const ringMat = view.hoverRing.material as THREE.MeshBasicMaterial;
          ringMat.opacity = view.isPlayer ? 0.38 : 0.24;
          if (view.isPlayer) ringMat.depthTest = false;
          const ringScale = 1 + Math.min(1, speed / MAX_SPEED) * 0.08;
          view.hoverRing.scale.set(ringScale, ringScale, 1);
          view.hoverRing.renderOrder = view.isPlayer ? 999 : 0;
        } else {
          const ringMat = view.hoverRing.material as THREE.MeshBasicMaterial;
          ringMat.opacity = view.isPlayer ? 0.22 : 0.1;
          view.hoverRing.scale.set(1.12, 1.12, 1);
        }

        if (view.isPlayer) {
          view.root.renderOrder = 500;
          if (view.heroAura) {
            view.heroAura.rotation.y = t * 0.22;
            const pulse = 0.88 + Math.sin(t * 3.5) * 0.12;
            for (const child of view.heroAura.children) {
              if (child instanceof THREE.LineSegments) {
                (child.material as THREE.LineBasicMaterial).opacity = 0.08 + pulse * 0.07;
              } else if (child instanceof THREE.Mesh) {
                (child.material as THREE.MeshBasicMaterial).opacity = 0.02 + pulse * 0.022;
              }
            }
          }
        }

        this.updateLightTrail(view, px, pz, speed, grounded);

        if (id === this.myId) {
          this.playerSpeed = speed;
          this.playerYawRate = THREE.MathUtils.lerp(
            this.playerYawRate,
            yawRate,
            Math.min(1, frameDt * 6),
          );
        }
      }
    }

    if (this.myId) {
      const mine = this.cars.get(this.myId);
      if (mine) {
        const speedNorm = Math.min(1, this.playerSpeed / MAX_SPEED);
        const camBlend = Math.min(1, frameDt * 3.5);

        const followDist = THREE.MathUtils.lerp(CAM_DIST_MIN, CAM_DIST_MAX, speedNorm);
        const followHeight = THREE.MathUtils.lerp(CAM_HEIGHT_MIN, CAM_HEIGHT_MAX, speedNorm);
        this.tmpCamDesired
          .set(0, followHeight, followDist)
          .applyQuaternion(mine.root.quaternion)
          .add(mine.root.position);

        this.tmpCamFocus
          .set(0, 0.28, -0.8)
          .applyQuaternion(mine.root.quaternion)
          .add(mine.root.position);

        const resolved = this.resolveCameraPosition(this.tmpCamFocus, this.tmpCamDesired, frameDt);
        this.camera.position.lerp(resolved, camBlend);

        if (!this.cameraInitialized) {
          this.camera.position.copy(resolved);
          this.lookTarget.copy(this.tmpCamFocus);
          this.smoothCamPull = followDist;
          this.cameraInitialized = true;
        }
        this.lookTarget.lerp(this.tmpCamFocus, camBlend);
        this.camera.lookAt(this.lookTarget);
        this.camera.rotation.z = 0;
      }
    }

    if (this.repairMarker.visible) {
      const pulse = 0.75 + Math.sin(performance.now() * 0.004) * 0.25;
      const beam = this.repairMarker.getObjectByName("repair-beam") as THREE.Mesh | undefined;
      const ring = this.repairMarker.getObjectByName("repair-ring") as THREE.Mesh | undefined;
      if (beam) (beam.material as THREE.MeshBasicMaterial).opacity = 0.22 + pulse * 0.22;
      if (ring) {
        ring.scale.set(pulse, pulse, 1);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + pulse * 0.2;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
