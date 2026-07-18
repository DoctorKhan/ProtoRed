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
  rail: THREE.Mesh;
  trailLine: THREE.Line;
  trailPoints: TrailPoint[];
  lastTrailX: number;
  lastTrailZ: number;
  lastYaw: number;
  lastSpeed: number;
}

interface Snapshot {
  recvTime: number;
  cars: Map<string, CarState>;
}

const INTERP_DELAY_MS = 120;
const BOARD_Y = 1.05;
const VISUAL_Y_OFFSET = HOVER_HEIGHT - BOARD_Y;
const MAX_SPEED = 34;
const TRON_VOID = 0x000000;
const TRON_CYAN = 0x00eeff;
const TRON_CYAN_DIM = 0x006677;
const TRON_CYAN_FAINT = 0x003344;

function makeLabel(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 34px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  sprite.scale.set(6, 0.9, 1);
  sprite.position.set(0, 1.35, 0);
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

function wireframeShell(geometry: THREE.BufferGeometry, color: number): THREE.LineSegments {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.92 }),
  );
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
  private streaks: THREE.Mesh[] = [];
  private streakCooldown = 0;
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
    this.scene.fog = new THREE.FogExp2(0x000812, 0.0045);

    const fill = new THREE.HemisphereLight(0x0a1828, 0x000000, 0.35);
    this.scene.add(fill);
    const key = new THREE.DirectionalLight(0x88ddff, 0.25);
    key.position.set(20, 50, 10);
    this.scene.add(key);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        roughness: 0.08,
        metalness: 0.95,
        emissive: TRON_CYAN_FAINT,
        emissiveIntensity: 0.04,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
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
      shell.position.set(x, 2, z);
      this.scene.add(shell);
    };
    mkWall(0, -ARENA_HALF - 1, ARENA_HALF * 2 + 4, 2);
    mkWall(0, ARENA_HALF + 1, ARENA_HALF * 2 + 4, 2);
    mkWall(-ARENA_HALF - 1, 0, 2, ARENA_HALF * 2 + 4);
    mkWall(ARENA_HALF + 1, 0, 2, ARENA_HALF * 2 + 4);

    for (const o of OBSTACLES) {
      const obs = tronObstacle(o.w, o.h, o.d);
      obs.position.set(o.x, o.h / 2, o.z);
      this.scene.add(obs);
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
      const deck = new THREE.Mesh(deckGeo, deckMat);
      deck.position.set(p.x, p.y - 0.15, p.z);
      this.scene.add(deck);
      const edge = wireframeShell(deckGeo, TRON_CYAN);
      edge.position.copy(deck.position);
      this.scene.add(edge);

      const pillarH = Math.max(0.5, p.y - 0.35);
      if (pillarH > 0.8) {
        const mkPillar = (px: number, pz: number) => {
          const colGeo = new THREE.BoxGeometry(1.2, pillarH, 1.2);
          const col = new THREE.Mesh(colGeo, deckMat);
          col.position.set(px, pillarH / 2, pz);
          this.scene.add(col);
          const colEdge = wireframeShell(colGeo, TRON_CYAN_DIM);
          colEdge.position.copy(col.position);
          this.scene.add(colEdge);
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
      const ramp = new THREE.Mesh(geo, rampMat);
      ramp.position.set(r.x, (r.yLow + r.yHigh) / 2, r.z);
      ramp.rotation.order = "YXZ";
      ramp.rotation.y = r.heading;
      ramp.rotation.x = pitch;
      this.scene.add(ramp);
      const rampEdge = wireframeShell(geo, TRON_CYAN);
      rampEdge.position.copy(ramp.position);
      rampEdge.rotation.copy(ramp.rotation);
      this.scene.add(rampEdge);
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

    const color = new THREE.Color(player.color);
    const glowHex = color.getHex();
    const bodyW = 1.85;
    const bodyD = 3.85;

    const deckGeo = new RoundedBoxGeometry(bodyW, 0.2, bodyD, 6, 0.12);
    const deck = new THREE.Mesh(
      deckGeo,
      new THREE.MeshStandardMaterial({
        color: 0x030508,
        roughness: 0.08,
        metalness: 0.95,
        emissive: glowHex,
        emissiveIntensity: player.isBot ? 0.12 : 0.22,
      }),
    );
    deck.position.y = 0.12;
    bank.add(deck);
    bank.add(wireframeShell(deckGeo, glowHex));

    const noseGeo = new RoundedBoxGeometry(bodyW * 0.72, 0.14, 0.55, 4, 0.08);
    const nose = new THREE.Mesh(
      noseGeo,
      new THREE.MeshStandardMaterial({
        color: 0x030508,
        emissive: glowHex,
        emissiveIntensity: 0.15,
        roughness: 0.08,
        metalness: 0.95,
      }),
    );
    nose.position.set(0, 0.1, -bodyD * 0.44);
    bank.add(nose);
    bank.add(wireframeShell(noseGeo, glowHex));

    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(bodyW * 0.82, 0.05, bodyD * 0.55),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: glowHex,
        emissiveIntensity: player.isBot ? 1.1 : 1.45,
        roughness: 0.15,
        metalness: 0.2,
      }),
    );
    rail.position.y = -0.02;
    bank.add(rail);

    const plasma = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.7, 12, 1, true),
      new THREE.MeshStandardMaterial({
        color: glowHex,
        emissive: glowHex,
        emissiveIntensity: 2.2,
        roughness: 0.05,
        metalness: 0,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    plasma.position.set(0, 0.02, bodyD * 0.52);
    plasma.rotation.x = Math.PI;
    plasma.visible = false;
    bank.add(plasma);

    bank.add(makeLabel(player.name + (player.isBot ? " ⚡" : ""), player.color));

    const trailLine = makeTrailLine(glowHex);
    this.scene.add(trailLine);

    this.scene.add(root);
    this.cars.set(player.id, {
      root,
      bank,
      plasma,
      rail,
      trailLine,
      trailPoints: [],
      lastTrailX: NaN,
      lastTrailZ: NaN,
      lastYaw: 0,
      lastSpeed: 0,
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

  private tmpQa = new THREE.Quaternion();
  private tmpQb = new THREE.Quaternion();
  private tmpYawQ = new THREE.Quaternion();

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
        view.plasma.visible = boosting || jumping;
        if (boosting) {
          const pulse = 0.75 + Math.min(1, speed / MAX_SPEED) * 0.55;
          view.plasma.scale.set(pulse, 0.6 + accel * 0.4, pulse);
          const railPulse = 1.1 + Math.sin(performance.now() * 0.012) * 0.08;
          (view.rail.material as THREE.MeshStandardMaterial).emissiveIntensity =
            id === this.myId ? 1.45 * railPulse : 1.1 * railPulse;
        } else if (jumping) {
          view.plasma.scale.set(1.1, 1.4, 1.1);
          (view.rail.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.0;
        } else {
          view.bank.rotation.x = THREE.MathUtils.lerp(view.bank.rotation.x, 0, 0.1);
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
        const targetFov = THREE.MathUtils.lerp(62, 79, speedNorm);
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 0.06);
        this.camera.updateProjectionMatrix();

        const followDist = THREE.MathUtils.lerp(17, 22, speedNorm);
        const followHeight = THREE.MathUtils.lerp(3.2, 4.2, speedNorm);
        const behind = new THREE.Vector3(0, followHeight, followDist)
          .applyQuaternion(mine.root.quaternion)
          .add(mine.root.position);
        this.camera.position.lerp(behind, 0.055);

        const lookAhead = new THREE.Vector3(0, 0.85, -6)
          .applyQuaternion(mine.root.quaternion)
          .add(mine.root.position);
        if (!this.cameraInitialized) {
          this.lookTarget.copy(lookAhead);
          this.cameraInitialized = true;
        }
        this.lookTarget.lerp(lookAhead, 0.09);
        this.camera.lookAt(this.lookTarget);

        const lean = THREE.MathUtils.clamp(
          -this.playerSteer * 0.045 - this.playerYawRate * 0.025,
          -0.07,
          0.07,
        );
        this.camera.rotation.z = THREE.MathUtils.lerp(this.camera.rotation.z, lean, 0.07);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
