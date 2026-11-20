export type Pcm = { channels: Float32Array[]; rate: number };
export type Preset = "naturel" | "feutre" | "ample";
export type EqBand = {
  type: "lowshelf" | "peaking" | "highshelf";
  frequency: number;
  q: number;
  gain: number;
};
export type Fx = {
  bands?: EqBand[];
  width?: number;
  autoLevel?: boolean;
  targetRms?: number;
  ceiling?: number;
  bass: number;
  mid: number;
  treble: number;
  gain: number;
  compression: number;
  room: number;
  cutoff: number;
};
export type Take = {
  id: string;
  title: string;
  created: number;
  rate: number;
  channels: number;
  frames: number;
  status: "recording" | "ready" | "interrupted";
  capture?: {
    source: string;
    inputLatency?: number;
    audioStartMs?: number;
    clock: "estimated";
  };
  midi?: {
    name: string;
    eventCount: number;
    offsetMs: number;
    interrupted?: boolean;
  };
  native?: { model: string; effect?: number; depth?: number };
  fx: Fx;
  preset: Preset;
};
export type Chunk = {
  takeId: string;
  index: number;
  channels: ArrayBuffer[];
  frames: number;
};
export const PRESETS: Record<Preset, Fx> = {
  naturel: {
    bass: 0,
    mid: 0,
    treble: 0,
    gain: 0,
    compression: 10,
    room: 0,
    cutoff: 19000,
  },
  feutre: {
    bass: 1.5,
    mid: -1,
    treble: -7,
    gain: 1,
    compression: 25,
    room: 5,
    cutoff: 5500,
  },
  ample: {
    bass: 1,
    mid: -1.5,
    treble: 1.5,
    gain: 0.5,
    compression: 30,
    room: 14,
    cutoff: 19000,
  },
};

for (const [preset, fx] of Object.entries(PRESETS)) {
  fx.bands = [
    { type: "lowshelf", frequency: 120, q: 0.707, gain: fx.bass },
    { type: "peaking", frequency: 300, q: 0.8, gain: 0 },
    { type: "peaking", frequency: 900, q: 0.7, gain: fx.mid },
    { type: "peaking", frequency: 2500, q: 1, gain: 0 },
    { type: "highshelf", frequency: 5000, q: 0.707, gain: fx.treble },
  ];
  fx.bass = fx.mid = fx.treble = 0;
  fx.width = preset === "ample" ? 120 : preset === "feutre" ? 90 : 100;
  fx.autoLevel = true;
  fx.targetRms = preset === "ample" ? -18 : -20;
  fx.ceiling = -1;
}
export const cloneFx = (fx: Fx): Fx => structuredClone(fx);

export type MidiPacket = {
  takeId: string;
  index: number;
  timeMs: number;
  data: number[];
};
