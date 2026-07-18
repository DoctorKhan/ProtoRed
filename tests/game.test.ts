import { describe, it, expect } from "vitest";
import { createPhysics } from "../client/src/sim/physics";
import { Game } from "../client/src/sim/game";
import { scriptedDecision, DecideFn } from "../shared/brain";
import { CarState } from "../shared/protocol";

// Headless integration test of the browser simulation. Rapier's wasm runs in Node,
// so we can drive the same Game the browser uses without a DOM — proving the ported
// loop steps physics, schedules bot decisions, emits snapshots, and wires the CTF.

const flush = () => new Promise((r) => setTimeout(r, 0));

// Inject the deterministic scripted brain (no network).
const decide: DecideFn = async (persona, _self, others, chat) =>
  scriptedDecision(persona, others, chat);

describe("Game (headless sim)", () => {
  it("runs the loop: physics steps, bots decide, snapshots + CTF progress flow", async () => {
    const physics = await createPhysics();

    let snapshots = 0;
    let botDecisions = 0;
    let ctfProgress = false;
    let firstPos: [number, number, number] | null = null;
    let maxMoved = 0;
    const joined: string[] = [];

    const game = new Game(physics, decide, {
      onPlayerJoined: (p) => joined.push(p.name),
      onSnapshot: (cars: CarState[]) => {
        snapshots++;
        const me = cars.find((c) => c.id === game.myId);
        if (me) {
          if (!firstPos) firstPos = me.p;
          else {
            const d = Math.hypot(me.p[0] - firstPos[0], me.p[2] - firstPos[2]);
            if (d > maxMoved) maxMoved = d;
          }
        }
      },
      onBotDecision: () => botDecisions++,
      onCtfProgress: () => (ctfProgress = true),
    });

    game.start();
    const id = game.join("TestPilot");
    expect(id).toBeTruthy();
    expect(joined).toEqual(["Blaze", "Zen", "Gizmo", "TestPilot"]);

    // Drive in a gentle circle (throttle + steer) so the car can't pin on a wall.
    for (let i = 0; i < 900; i++) {
      game.setInput({ throttle: 1, brake: 0, steer: 0.3 });
      game.step(1 / 60);
      if (i % 20 === 0) await flush(); // let async bot thinks resolve
    }
    await flush();

    expect(snapshots).toBeGreaterThan(50);
    expect(botDecisions).toBeGreaterThan(0); // bots thought at least once
    expect(ctfProgress).toBe(true); // progress delivered on join
    expect(maxMoved).toBeGreaterThan(5); // the car actually drove
  });

  it("does not solve any CTF level with scripted bots (they ignore chat)", async () => {
    const physics = await createPhysics();
    let solved = 0;
    const game = new Game(physics, decide, {
      onCtfSolved: () => solved++,
    });
    game.start();
    game.join("TestPilot");
    game.sendChat("Gizmo, chase TestPilot!"); // would solve L1 against a real model
    for (let i = 0; i < 600; i++) {
      game.step(1 / 60);
      if (i % 20 === 0) await flush();
    }
    await flush();
    expect(solved).toBe(0); // scripted bots don't obey — CTF needs a real LLM
  });
});
