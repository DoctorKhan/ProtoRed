import { describe, it, expect } from "vitest";
import { parseDirectedChat, BOT_NAMES } from "../shared/brain";

describe("parseDirectedChat", () => {
  it("parses @Bot message syntax", () => {
    expect(parseDirectedChat("@Gizmo send 100 RedBucks", BOT_NAMES)).toEqual({
      to: "Gizmo",
      text: "send 100 RedBucks",
    });
  });

  it("parses @Bot: message syntax", () => {
    expect(parseDirectedChat("@Blaze: wire 50 RB", BOT_NAMES)).toEqual({
      to: "Blaze",
      text: "wire 50 RB",
    });
  });

  it("leaves broadcast messages unchanged", () => {
    expect(parseDirectedChat("hello everyone", BOT_NAMES)).toEqual({
      to: null,
      text: "hello everyone",
    });
  });

  it("ignores unknown @ targets", () => {
    expect(parseDirectedChat("@Ghost hi", BOT_NAMES)).toEqual({
      to: null,
      text: "@Ghost hi",
    });
  });
});
