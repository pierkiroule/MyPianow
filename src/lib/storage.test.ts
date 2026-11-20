import "fake-indexeddb/auto";
import { beforeAll, describe, it, expect } from "vitest";
import {
  saveTake,
  saveChunk,
  readPcm,
  recoverTakes,
  listTakes,
  deleteTake,
  saveMidiBatch,
  readMidi,
} from "./storage";
import { PRESETS, type Take } from "./types";
beforeAll(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
  });
});
describe("local take recovery", () => {
  it("recovers committed chunks after interrupted capture, ordered and without claiming missing audio", async () => {
    const take: Take = {
      id: "recovery",
      title: "Test",
      created: 1,
      rate: 48000,
      channels: 1,
      frames: 0,
      status: "recording",
      fx: PRESETS.naturel,
      preset: "naturel",
    };
    await saveTake(take);
    await saveChunk({
      takeId: take.id,
      index: 1,
      channels: [new Float32Array([0.3]).buffer],
      frames: 1,
    });
    await saveChunk({
      takeId: take.id,
      index: 0,
      channels: [new Float32Array([0.1, 0.2]).buffer],
      frames: 2,
    });
    take.midi = { name: "USB MIDI", eventCount: 0, offsetMs: 0 };
    await saveTake(take);
    await saveMidiBatch([
      { takeId: take.id, index: 1, timeMs: 100, data: [0xb0, 64, 80] },
      { takeId: take.id, index: 0, timeMs: 90, data: [0x90, 60, 100] },
    ]);
    await recoverTakes();
    const recovered = (await listTakes()).find((t) => t.id === take.id)!;
    expect(recovered.status).toBe("interrupted");
    expect(recovered.frames).toBe(3);
    expect(recovered.midi?.eventCount).toBe(2);
    expect((await readMidi(take.id))[0].index).toBe(0);
    const pcm = await readPcm(recovered);
    expect(Array.from(pcm.channels[0])).toEqual(
      expect.arrayContaining([
        expect.closeTo(0.1),
        expect.closeTo(0.2),
        expect.closeTo(0.3),
      ]),
    );
    expect(pcm.channels[0][0]).toBeCloseTo(0.1);
    await deleteTake(take.id);
    expect((await listTakes()).find((t) => t.id === take.id)).toBeUndefined();
    await expect(readPcm(take)).rejects.toThrow();
    expect(await readMidi(take.id)).toEqual([]);
  });
  it("does not recover a recording owned by another tab", async () => {
    const take: Take = {
      id: "active",
      title: "Active",
      created: 2,
      rate: 48000,
      channels: 1,
      frames: 0,
      status: "recording",
      fx: PRESETS.naturel,
      preset: "naturel",
    };
    await saveTake(take);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        locks: {
          request: async (
            _name: string,
            _opts: unknown,
            fn: (lock: null) => Promise<void>,
          ) => fn(null),
        },
      },
    });
    await recoverTakes();
    expect((await listTakes()).find((t) => t.id === "active")?.status).toBe(
      "recording",
    );
    await deleteTake("active");
  });
});
