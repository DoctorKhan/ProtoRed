import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { ARENA_HALF, CarState, OBSTACLES, PLATFORMS, RAMPS, PlayerInfo } from "../../shared/protocol";
import { HOVER_HEIGHT } from "./sim/physics";
import { yawFromQuat } from "../../shared/mathutil";

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
  heroOutline: THREE.LineSegments | null;
  trailLine: THREE.Line;
  trailPoints: TrailPoint[];
  lastTrailX: number;
  lastTrailZ: number;
  lastYaw: number;
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
const TRON_VOID = 0x000000;
const TRON_CYAN = 0x00eeff;
const TRON_CYAN_DIM = 0x006677;
const TRON_CYAN_FAINT = 0x003344;

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
  ctx.fillStyle = "#010204";
  ctx.fillRect(0, 0, size, size);
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  patternTextures.set(key, tex);
  return tex;
}

function drawCircuitGrid(ctx: CanvasRenderingContext2D, size: number, accent: number) {
  const cell = size / 8;
  const color = accentCss(accent);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.12;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const p = i * cell;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.35;
  for (let i = 0; i <= 8; i += 2) {
    const p = i * cell;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  for (let i = 1; i < 8; i += 2) {
    for (let j = 1; j < 8; j += 2) {
      ctx.beginPath();
      ctx.arc(i * cell, j * cell, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cell * 0.5, cell * 2);
  ctx.bezierCurveTo(cell * 2, cell * 1, cell * 5, cell * 3, cell * 7.5, cell * 2);
  ctx.moveTo(cell * 1, cell * 6);
  ctx.bezierCurveTo(cell * 3, cell * 4.5, cell * 5.5, cell * 7, cell * 7, cell * 5.5);
  ctx.stroke();
}

function drawHexMesh(ctx: CanvasRenderingContext2D, size: number, accent: number) {
  const color = accentCss(accent);
  const r = size / 10;
  const h = r * Math.sqrt(3);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let row = -1; row < 12; row++) {
    for (let col = -1; col < 12; col++) {
      const cx = col * r * 1.5 + (row % 2 ? r * 0.75 : 0);
      const cy = row * h * 0.5;
      ctx.globalAlpha = 0.18 + ((row + col) % 3) * 0.08;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const x = cx + r * 0.9 * Math.cos(a);
        const y = cy + r * 0.9 * Math.sin(a);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function drawDeckArt(ctx: CanvasRenderingContext2D, size: number, accent: number) {
  const color = accentCss(accent);
  drawCircuitGrid(ctx, size, accent);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    const y = size * (0.15 + i * 0.17);
    ctx.moveTo(size * 0.08, y);
    ctx.bezierCurveTo(size * 0.35, y - size * 0.06, size * 0.65, y + size * 0.06, size * 0.92, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.65;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.08);
  ctx.lineTo(size * 0.38, size * 0.22);
  ctx.lineTo(size * 0.62, size * 0.22);
  ctx.closePath();
  ctx.stroke();
}

function drawVerticalCircuit(ctx: CanvasRenderingContext2D, size: number, accent: number) {
  const color = accentCss(accent);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.25;
  for (let i = 1; i < 6; i++) {
    const x = (size / 6) * i;
    ctx.lineWidth = i % 2 === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(size * 0.2, size * 0.15);
  ctx.lineTo(size * 0.2, size * 0.85);
  ctx.moveTo(size * 0.8, size * 0.1);
  ctx.lineTo(size * 0.75, size * 0.9);
  ctx.stroke();
}

type PatternKind = "circuit" | "hex" | "deck" | "vertical";

function surfaceMaterial(
  kind: PatternKind,
  repeatX: number,
  repeatY: number,
  accent = TRON_CYAN,
  intensity = 0.32,
): THREE.MeshStandardMaterial {
  const key = `${kind}-${accent}`;
  const baseTex = patternTexture(key, (ctx, size) => {
    if (kind === "circuit") drawCircuitGrid(ctx, size, accent);
    else if (kind === "hex") drawHexMesh(ctx, size, accent);
    else if (kind === "deck") drawDeckArt(ctx, size, accent);
    else drawVerticalCircuit(ctx, size, accent);
  });
  const tex = baseTex.clone();
  tex.repeat.set(repeatX, repeatY);
  return new THREE.MeshStandardMaterial({
    color: 0x020408,
    map: tex,
    emissiveMap: tex,
    emissive: accent,
    emissiveIntensity: intensity,
    roughness: 0.14,
    metalness: 0.9,
  });
}

function addFaceDecal(
  group: THREE.Group,
  w: number,
  h: number,
  d: number,
  accent = TRON_CYAN,
) {
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.94, d * 0.94),
    surfaceMaterial("hex", Math.max(1, w / 3), Math.max(1, d / 3), accent, 0.38),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = h / 2 + 0.01;
  group.add(top);

  const mkSide = (rotY: number, px: number, pz: number, sw: number, sh: number) => {
    const side = new THREE.Mesh(
      new THREE.PlaneGeometry(sw * 0.94, sh * 0.94),
      surfaceMaterial("vertical", Math.max(1, sw / 2), Math.max(1, sh / 2), accent, 0.28),
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

function addTopArcs(group: THREE.Group, w: number, d: number, y: number, accent: number) {
  const verts: number[] = [];
  const segs = 8;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = (t - 0.5) * w * 0.85;
    const z1 = Math.sin(t * Math.PI * 2) * d * 0.12;
    const z2 = -d * 0.38 + t * d * 0.76;
    verts.push(x, y, z1, x, y, z2);
  }
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = (t - 0.5) * d * 0.85;
    const x = Math.cos(t * Math.PI * 1.5) * w * 0.1;
    verts.push(x, y, z, -x, y, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  group.add(
    new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.42 }),
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

function lineGrid(size: number, divisions: number, y: number, color: number, opacity: number): THREE.LineSegments {
  const step = size / divisions;
  const half = size / 2;
  const verts: number[] = [];
  for (let i = 0; i <= divisions; i++) {
    const o = -half + i * step;
    verts.push(-half, y, o, half, y, o);
    verts.push(o, y, -half, o, y, half);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  return new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

function makeTronGrid(size: number): THREE.Group {
  const group = new THREE.Group();
  group.add(lineGrid(size, 64, 0.02, TRON_CYAN_FAINT, 0.35));
  group.add(lineGrid(size, 16, 0.025, TRON_CYAN_DIM, 0.55));
  group.add(lineGrid(size, 4, 0.03, TRON_CYAN, 0.85));
  const half = size / 2;
  const axisVerts = new Float32Array([
    -half, 0.035, 0, half, 0.035, 0,
    0, 0.035, -half, 0, 0.035, half,
  ]);
  const axisGeo = new THREE.BufferGeometry();
  axisGeo.setAttribute("position", new THREE.BufferAttribute(axisVerts, 3));
  group.add(
    new THREE.LineSegments(
      axisGeo,
      new THREE.LineBasicMaterial({ color: TRON_CYAN, transparent: true, opacity: 0.95 }),
    ),
  );
  return group;
}

function makeHorizonRing(radius: number): THREE.Group {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.35, radius, 96),
    new THREE.MeshBasicMaterial({
      color: TRON_CYAN,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);
  return group;
}

function wireframeShell(geometry: THREE.BufferGeometry, color: number, opacity = 0.92): THREE.LineSegments {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

function hullMaterial(emissive: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x030508,
    roughness: 0.05,
    metalness: 0.94,
    emissive,
    emissiveIntensity: intensity,
  });
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
  const hero = !player.isBot;
  const bodyW = 1.72;
  const bodyD = 3.72;

  // Keep the deck thin and wide: a beveled surf/skate profile, not a pod.
  const deckGeo = new RoundedBoxGeometry(bodyW, 0.18, bodyD, 8, 0.28);
  const deck = new THREE.Mesh(deckGeo, hullMaterial(glow, hero ? 0.18 : 0.1));
  deck.position.y = 0.11;
  bank.add(deck);

  const deckArt = new THREE.Mesh(
    new THREE.PlaneGeometry(bodyW * 0.86, bodyD * 0.86),
    surfaceMaterial("deck", 2, 5, glow, hero ? 0.48 : 0.34),
  );
  deckArt.rotation.x = -Math.PI / 2;
  deckArt.position.y = 0.19;
  bank.add(deckArt);

  const stripGeo = new RoundedBoxGeometry(bodyW * 0.42, 0.03, bodyD * 0.62, 4, 0.02);
  const deckStrip = new THREE.Mesh(stripGeo, glowMaterial(glow, hero ? 0.85 : 0.55));
  deckStrip.position.y = 0.19;
  bank.add(deckStrip);

  const prow = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 10, 10),
    glowMaterial(glow, hero ? 2.4 : 1.6),
  );
  prow.scale.set(1, 0.55, 1.8);
  prow.position.set(0, 0.18, -bodyD * 0.49);
  bank.add(prow);

  const railL = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.035, bodyD * 0.68),
    glowMaterial(glow, hero ? 1.9 : 1.35),
  );
  railL.position.set(-bodyW * 0.36, -0.01, 0.06);
  bank.add(railL);

  const railR = railL.clone();
  railR.position.x = bodyW * 0.36;
  bank.add(railR);

  const railCore = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * 0.22, 0.02, bodyD * 0.48),
    glowMaterial(0xffffff, hero ? 1.1 : 0.75, { transparent: true, opacity: 0.85 }),
  );
  railCore.position.set(0, -0.025, 0.08);
  bank.add(railCore);

  const hoverRing = new THREE.Mesh(
    new RoundedBoxGeometry(bodyW * 0.7, 0.015, bodyD * 0.62, 6, 0.18),
    new THREE.MeshBasicMaterial({
      color: glow,
      transparent: true,
      opacity: hero ? 0.42 : 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  hoverRing.position.y = -0.11;
  bank.add(hoverRing);

  const plasmaCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 10),
    glowMaterial(glow, 3.2, { transparent: true, opacity: 0.9 }),
  );
  plasmaCore.position.set(0, 0.01, bodyD * 0.5);
  plasmaCore.visible = false;
  bank.add(plasmaCore);

  const plasma = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.85, 14, 1, true),
    glowMaterial(glow, 2.4, { transparent: true, opacity: 0.65 }),
  );
  plasma.position.set(0, 0.01, bodyD * 0.54);
  plasma.rotation.x = Math.PI;
  plasma.visible = false;
  bank.add(plasma);

  bank.add(makeLabel(player.name + (player.isBot ? " ⚡" : ""), player.color));

  let heroOutline: THREE.LineSegments | null = null;
  if (hero) {
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.55, 24),
      new THREE.MeshBasicMaterial({
        color: glow,
        transparent: true,
        opacity: 0.55,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.32;
    marker.renderOrder = 1002;
    bank.add(marker);
  }

  return { railL, railR, hoverRing, deckStrip, plasma, plasmaCore, heroOutline, isPlayer: hero };
}

function tronObstacle(w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  group.add(
    new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0x010102,
        roughness: 0.15,
        metalness: 0.95,
        emissive: TRON_CYAN_FAINT,
        emissiveIntensity: 0.08,
      }),
    ),
  );
  group.add(wireframeShell(geo, TRON_CYAN));
  addFaceDecal(group, w, h, d);
  addTopArcs(group, w, d, h / 2 + 0.02, TRON_CYAN);
  const pillarMat = new THREE.LineBasicMaterial({ color: TRON_CYAN, transparent: true, opacity: 0.65 });
  const hx = w / 2;
  const hz = d / 2;
  for (const [px, pz] of [[hx, hz], [hx, -hz], [-hx, hz], [-hx, -hz]] as const) {
    const pillarVerts = new Float32Array([px, -h / 2, pz, px, h / 2, pz]);
    const pillarGeo = new THREE.BufferGeometry();
    pillarGeo.setAttribute("position", new THREE.BufferAttribute(pillarVerts, 3));
    group.add(new THREE.LineSegments(pillarGeo, pillarMat));
  }
  return group;
}

