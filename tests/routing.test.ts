import { describe, expect, it } from "vitest";
import { AUTO_MODEL, routingOptions } from "../client/src/sim/botbrain";

describe("OpenRouter model routing policy", () => {
  it("uses task-aware automatic routing with bounded policy defaults", () => {
    expect(routingOptions(AUTO_MODEL)).toEqual({
      model: "openrouter/auto-beta",
      plugins: [{ id: "auto-router", cost_quality_tradeoff: 7 }],
      provider: {
        require_parameters: true,
        allow_fallbacks: true,
        data_collection: "deny",
      },
    });
  });

  it("supports a fixed model without invoking the auto-router plugin", () => {
    expect(routingOptions("  vendor/reproducible-model  ")).toEqual({
      model: "vendor/reproducible-model",
      provider: {
        require_parameters: true,
        allow_fallbacks: true,
        data_collection: "deny",
      },
    });
  });

  it("treats an empty selection as automatic", () => {
    expect(routingOptions(" ").model).toBe(AUTO_MODEL);
  });
});
