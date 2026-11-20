import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { newProject } from "../engine/loopPad/types";
import { saveAsset, saveProject, projectAssets } from "./projects";
import {
  saveTake,
  saveChunk,
  saveMidiBatch,
  readPcm,
  readMidi,
  listTakes,
  database,
} from "../lib/storage";
import { exportProject, importProject } from "../export/projectArchive";
import { exportMidi } from "../export/midi";
import { cloneFx, PRESETS, type Take } from "../lib/types";
async function fixture() {
  const project = newProject(),
    asset = await saveAsset("Sample", {
      rate: 44100,
      channels: [new Float32Array([0.1, 0.2, -0.3])],
    });
  project.tracks[0].assetId = asset.id;
  project.tracks[0].steps[0] = true;
  await saveProject(project);
  const take: Take = {
    id: crypto.randomUUID(),
    title: "Original",
    created: 1,
    rate: 48000,
    channels: 1,
    frames: 8192,
    status: "ready",
    preset: "intime",
    fx: cloneFx(PRESETS.intime),
    capture: { source: "Clavinova", clock: "estimated", audioStartMs: 1000 },
    midi: { name: "MIDI", eventCount: 2, offsetMs: 20 },
    accompaniment: { project, offsetSeconds: 0.2, include: false },
  };
  await saveTake(take);
  for (let index = 0; index < 2; index++)
    await saveChunk({
      takeId: take.id,
      index,
      frames: 4096,
      channels: [new Float32Array(4096).fill(index ? 0.2 : 0.1).buffer],
    });
  await saveMidiBatch([
    { takeId: take.id, index: 0, timeMs: 1020, data: [144, 60, 80] },
    { takeId: take.id, index: 1, timeMs: 1100, data: [128, 60, 0] },
  ]);
  return { project, take };
}
describe("portable local projects", () => {
  it("round-trips original audio, MIDI timing, samples and non-destructive settings with new IDs", async () => {
    const { project, take } = await fixture(),
      blob = await exportProject(project, take),
      imported = await importProject(blob);
    expect(imported.take!.id).not.toBe(take.id);
    expect(imported.project!.id).not.toBe(project.id);
    expect(imported.take!.fx).toEqual(take.fx);
    expect(imported.take!.accompaniment!.offsetSeconds).toBe(0.2);
    expect((await readPcm(imported.take!)).channels[0]).toEqual(
      (await readPcm(take)).channels[0],
    );
    expect((await readMidi(imported.take!.id)).map((e) => e.timeMs)).toEqual([
      1020, 1100,
    ]);
    const samples = await projectAssets(imported.project!);
    expect(samples[0].id).not.toBe(project.tracks[0].assetId);
    expect(new Float32Array(samples[0].channels[0])[2]).toBeCloseTo(-0.3);
    const midi = new DataView(
      await exportMidi(
        await readMidi(imported.take!.id),
        imported.take!,
      ).arrayBuffer(),
    );
    expect(midi.getUint32(0)).toBe(0x4d546864);
    expect(midi.getUint16(12)).toBe(960);
    expect(midi.getUint32(18)).toBe(midi.byteLength - 22);
  });
  it("rejects damaged PCM and unsupported archives without adding takes", async () => {
    const { project, take } = await fixture(),
      blob = await exportProject(project, take),
      bytes = new Uint8Array(await blob.arrayBuffer());
    bytes[bytes.length - 1] ^= 1;
    const before = (await listTakes()).length;
    await expect(importProject(new Blob([bytes]))).rejects.toThrow("empreinte");
    await expect(importProject(new Blob(["not an archive"]))).rejects.toThrow();
    expect((await listTakes()).length).toBe(before);
  });
  it("rolls back samples, project and take if storage fails during PCM import", async () => {
    const { project, take } = await fixture(),
      archive = await exportProject(project, take),
      db = await database();
    const before = {
      takes: (await db.getAll("takes")).length,
      projects: (await db.getAll("projects")).length,
      assets: (await db.getAll("assets")).length,
    };
    const original = IDBObjectStore.prototype.put;
    const mock = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        ...args: unknown[]
      ) {
        if (this.name === "chunks" && (value as { index: number }).index === 1)
          throw new DOMException("Full", "QuotaExceededError");
        return original.call(this, value, ...(args as []));
      });
    try {
      await expect(importProject(archive)).rejects.toThrow("Full");
    } finally {
      mock.mockRestore();
    }
    expect((await db.getAll("takes")).length).toBe(before.takes);
    expect((await db.getAll("projects")).length).toBe(before.projects);
    expect((await db.getAll("assets")).length).toBe(before.assets);
  });
});
