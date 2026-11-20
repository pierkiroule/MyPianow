import { rmsOverWindow } from "./level";
import { describe, it, expect } from "vitest";
import { analyze } from "./analyze";
import { stereoEvidence } from "./stereo";
import { proposeMastering, candidateScore } from "../mastering/plan";
import { cloneFx, PRESETS, type Take, type MidiPacket } from "../../lib/types";
const rate = 48000;
const take: Take = {
  id: "analysis",
  title: "A",
  created: 0,
  rate,
  frames: rate * 2,
  channels: 1,
  status: "ready",
  fx: cloneFx(PRESETS.studio),
  preset: "studio",
  capture: { source: "Yamaha", clock: "estimated", audioStartMs: 1000 },
  midi: { name: "MIDI", offsetMs: 0, eventCount: 0 },
};
describe("bounded algorithmic mastering", () => {
  it("measures level, local contrast and MIDI chords without modifying PCM", () => {
    const signal = Float32Array.from(
        { length: rate * 2 },
        (_, i) =>
          Math.sin((2 * Math.PI * 80 * i) / rate) * (i < rate ? 0.02 : 0.2),
      ),
      before = signal.slice();
    const packets: MidiPacket[] = [
      [1000, [176, 64, 127]],
      [1060, [144, 40, 30]],
      [1070, [144, 47, 40]],
      [1080, [144, 52, 90]],
      [2100, [144, 64, 110]],
    ].map((row, index) => ({
      takeId: take.id,
      index,
      timeMs: row[0] as number,
      data: row[1] as number[],
    }));
    const report = analyze({ rate, channels: [signal] }, packets, take);
    expect(report.dynamicRangeDb).toBeGreaterThan(18);
    expect(report.midi.notes).toBe(4);
    expect(report.windows[0].chord).toBe(3);
    expect(report.windows[0].pedal).toBe(127);
    const original = cloneFx(take.fx),
      proposal = proposeMastering(report, take.fx);
    expect(proposal.compression).toBeLessThanOrEqual(18);
    expect(proposal.localEq?.[0].gain).toBeLessThan(0);
    expect(
      proposal.localEq?.every((point) => Math.abs(point.gain) <= 1.5),
    ).toBe(true);
    expect(take.fx).toEqual(original);
    expect(signal).toEqual(before);
    expect(
      candidateScore(report, { ...report, dynamicRangeDb: 0 }, -20),
    ).toBeGreaterThan(candidateScore(report, report, -20));
  });
  it("does not invent MIDI or stereo evidence for mono silence", () => {
    const pcm = { rate, channels: [new Float32Array(1000)] };
    const report = analyze(pcm);
    expect(report.midi.notes).toBe(0);
    expect(report.midi.alignment).toBe("missing");
    expect(report.correlation).toBeNull();
    expect(
      proposeMastering(report, cloneFx(PRESETS.naturel)).localEq,
    ).toBeUndefined();
    expect(stereoEvidence(pcm).silent).toBe(true);
  });
  it("distinguishes duplicated channels, independent content and polarity inversion", () => {
    const a = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i * 0.1)),
      b = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i * 0.19));
    expect(stereoEvidence({ rate, channels: [a, a] }).duplicated).toBe(true);
    expect(stereoEvidence({ rate, channels: [a, b] }).duplicated).toBe(false);
    expect(
      stereoEvidence({ rate, channels: [a, a.map((v) => -v)] }).correlation,
    ).toBeCloseTo(-1);
  });
});

it("matches comparison levels on the same musical interval rather than diluting RMS with the reverb tail", () => {
  const original = {
    rate: 48000,
    channels: [new Float32Array(1000).fill(0.1)],
  };
  const processed = { rate: 48000, channels: [new Float32Array(10000)] };
  processed.channels[0].fill(0.2, 0, 1000);
  const source = rmsOverWindow(original),
    master = rmsOverWindow(processed, 1000);
  expect(master / source).toBeCloseTo(2);
  expect(master).toBeCloseTo(0.2);
  expect(rmsOverWindow(processed)).toBeLessThan(source);
});
