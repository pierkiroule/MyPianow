import { describe, it, expect } from "vitest";
import { protectPeak, applyWidth } from "./effects";
import { isUsb, constraints } from "./recorder";
import { encodeWav } from "./wav";
import { PRESETS, cloneFx } from "./types";
import { Mp3Encoder } from "@breezystack/lamejs";
describe("audio integrity", () => {
  it("never opens default or an internal source", () => {
    expect(isUsb({ deviceId: "default", label: "USB audio" })).toBe(false);
    expect(isUsb({ deviceId: "i", label: "Speakerphone" })).toBe(false);
    expect(isUsb({ deviceId: "u", label: "USB audio" })).toBe(true);
    expect(constraints("u")).toMatchObject({
      audio: {
        deviceId: { exact: "u" },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  });
  it("exports true mono WAV24 with padded RIFF size", async () => {
    const b = await encodeWav({
      channels: [new Float32Array([0.5])],
      rate: 48000,
    });
    const d = new DataView(await b.arrayBuffer());
    expect(d.byteLength).toBe(48);
    expect(d.getUint16(22, true)).toBe(1);
    expect(d.getUint16(34, true)).toBe(24);
    expect(d.getUint32(40, true)).toBe(3);
    expect(d.getUint8(46)).toBe(64);
  });
  it("preserves silence and bounds mastering sample peaks", () => {
    const a = [new Float32Array([2, -3, 0])];
    protectPeak(a, { ...PRESETS.ample, ceiling: -1 });
    expect(Math.max(...a[0].map(Math.abs))).toBeLessThanOrEqual(0.891251);
    const silent = [new Float32Array(64)];
    protectPeak(silent, PRESETS.ample);
    expect(silent[0].every((v) => v === 0)).toBe(true);
    expect(() => protectPeak([new Float32Array([NaN])])).toThrow();
  });
  it("mid-side width is identity at 100%, mono at 0%, and leaves mono sources intact", () => {
    const a = [new Float32Array([1, 0.2]), new Float32Array([0, 0.6])];
    applyWidth(a, 100);
    expect(a[0][0]).toBe(1);
    expect(a[1][0]).toBe(0);
    applyWidth(a, 0);
    expect(a[0][0]).toBe(0.5);
    expect(a[1][0]).toBe(0.5);
    const mono = [new Float32Array([0.4])];
    applyWidth(mono, 150);
    expect(mono[0][0]).toBeCloseTo(0.4);
  });
  it("presets can be customised without changing the defaults", () => {
    const copy = cloneFx(PRESETS.feutre);
    copy.bands![0].gain = 10;
    expect(PRESETS.feutre.bands![0].gain).not.toBe(10);
  });
  it("encodes an actual MP3 stream", () => {
    const encoder = new Mp3Encoder(1, 48000, 320);
    const samples = Int16Array.from({ length: 4800 }, (_, i) =>
      Math.round(Math.sin((i * 2 * Math.PI * 440) / 48000) * 8000),
    );
    const part = encoder.encodeBuffer(samples),
      tail = encoder.flush();
    const all = new Uint8Array([...part, ...tail]);
    expect(all.length).toBeGreaterThan(1000);
    expect(
      Array.from(all).some((b, i) => b === 255 && (all[i + 1] & 224) === 224),
    ).toBe(true);
  });
});
