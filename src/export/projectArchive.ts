import { database, readPcm, readMidi } from "../storage/database";
import type { Take, Fx, MidiPacket } from "../lib/types";
import { PRESETS } from "../lib/types";
import { projectAssets } from "../storage/projects";
import {
  validateProject,
  type LoopProject,
  type SampleAsset,
} from "../engine/loopPad/types";
const MAGIC = "MYPW0001",
  MAX = 256 * 1024 * 1024;
type Entry = {
  key: string;
  channel: number;
  rate: number;
  frames: number;
  length: number;
  hash: string;
};
type Manifest = {
  version: 1;
  project?: LoopProject;
  take?: Take;
  events: MidiPacket[];
  assets: Omit<SampleAsset, "channels">[];
  entries: Entry[];
};
const digest = async (buffer: ArrayBuffer) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
export function validateFx(fx: Fx) {
  if (
    !fx ||
    ![
      fx.bass,
      fx.mid,
      fx.treble,
      fx.gain,
      fx.compression,
      fx.room,
      fx.cutoff,
    ].every(Number.isFinite) ||
    Math.abs(fx.gain) > 24 ||
    Math.abs(fx.bass) > 24 ||
    Math.abs(fx.mid) > 24 ||
    Math.abs(fx.treble) > 24 ||
    fx.compression < 0 ||
    fx.compression > 100 ||
    fx.room < 0 ||
    fx.room > 100 ||
    fx.cutoff < 20 ||
    fx.cutoff > 24000
  )
    throw Error("Chaîne d’effets invalide.");
  if (fx.autoLevel !== undefined && typeof fx.autoLevel !== "boolean")
    throw Error("Niveau automatique invalide.");
  if (
    fx.bands &&
    (!Array.isArray(fx.bands) ||
      fx.bands.length > 12 ||
      fx.bands.some(
        (b) =>
          !["lowshelf", "peaking", "highshelf"].includes(b.type) ||
          ![b.frequency, b.q, b.gain].every(Number.isFinite) ||
          b.frequency < 20 ||
          b.frequency > 24000 ||
          b.q < 0.1 ||
          b.q > 8 ||
          Math.abs(b.gain) > 12,
      ))
  )
    throw Error("Égaliseur invalide.");
  for (const [key, min, max] of [
    ["width", 0, 150],
    ["targetRms", -40, -8],
    ["ceiling", -12, 0],
    ["warmth", 0, 100],
  ] as const)
    if (
      fx[key] !== undefined &&
      (!Number.isFinite(fx[key]) || fx[key]! < min || fx[key]! > max)
    )
      throw Error("Paramètre DSP invalide.");
  if (
    fx.localEq &&
    (!Array.isArray(fx.localEq) ||
      fx.localEq.length > 5000 ||
      fx.localEq.some(
        (point) =>
          !Number.isFinite(point.time) ||
          point.time < 0 ||
          point.time > 610 ||
          !Number.isFinite(point.gain) ||
          Math.abs(point.gain) > 3,
      ))
  )
    throw Error("Automatisation invalide.");
}
export async function exportProject(
  project: LoopProject | undefined,
  take?: Take,
): Promise<Blob> {
  if (take?.status === "recording")
    throw Error("Termine la prise avant la sauvegarde.");
  const projects = [project, take?.accompaniment?.project].filter(
    (p): p is LoopProject => !!p,
  );
  const assets = new Map<string, SampleAsset>();
  for (const p of projects)
    for (const asset of await projectAssets(p)) assets.set(asset.id, asset);
  const entries: Entry[] = [],
    buffers: ArrayBuffer[] = [];
  async function append(
    key: string,
    rate: number,
    channels: ArrayBuffer[],
    frames: number,
  ) {
    for (let channel = 0; channel < channels.length; channel++) {
      const buffer = channels[channel];
      entries.push({
        key,
        channel,
        rate,
        frames,
        length: buffer.byteLength,
        hash: await digest(buffer),
      });
      buffers.push(buffer);
    }
  }
  if (take) {
    const pcm = await readPcm(take);
    await append(
      "take",
      pcm.rate,
      pcm.channels.map((c) => c.buffer as ArrayBuffer),
      pcm.channels[0].length,
    );
  }
  for (const asset of assets.values())
    await append(asset.id, asset.rate, asset.channels, asset.frames);
  const manifest: Manifest = {
    version: 1,
    project,
    take,
    events: take ? await readMidi(take.id) : [],
    assets: Array.from(
      assets.values(),
      ({ channels: _, ...metadata }) => metadata,
    ),
    entries,
  };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  if (json.byteLength > 16 * 1024 * 1024)
    throw Error("Métadonnées de projet trop volumineuses (16 Mo maximum).");
  const header = new ArrayBuffer(12);
  new Uint8Array(header).set(new TextEncoder().encode(MAGIC));
  new DataView(header).setUint32(8, json.byteLength, true);
  const blob = new Blob([header, json, ...buffers], {
    type: "application/x-mypianow",
  });
  if (blob.size > MAX)
    throw Error("Archive supérieure à 256 Mo. Exporte les prises séparément.");
  return blob;
}
export async function importProject(
  file: Blob,
): Promise<{ project?: LoopProject; take?: Take }> {
  if (file.size < 12 || file.size > MAX)
    throw Error("Taille d’archive invalide (256 Mo maximum).");
  const header = await file.slice(0, 12).arrayBuffer();
  if (new TextDecoder().decode(header.slice(0, 8)) !== MAGIC)
    throw Error("Ce fichier n’est pas une archive MyPianow.");
  const length = new DataView(header).getUint32(8, true);
  if (length < 2 || length > 16 * 1024 * 1024 || 12 + length > file.size)
    throw Error("En-tête d’archive invalide.");
  const manifest = JSON.parse(
    await file.slice(12, 12 + length).text(),
  ) as Manifest;
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length > 66 ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length > 32 ||
    !Array.isArray(manifest.events) ||
    manifest.events.length > 1000000 ||
    (!manifest.take && !manifest.project)
  )
    throw Error("Format de projet non pris en charge.");
  if (manifest.project) validateProject(manifest.project);
  const take = manifest.take;
  if (take) {
    if (
      typeof take.title !== "string" ||
      take.title.length > 200 ||
      !Number.isFinite(take.created) ||
      !Number.isInteger(take.rate) ||
      take.rate < 8000 ||
      take.rate > 192000 ||
      !Number.isInteger(take.frames) ||
      take.frames < 1 ||
      take.frames > take.rate * 600 ||
      ![1, 2].includes(take.channels) ||
      !Object.hasOwn(PRESETS, take.preset) ||
      !["ready", "interrupted"].includes(take.status)
    )
      throw Error("Prise invalide.");
    validateFx(take.fx);
    if (
      take.capture &&
      (take.capture.clock !== "estimated" ||
        typeof take.capture.source !== "string" ||
        (take.capture.audioStartMs !== undefined &&
          !Number.isFinite(take.capture.audioStartMs)))
    )
      throw Error("Horloge de prise invalide.");
    if (
      take.midi &&
      (!Number.isFinite(take.midi.offsetMs) ||
        Math.abs(take.midi.offsetMs) > 10000)
    )
      throw Error("Décalage MIDI invalide.");
    if (take.accompaniment) {
      validateProject(take.accompaniment.project);
      if (
        take.accompaniment.adjustmentMs !== undefined &&
        (!Number.isFinite(take.accompaniment.adjustmentMs) ||
          Math.abs(take.accompaniment.adjustmentMs) > 500)
      )
        throw Error("Décalage d’accompagnement invalide.");
      if (
        !Number.isFinite(take.accompaniment.offsetSeconds) ||
        Math.abs(take.accompaniment.offsetSeconds) > 86400 ||
        typeof take.accompaniment.include !== "boolean"
      )
        throw Error("Calage d’accompagnement invalide.");
    }
  }
  const assetIds = new Set<string>();
  for (const a of manifest.assets) {
    if (
      typeof a.id !== "string" ||
      a.id === "take" ||
      assetIds.has(a.id) ||
      typeof a.name !== "string" ||
      a.name.length > 120 ||
      !Number.isInteger(a.rate) ||
      a.rate < 8000 ||
      a.rate > 192000 ||
      !Number.isInteger(a.frames) ||
      a.frames < 1 ||
      a.frames > a.rate * 12
    )
      throw Error("Sample invalide.");
    assetIds.add(a.id);
  }
  const decoded = new Map<string, Map<number, ArrayBuffer>>();
  let offset = 12 + length;
  for (const entry of manifest.entries) {
    if (
      ![0, 1].includes(entry.channel) ||
      !Number.isInteger(entry.frames) ||
      entry.frames < 1 ||
      entry.length !== entry.frames * 4 ||
      offset + entry.length > file.size ||
      !(entry.key === "take" ? take : assetIds.has(entry.key))
    )
      throw Error("Bloc audio invalide.");
    const expected =
      entry.key === "take"
        ? take!
        : manifest.assets.find((a) => a.id === entry.key)!;
    if (entry.rate !== expected.rate || entry.frames !== expected.frames)
      throw Error("Métadonnées audio incohérentes.");
    const bytes = await file.slice(offset, offset + entry.length).arrayBuffer();
    offset += entry.length;
    if ((await digest(bytes)) !== entry.hash)
      throw Error("Archive endommagée : empreinte audio différente.");
    if (new Float32Array(bytes).some((value) => !Number.isFinite(value)))
      throw Error("Audio non fini dans l’archive.");
    const channels = decoded.get(entry.key) || new Map<number, ArrayBuffer>();
    if (channels.has(entry.channel)) throw Error("Canal dupliqué.");
    channels.set(entry.channel, bytes);
    decoded.set(entry.key, channels);
  }
  if (offset !== file.size)
    throw Error("Données supplémentaires dans l’archive.");
  function channels(key: string, count?: number) {
    const data = decoded.get(key);
    if (
      !data ||
      !data.has(0) ||
      (count !== undefined && data.size !== count) ||
      (data.size === 2 && !data.has(1))
    )
      throw Error("Canal audio manquant.");
    return Array.from({ length: data.size }, (_, i) => data.get(i)!);
  }
  const remap = new Map(
    Array.from(assetIds, (id) => [id, crypto.randomUUID()]),
  );
  function project(p: LoopProject): LoopProject {
    return {
      ...p,
      id: crypto.randomUUID(),
      updated: Date.now(),
      tracks: p.tracks.map((t) => {
        if (t.assetId && !remap.has(t.assetId))
          throw Error("Référence de sample manquante.");
        return { ...t, assetId: t.assetId ? remap.get(t.assetId) : undefined };
      }),
    };
  }
  const importedProject = manifest.project
    ? project(manifest.project)
    : undefined;
  const importedTake = take
    ? {
        ...take,
        id: crypto.randomUUID(),
        accompaniment: take.accompaniment
          ? {
              ...take.accompaniment,
              project: project(take.accompaniment.project),
            }
          : undefined,
      }
    : undefined;
  const events = manifest.events.map((event, index) => {
    if (
      !importedTake ||
      !Number.isFinite(event.timeMs) ||
      !Array.isArray(event.data) ||
      ![2, 3].includes(event.data.length) ||
      event.data.some((v) => !Number.isInteger(v) || v < 0 || v > 255) ||
      event.data[0] < 128 ||
      event.data[0] >= 240 ||
      event.data.slice(1).some((v) => v > 127)
    )
      throw Error("Événement MIDI invalide.");
    return { ...event, takeId: importedTake.id, index };
  });
  const assets = manifest.assets.map((a) => ({
    ...a,
    id: remap.get(a.id)!,
    channels: channels(a.id),
  }));
  const pcm = importedTake
    ? channels("take", importedTake.channels)
    : undefined;
  const tx = (await database()).transaction(
    ["projects", "assets", "takes", "chunks", "midi"],
    "readwrite",
  );
  try {
    if (importedProject) await tx.objectStore("projects").put(importedProject);
    for (const asset of assets) await tx.objectStore("assets").put(asset);
    if (importedTake && pcm) {
      if (importedTake.midi) importedTake.midi.eventCount = events.length;
      await tx.objectStore("takes").put(importedTake);
      for (
        let frame = 0, index = 0;
        frame < importedTake.frames;
        frame += 4096, index++
      ) {
        const frames = Math.min(4096, importedTake.frames - frame);
        await tx.objectStore("chunks").put({
          takeId: importedTake.id,
          index,
          frames,
          channels: pcm.map((c) => c.slice(frame * 4, (frame + frames) * 4)),
        });
      }
      for (const event of events) await tx.objectStore("midi").put(event);
    }
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
  return { project: importedProject, take: importedTake };
}
