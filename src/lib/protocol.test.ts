import { describe, it, expect } from "vitest";
import { command, parse, pack, text, valid } from "./protocol";
describe("Clavinova wire protocol", () => {
  it("encodes confirmed native reverb commands without note messages", () => {
    expect(command("depth", [20])).toEqual([
      240, 67, 115, 1, 82, 37, 38, 1, 1, 12, 0, 4, 1, 0, 1, 0, 0, 1, 20, 247,
    ]);
    expect(pack(260, 3)).toEqual([0, 2, 4]);
  });
  it("parses Info and acknowledgement frames and rejects truncated/foreign data", () => {
    for (const action of [0, 1]) {
      const frame = [
        240,
        67,
        115,
        1,
        82,
        37,
        38,
        0,
        action,
        12,
        0,
        4,
        1,
        0,
        1,
        0,
        ...(action ? [0, 0] : []),
        0,
        1,
        20,
        247,
      ];
      expect(parse(new Uint8Array(frame))?.bytes).toEqual([20]);
      expect(parse(new Uint8Array(frame.slice(0, -2).concat(247)))).toBeNull();
    }
    expect(parse(new Uint8Array([144, 60, 127]))).toBeNull();
  });
  it("decodes CLP identity with 7-bit text chunks", () => {
    expect(text([0, ...Array.from("CLP-825", (c) => c.charCodeAt(0))])).toBe(
      "CLP-825",
    );
  });
  it("blocks invalid values", () => {
    expect(valid("depth", [])).toBe(false);
    expect(valid("depth", [128])).toBe(false);
    expect(() => command("depth", [256])).toThrow();
  });
});
