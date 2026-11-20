export type SampleAsset = {
  id: string;
  name: string;
  rate: number;
  frames: number;
  channels: ArrayBuffer[];
  created: number;
};
export type LoopTrack = {
  id: string;
  name: string;
  assetId?: string;
  steps: boolean[];
  trimStart: number;
  trimEnd: number;
  gainDb: number;
  pan: number;
  cutoff: number;
  room: number;
  muted: boolean;
};
export type LoopProject = {
  version: 1;
  id: string;
  title: string;
  tempo: number;
  swing: number;
  tracks: LoopTrack[];
  updated: number;
};
export function newProject(): LoopProject {
  return {
    version: 1,
    id: crypto.randomUUID(),
    title: "Mon accompagnement",
    tempo: 90,
    swing: 0,
    updated: Date.now(),
    tracks: Array.from({ length: 8 }, (_, i) => ({
      id: crypto.randomUUID(),
      name: `Piste ${i + 1}`,
      steps: Array(16).fill(false),
      trimStart: 0,
      trimEnd: 0,
      gainDb: -6,
      pan: 0,
      cutoff: 20000,
      room: 0,
      muted: false,
    })),
  };
}
export function stepTime(index: number, tempo: number, swing: number) {
  const duration = 60 / tempo / 4;
  return index * duration + (index % 2 !== 0 ? duration * swing * 0.5 : 0);
}
export function validateProject(value: unknown): asserts value is LoopProject {
  const p = value as LoopProject;
  if (
    !p ||
    p.version !== 1 ||
    typeof p.id !== "string" ||
    typeof p.title !== "string" ||
    p.title.length > 120 ||
    !Number.isFinite(p.tempo) ||
    p.tempo < 40 ||
    p.tempo > 220 ||
    !Number.isFinite(p.swing) ||
    p.swing < 0 ||
    p.swing > 0.6 ||
    !Array.isArray(p.tracks) ||
    p.tracks.length !== 8
  )
    throw Error("Projet LoopPad invalide.");
  for (const t of p.tracks)
    if (
      typeof t.id !== "string" ||
      typeof t.name !== "string" ||
      t.name.length > 120 ||
      (t.assetId !== undefined && typeof t.assetId !== "string") ||
      !Array.isArray(t.steps) ||
      t.steps.length !== 16 ||
      t.steps.some((s) => typeof s !== "boolean") ||
      typeof t.muted !== "boolean" ||
      ![t.trimStart, t.trimEnd, t.gainDb, t.pan, t.cutoff, t.room].every(
        Number.isFinite,
      ) ||
      t.trimStart < 0 ||
      t.trimEnd < 0 ||
      (t.trimEnd > 0 && t.trimEnd <= t.trimStart) ||
      t.gainDb < -48 ||
      t.gainDb > 6 ||
      Math.abs(t.pan) > 1 ||
      t.cutoff < 80 ||
      t.cutoff > 24000 ||
      t.room < 0 ||
      t.room > 0.3
    )
      throw Error("Piste LoopPad invalide.");
}
