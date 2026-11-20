import { database } from "./database";
import {
  validateProject,
  type LoopProject,
  type SampleAsset,
} from "../engine/loopPad/types";
import type { Pcm } from "../lib/types";
export async function listProjects() {
  return (await (await database()).getAll("projects")).sort(
    (a, b) => b.updated - a.updated,
  );
}
export async function saveProject(project: LoopProject) {
  validateProject(project);
  await (await database()).put("projects", project);
}
export async function getAsset(id: string) {
  return (await database()).get("assets", id);
}
export async function projectAssets(project: LoopProject) {
  const ids = [
    ...new Set(project.tracks.flatMap((t) => (t.assetId ? [t.assetId] : []))),
  ];
  return Promise.all(
    ids.map(async (id) => {
      const asset = await getAsset(id);
      if (!asset) throw Error("Sample manquant : " + id);
      return asset;
    }),
  );
}
export async function saveAsset(name: string, pcm: Pcm): Promise<SampleAsset> {
  if (
    pcm.channels.length < 1 ||
    pcm.channels.length > 2 ||
    pcm.channels[0].length > pcm.rate * 12
  )
    throw Error("Sample limité à 12 secondes, mono ou stéréo.");
  const asset = {
    id: crypto.randomUUID(),
    name: name.slice(0, 120),
    rate: pcm.rate,
    frames: pcm.channels[0].length,
    channels: pcm.channels.map((c) => c.slice().buffer as ArrayBuffer),
    created: Date.now(),
  };
  await (await database()).put("assets", asset);
  return asset;
}
