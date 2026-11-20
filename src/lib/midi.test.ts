import { describe, it, expect } from "vitest";
import { channelMessage, midiTime, midiSeconds, noteTimeline } from "./midi";
import { PRESETS, type Take, type MidiPacket } from "./types";
const take: Take = {
  id: "m",
  title: "Test",
  created: 0,
  rate: 48000,
  channels: 1,
  frames: 96000,
  status: "ready",
  fx: PRESETS.naturel,
  preset: "naturel",
  capture: { source: "USB", clock: "estimated", audioStartMs: 1000 },
  midi: { name: "Piano", eventCount: 0, offsetMs: 20 },
};
const packet = (index: number, timeMs: number, data: number[]): MidiPacket => ({
  takeId: "m",
  index,
  timeMs,
  data,
});
describe("passive MIDI performance capture", () => {
  it("ignores SysEx and real-time traffic, preserves continuous pedal values", () => {
    expect(channelMessage(new Uint8Array([0xf0, 67, 0xf7]))).toBeNull();
    expect(channelMessage(new Uint8Array([0xf8]))).toBeNull();
    expect(channelMessage(new Uint8Array([0xb0, 64, 55]))).toEqual([
      0xb0, 64, 55,
    ]);
    expect(channelMessage(new Uint8Array([0xc0, 12]))).toEqual([0xc0, 12]);
    expect(channelMessage(new Uint8Array([0x90, 60, 255]))).toBeNull();
  });
  it("uses a common clock without claiming hardware latency compensation", () => {
    expect(midiTime(1700000000200, 500, 1700000000000)).toBe(200);
    expect(midiTime(700, 500, 0)).toBe(700);
    expect(midiTime(NaN, 500, 0)).toBe(500);
    expect(midiSeconds(packet(0, 1080, [0x90, 60, 80]), take)).toBeCloseTo(0.1);
    expect(
      midiSeconds(packet(0, 1080, []), { ...take, capture: undefined }),
    ).toBeNull();
  });
  it("pairs overlapping keys per channel, treats velocity zero as release and marks missing releases", () => {
    const events = [
      packet(0, 1000, [0x90, 60, 90]),
      packet(1, 1100, [0x91, 60, 40]),
      packet(2, 1200, [0x90, 60, 50]),
      packet(3, 1300, [0x90, 60, 0]),
      packet(4, 1400, [0x80, 60, 0]),
    ];
    const original = structuredClone(events);
    const notes = noteTimeline(events, take);
    expect(notes).toHaveLength(3);
    expect(notes[0].end).toBeCloseTo(0.32);
    expect(notes[1].start).toBeCloseTo(0.22);
    expect(notes[2].truncated).toBe(true);
    expect(notes[2].end).toBe(2);
    expect(events).toEqual(original);
  });
});
