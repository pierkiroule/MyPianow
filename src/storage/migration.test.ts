import "fake-indexeddb/auto";
import { openDB } from "idb";
import { it, expect } from "vitest";
import { database, readPcm, readMidi } from "../lib/storage";
import { cloneFx, PRESETS, type Take } from "../lib/types";
it("migrates an existing v2 audio/MIDI library without changing original samples or IDs", async () => {
  const old = await openDB("mypianow", 2, {
    upgrade(db) {
      db.createObjectStore("takes", { keyPath: "id" });
      const chunks = db.createObjectStore("chunks", {
        keyPath: ["takeId", "index"],
      });
      chunks.createIndex("by-take", "takeId");
      const midi = db.createObjectStore("midi", {
        keyPath: ["takeId", "index"],
      });
      midi.createIndex("by-take", "takeId");
    },
  });
  const take: Take = {
    id: "legacy",
    title: "Prise v2",
    created: 1,
    rate: 48000,
    frames: 2,
    channels: 1,
    status: "ready",
    fx: cloneFx(PRESETS.feutre),
    preset: "feutre",
  };
  await old.put("takes", take);
  await old.put("chunks", {
    takeId: take.id,
    index: 0,
    frames: 2,
    channels: [new Float32Array([0.123, -0.456]).buffer],
  });
  await old.put("midi", {
    takeId: take.id,
    index: 0,
    timeMs: 20,
    data: [144, 60, 80],
  });
  old.close();
  const pcm = await readPcm(take);
  expect(pcm.channels[0][0]).toBeCloseTo(0.123);
  expect(pcm.channels[0][1]).toBeCloseTo(-0.456);
  expect((await readMidi(take.id))[0].data).toEqual([144, 60, 80]);
  const current = await database();
  expect(current.version).toBe(3);
  expect((await current.get("takes", take.id))!.title).toBe("Prise v2");
  expect(current.objectStoreNames.contains("assets")).toBe(true);
});
