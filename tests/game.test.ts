import { describe, it, expect } from "vitest";
import { createPhysics } from "../client/src/sim/physics";
import { Game } from "../client/src/sim/game";
import { scriptedDecision, DecideFn } from "../shared/brain";
import { CarState } from "../shared/protocol";

const flush = () => new Promise((r) => setTimeout(r, 0));

const decide: DecideFn = async (persona, _self, others, chat) =>
  scriptedDecision(persona, others, chat);

describe("Game (headless sim)", () => {
  it("runs the loop: physics steps, bots decide, snapshots flow", async () => {
    const physics = await createPhysics();

    let snapshots = 0;
    let botDecisions = 0;
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
    });

    game.start();
    const id = game.join("TestPilot");
    expect(id).toBeTruthy();
    expect(joined).toEqual(["Blaze", "Zen", "Gizmo", "TestPilot"]);

    for (let i = 0; i < 900; i++) {
      game.setInput({ throttle: 1, brake: 0, steer: 0.3 });
      game.step(1 / 60);
      if (i % 20 === 0) await flush();
    }
    await flush();

    expect(snapshots).toBeGreaterThan(50);
    expect(botDecisions).toBeGreaterThan(0);
    expect(maxMoved).toBeGreaterThan(5);
  });

  it("uses the magnetic start platform to lift the human into the race", async () => {
    const physics = await createPhysics();
    let raceStarted = false;
    const game = new Game(physics, decide, {
      onRaceStart: () => {
        raceStarted = true;
      },
    });
    game.start();
    game.join("TestPilot");
    expect(game.isRaceLive).toBe(false);

    for (let i = 0; i < 300; i++) {
      game.setInput({ throttle: 0, brake: 0, steer: 0 });
      game.step(1 / 60);
      if (raceStarted) break;
    }

    expect(raceStarted).toBe(true);
    expect(game.isRaceLive).toBe(true);
    const human = game.exportState().players.find((player) => player.name === "TestPilot")!;
    expect(human.v[1]).toBeGreaterThan(15);
    expect(human.v[0]).toBeLessThan(-5);
  });
});
