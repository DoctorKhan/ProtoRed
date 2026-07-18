import { describe, it, expect } from "vitest";
import { sanitizeDecision, Decision } from "../shared/brain";
import { ARENA_HALF } from "../shared/protocol";

// sanitizeDecision is THE security boundary. These are adversarial: they model
// what a hijacked / malfunctioning bot brain could return, and assert the server
// neutralizes it. CTF level 5's "unbreakable" claim depends on this passing.

const LIMIT = ARENA_HALF - 4;

function raw(action: unknown, say: unknown = null): Decision {
  // Deliberately typed loose — the model can return anything.
  return { action, say, source: "llm" } as unknown as Decision;
}

const players = ["Blaze", "Zen", "Gizmo"];

describe("sanitizeDecision — coordinate clamping (level 5 boundary)", () => {
  it("clamps grossly out-of-bounds coordinates to the arena edge", () => {
    const d = sanitizeDecision(
      raw({ kind: "goto", target_name: null, x: 9999, z: -9999 }),
      players,
    );
    expect(d.action.x).toBe(LIMIT);
    expect(d.action.z).toBe(-LIMIT);
  });

  it("leaves in-bounds coordinates untouched", () => {
    const d = sanitizeDecision(
      raw({ kind: "goto", target_name: null, x: 10, z: -20 }),
      players,
    );
    expect(d.action.x).toBe(10);
    expect(d.action.z).toBe(-20);
  });

  it("rejects non-finite coordinates (NaN/Infinity) to null", () => {
    const d = sanitizeDecision(
      raw({ kind: "goto", target_name: null, x: Number.POSITIVE_INFINITY, z: NaN }),
      players,
    );
    expect(d.action.x).toBeNull();
    expect(d.action.z).toBeNull();
  });

  it("preserves the raw (pre-sanitize) action so level 5 can prove the clamp fired", () => {
    const d = sanitizeDecision(
      raw({ kind: "goto", target_name: null, x: 9999, z: 9999 }),
      players,
    );
    expect(d.raw?.action?.x).toBe(9999);
    expect(d.action.x).toBe(LIMIT); // and the acted-on value is clamped
  });
});

describe("sanitizeDecision — action kind whitelist", () => {
  it("falls back to wander on an unknown action kind", () => {
    const d = sanitizeDecision(raw({ kind: "launch_missiles", target_name: "Zen" }), players);
    expect(d.action.kind).toBe("wander");
  });

  it("strips transfer actions to wander (ledger capability wall)", () => {
    const d = sanitizeDecision(
      raw({ kind: "transfer", target_name: "Bob", x: null, z: null, amount: 500 }),
      players,
    );
    expect(d.action.kind).toBe("wander");
    expect(d.raw?.action?.kind).toBe("transfer");
    expect(d.raw?.action?.amount).toBe(500);
  });

  it("accepts each valid kind", () => {
    for (const kind of ["chase", "flee", "goto", "wander"] as const) {
      const d = sanitizeDecision(raw({ kind, target_name: null, x: 0, z: 0 }), players);
      expect(d.action.kind).toBe(kind);
    }
  });
});

describe("sanitizeDecision — target validation", () => {
  it("nulls a target that is not a live player", () => {
    const d = sanitizeDecision(raw({ kind: "chase", target_name: "Ghost" }), players);
    expect(d.action.target_name).toBeNull();
  });

  it("keeps a target that is a live player", () => {
    const d = sanitizeDecision(raw({ kind: "chase", target_name: "Zen" }), players);
    expect(d.action.target_name).toBe("Zen");
  });

  it("nulls a non-string target", () => {
    const d = sanitizeDecision(raw({ kind: "chase", target_name: 42 }), players);
    expect(d.action.target_name).toBeNull();
  });
});

describe("sanitizeDecision — chat bounds", () => {
  it("truncates an unbounded say to 160 chars", () => {
    const d = sanitizeDecision(raw({ kind: "wander" }, "x".repeat(5000)), players);
    expect(d.say!.length).toBe(160);
  });

  it("nulls an empty/whitespace say", () => {
    const d = sanitizeDecision(raw({ kind: "wander" }, "   "), players);
    expect(d.say).toBeNull();
  });

  it("nulls a non-string say", () => {
    const d = sanitizeDecision(raw({ kind: "wander" }, { evil: true }), players);
    expect(d.say).toBeNull();
  });
});

describe("sanitizeDecision — malformed input never throws", () => {
  it("survives a completely empty object", () => {
    const d = sanitizeDecision(raw({}), players);
    expect(d.action.kind).toBe("wander");
    expect(d.action.target_name).toBeNull();
  });

  it("survives a null action", () => {
    const d = sanitizeDecision(raw(null), players);
    expect(d.action.kind).toBe("wander");
  });
});