function makeTrailLine(color: number): THREE.Line {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
  return new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
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
  private cameraInitialized = false;
  private playerSteer = 0;
  private playerSpeed = 0;
  private playerYawRate = 0;
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

    this.scene.background = new THREE.Color(TRON_VOID);
    this.scene.fog = new THREE.FogExp2(0x000812, 0.0028);

    const trackStatic = (obj: THREE.Object3D) => {
      this.scene.add(obj);
      this.cameraBlockers.push(obj);
    };

    const fill = new THREE.HemisphereLight(0x0a1828, 0x000000, 0.35);
    this.scene.add(fill);
    const key = new THREE.DirectionalLight(0x88ddff, 0.25);
    key.position.set(20, 50, 10);
    this.scene.add(key);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
      surfaceMaterial("circuit", ARENA_HALF / 3, ARENA_HALF / 3, TRON_CYAN, 0.2),
    );
    ground.rotation.x = -Math.PI / 2;
    trackStatic(ground);
    this.scene.add(makeTronGrid(ARENA_HALF * 2));
    this.scene.add(makeHorizonRing(ARENA_HALF - 1));

    const mkWall = (x: number, z: number, w: number, d: number) => {
      const geo = new THREE.BoxGeometry(w, 4, d);
      const shell = new THREE.Group();
      shell.add(
        new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            color: 0x010102,
            roughness: 0.1,
            metalness: 0.95,
            emissive: TRON_CYAN_FAINT,
            emissiveIntensity: 0.06,
          }),
        ),
      );
      shell.add(wireframeShell(geo, TRON_CYAN));
      addFaceDecal(shell, w, 4, d, TRON_CYAN_DIM);
      shell.position.set(x, 2, z);
      trackStatic(shell);
    };
    mkWall(0, -ARENA_HALF - 1, ARENA_HALF * 2 + 4, 2);
    mkWall(0, ARENA_HALF + 1, ARENA_HALF * 2 + 4, 2);
    mkWall(-ARENA_HALF - 1, 0, 2, ARENA_HALF * 2 + 4);
    mkWall(ARENA_HALF + 1, 0, 2, ARENA_HALF * 2 + 4);

    for (const o of OBSTACLES) {
      const obs = tronObstacle(o.w, o.h, o.d);
      obs.position.set(o.x, o.h / 2, o.z);
      trackStatic(obs);
    }

    const deckMat = new THREE.MeshStandardMaterial({
      color: 0x010102,
      roughness: 0.12,
      metalness: 0.95,
      emissive: TRON_CYAN_FAINT,
      emissiveIntensity: 0.1,
    });
    for (const p of PLATFORMS) {
      const deckGeo = new THREE.BoxGeometry(p.w, 0.35, p.d);
      const deckGroup = new THREE.Group();
      deckGroup.add(new THREE.Mesh(deckGeo, deckMat));
      deckGroup.add(wireframeShell(deckGeo, TRON_CYAN));
      addFaceDecal(deckGroup, p.w, 0.35, p.d);
      addTopArcs(deckGroup, p.w, p.d, 0.35 / 2 + 0.02, TRON_CYAN);
      deckGroup.position.set(p.x, p.y - 0.15, p.z);
      trackStatic(deckGroup);

      const pillarH = Math.max(0.5, p.y - 0.35);
      if (pillarH > 0.8) {
        const mkPillar = (px: number, pz: number) => {
          const colGeo = new THREE.BoxGeometry(1.2, pillarH, 1.2);
          const colGroup = new THREE.Group();
          colGroup.add(new THREE.Mesh(colGeo, deckMat));
          colGroup.add(wireframeShell(colGeo, TRON_CYAN_DIM));
          addFaceDecal(colGroup, 1.2, pillarH, 1.2, TRON_CYAN_DIM);
          colGroup.position.set(px, pillarH / 2, pz);
          trackStatic(colGroup);
        };
        mkPillar(p.x - p.w / 2 + 1.2, p.z - p.d / 2 + 1.2);
        mkPillar(p.x + p.w / 2 - 1.2, p.z - p.d / 2 + 1.2);
        mkPillar(p.x - p.w / 2 + 1.2, p.z + p.d / 2 - 1.2);
        mkPillar(p.x + p.w / 2 - 1.2, p.z + p.d / 2 - 1.2);
      }
    }

    const rampMat = new THREE.MeshStandardMaterial({
      color: 0x010102,
      roughness: 0.12,
      metalness: 0.95,
      emissive: TRON_CYAN_FAINT,
      emissiveIntensity: 0.08,
    });
    for (const r of RAMPS) {
      const pitch = Math.atan2(r.yHigh - r.yLow, r.length);
      const geo = new THREE.BoxGeometry(r.width, 0.28, r.length);
      const rampGroup = new THREE.Group();
      rampGroup.add(new THREE.Mesh(geo, rampMat));
      rampGroup.add(wireframeShell(geo, TRON_CYAN));
      addFaceDecal(rampGroup, r.width, 0.28, r.length);
      rampGroup.position.set(r.x, (r.yLow + r.yHigh) / 2, r.z);
      rampGroup.rotation.order = "YXZ";
      rampGroup.rotation.y = r.heading;
      rampGroup.rotation.x = pitch;
      trackStatic(rampGroup);
    }

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setPlayerInput(steer: number, _throttle: number) {
    this.playerSteer = steer;
  }

  getHudState(): HudState {
    return { speed: this.playerSpeed, maxSpeed: MAX_SPEED };
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
      heroOutline: parts.heroOutline,
      trailLine,
      trailPoints: [],
      lastTrailX: NaN,
      lastTrailZ: NaN,
      lastYaw: 0,
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

  /** Pull the chase cam forward when walls/platforms would hide the board. */
  private resolveCameraPosition(focus: THREE.Vector3, desired: THREE.Vector3): THREE.Vector3 {
    this.tmpCamDir.copy(desired).sub(focus);
    const dist = this.tmpCamDir.length();
    if (dist < 0.01) return desired;
    this.tmpCamDir.multiplyScalar(1 / dist);
    this.cameraRay.set(focus, this.tmpCamDir);
    this.cameraRay.far = dist;
    const hits = this.cameraRay.intersectObjects(this.cameraBlockers, true);
    const hit = hits.find((h) => (h.object as THREE.Mesh).isMesh);
    if (hit && hit.distance < dist - 0.6) {
      const pullDist = Math.max(2.2, hit.distance - 0.6);
      return focus.clone().add(this.tmpCamDir.clone().multiplyScalar(pullDist));
    }
    return desired;
  }

  private tmpQa = new THREE.Quaternion();
  private tmpQb = new THREE.Quaternion();
  private tmpYawQ = new THREE.Quaternion();

  render() {
    const renderTime = performance.now() - INTERP_DELAY_MS;
    const dt = 1 / 60;

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

        const yaw = yawFromQuat({ x: qx, y: qy, z: qz, w: qw });
        yawQuat(yaw, this.tmpYawQ);
        const grounded = cb?.grounded ?? ca.grounded ?? py < HOVER_HEIGHT + 0.18;
        const visualY = py - VISUAL_Y_OFFSET;
        view.root.position.set(px, visualY, pz);
        view.root.quaternion.copy(this.tmpYawQ);

        const yawRate = (yaw - view.lastYaw) / dt;
        const accel = speed - view.lastSpeed;
        const vy = cb ? (cb.p[1] - ca.p[1]) / (b!.recvTime - a.recvTime || 1) : 0;
        view.lastYaw = yaw;
        view.lastSpeed = speed;

        const bankFromSteer = id === this.myId ? this.playerSteer * 0.28 : 0;
        const bankFromTurn = THREE.MathUtils.clamp(-yawRate * 0.14, -0.32, 0.32);
        view.bank.rotation.z = THREE.MathUtils.lerp(
          view.bank.rotation.z,
          bankFromSteer + bankFromTurn,
          0.14,
        );
        const pitch = grounded ? 0 : THREE.MathUtils.clamp(-vy * 0.04, -0.22, 0.18);
        view.bank.rotation.x = THREE.MathUtils.lerp(view.bank.rotation.x, pitch, 0.12);

        const boosting = grounded && speed > 8 && accel > 0.08;
        const jumping = !grounded && vy > 0.5;
        const cruiseGlow = grounded ? 0.55 + Math.min(1, speed / MAX_SPEED) * 0.55 : 0.35;
        const t = performance.now() * 0.001;
        const pulse = 1 + Math.sin(t * (view.isPlayer ? 5 : 4)) * 0.06;

        view.plasma.visible = boosting || jumping;
        view.plasmaCore.visible = boosting || jumping;
        if (boosting) {
          const thrust = 0.8 + Math.min(1, speed / MAX_SPEED) * 0.65;
          view.plasma.scale.set(thrust, 0.55 + accel * 0.45, thrust);
          view.plasmaCore.scale.setScalar(0.9 + accel * 0.35);
          const railBoost = (view.isPlayer ? 2.2 : 1.6) * pulse;
          (view.railL.material as THREE.MeshStandardMaterial).emissiveIntensity = railBoost;
          (view.railR.material as THREE.MeshStandardMaterial).emissiveIntensity = railBoost;
          (view.deckStrip.material as THREE.MeshStandardMaterial).emissiveIntensity =
            (view.isPlayer ? 1.1 : 0.75) * pulse;
        } else if (jumping) {
          view.plasma.scale.set(1.15, 1.35, 1.15);
          view.plasmaCore.scale.set(1.4, 1.4, 1.4);
          const jumpGlow = view.isPlayer ? 2.6 : 2.0;
          (view.railL.material as THREE.MeshStandardMaterial).emissiveIntensity = jumpGlow;
          (view.railR.material as THREE.MeshStandardMaterial).emissiveIntensity = jumpGlow;
        } else {
          view.bank.rotation.x = THREE.MathUtils.lerp(view.bank.rotation.x, 0, 0.1);
          const idleRail = (view.isPlayer ? 1.35 : 1.0) * cruiseGlow * pulse;
          (view.railL.material as THREE.MeshStandardMaterial).emissiveIntensity = idleRail;
          (view.railR.material as THREE.MeshStandardMaterial).emissiveIntensity = idleRail;
          (view.deckStrip.material as THREE.MeshStandardMaterial).emissiveIntensity =
            (view.isPlayer ? 0.75 : 0.5) * cruiseGlow;
        }

        if (grounded) {
          const ringMat = view.hoverRing.material as THREE.MeshBasicMaterial;
          ringMat.opacity =
            (view.isPlayer ? 0.48 : 0.22) + Math.sin(t * 6) * 0.08;
          if (view.isPlayer) ringMat.depthTest = false;
          const ringScale = 1 + Math.sin(t * 4.5) * 0.05 + Math.min(1, speed / MAX_SPEED) * 0.08;
          view.hoverRing.scale.set(ringScale, ringScale, 1);
          view.hoverRing.renderOrder = view.isPlayer ? 999 : 0;
        } else {
          const ringMat = view.hoverRing.material as THREE.MeshBasicMaterial;
          ringMat.opacity = view.isPlayer ? 0.28 : 0.12;
          view.hoverRing.scale.set(1.15, 1.15, 1);
        }

        if (view.isPlayer) {
          view.root.renderOrder = 500;
          if (view.heroOutline) {
            const pulse = 0.7 + Math.sin(t * 5) * 0.15;
            (view.heroOutline.material as THREE.LineBasicMaterial).opacity = pulse;
          }
        }

        this.updateLightTrail(view, px, pz, speed, grounded);

        if (id === this.myId) {
          this.playerSpeed = speed;
          this.playerYawRate = yawRate;
        }
      }
    }

    if (this.myId) {
      const mine = this.cars.get(this.myId);
      if (mine) {
        const speedNorm = Math.min(1, this.playerSpeed / MAX_SPEED);
        const boardY = mine.root.position.y;
        const heightBoost = THREE.MathUtils.clamp((boardY - 4) * 0.18, 0, 2.5);
        const targetFov = THREE.MathUtils.lerp(58, 72, speedNorm);
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 0.08);
        this.camera.updateProjectionMatrix();

        const followDist = THREE.MathUtils.lerp(CAM_DIST_MIN, CAM_DIST_MAX, speedNorm);
        const followHeight =
          THREE.MathUtils.lerp(CAM_HEIGHT_MIN, CAM_HEIGHT_MAX, speedNorm) + heightBoost;
        this.tmpCamDesired
          .set(0, followHeight, followDist)
          .applyQuaternion(mine.root.quaternion)
          .add(mine.root.position);

        // Look at the board (lower-center of screen), not far down the track.
        this.tmpCamFocus
          .set(0, 0.28, -0.8)
          .applyQuaternion(mine.root.quaternion)
          .add(mine.root.position);

        const resolved = this.resolveCameraPosition(this.tmpCamFocus, this.tmpCamDesired);
        this.camera.position.lerp(resolved, 0.12);

        if (!this.cameraInitialized) {
          this.lookTarget.copy(this.tmpCamFocus);
          this.cameraInitialized = true;
        }
        this.lookTarget.lerp(this.tmpCamFocus, 0.16);
        this.camera.lookAt(this.lookTarget);

        const lean = THREE.MathUtils.clamp(
          -this.playerSteer * 0.04 - this.playerYawRate * 0.02,
          -0.06,
          0.06,
        );
        this.camera.rotation.z = THREE.MathUtils.lerp(this.camera.rotation.z, lean, 0.08);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
