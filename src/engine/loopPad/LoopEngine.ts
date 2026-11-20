import { impulse } from "../dsp/effects";
import {
  stepTime,
  validateProject,
  type LoopProject,
  type LoopTrack,
  type SampleAsset,
} from "./types";
import type { Pcm } from "../../lib/types";
export function trackBus(
  ctx: BaseAudioContext,
  track: LoopTrack,
  destination: AudioNode,
) {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(track.cutoff, ctx.sampleRate * 0.45);
  const gain = ctx.createGain();
  gain.gain.value = track.muted ? 0 : 10 ** (track.gainDb / 20);
  const pan = ctx.createStereoPanner();
  pan.pan.value = track.pan;
  filter.connect(gain).connect(pan).connect(destination);
  if (track.room > 0) {
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = track.room;
    pan.connect(reverb).connect(wet).connect(destination);
  }
  return filter;
}
function bufferFor(ctx: BaseAudioContext, asset: SampleAsset) {
  const buffer = ctx.createBuffer(
    asset.channels.length,
    asset.frames,
    asset.rate,
  );
  asset.channels.forEach((c, i) =>
    buffer.copyToChannel(new Float32Array(c), i),
  );
  return buffer;
}
export function accompanimentBus(ctx: BaseAudioContext) {
  const headroom = ctx.createGain();
  headroom.gain.value = 0.5;
  const safety = ctx.createDynamicsCompressor();
  safety.threshold.value = -6;
  safety.knee.value = 3;
  safety.ratio.value = 16;
  safety.attack.value = 0.002;
  safety.release.value = 0.1;
  headroom.connect(safety).connect(ctx.destination);
  return headroom;
}
export class LoopEngine {
  context?: AudioContext;
  outputId = "";
  private allVoices = new Set<AudioBufferSourceNode>();
  origin = 0;
  playing = false;
  revision = "";
  onStep?: (step: number) => void;
  onFault?: (message: string) => void;
  private project?: LoopProject;
  private buffers = new Map<string, AudioBuffer>();
  private buses = new Map<string, AudioNode>();
  private voices = new Map<string, AudioBufferSourceNode>();
  private timer?: ReturnType<typeof setInterval>;
  private next = 0;
  private hidden = () => {
    if (document.hidden)
      this.fail("Lecture des boucles arrêtée : page masquée.");
  };
  private changed = () =>
    this.fail("Routage modifié : accompagnement arrêté, reconnecte la sortie.");
  private fail(message: string) {
    this.stop();
    this.onFault?.(message);
  }
  async prepare(output = "") {
    if (this.context && this.context.state !== "closed") await this.close();
    this.context = new AudioContext({ latencyHint: "interactive" });
    this.outputId = output;
    try {
      await this.context.resume();
      if (output && output !== "default") {
        const ctx = this.context as AudioContext & {
          setSinkId?: (id: string) => Promise<void>;
        };
        if (!ctx.setSinkId) throw Error("Sélection de sortie indisponible.");
        await ctx.setSinkId(output);
      }
      if (this.context.state !== "running")
        throw Error("Moteur audio suspendu.");
      document.addEventListener("visibilitychange", this.hidden);
      navigator.mediaDevices?.addEventListener("devicechange", this.changed);
      this.context.addEventListener("sinkchange", this.changed);
      this.context.addEventListener("statechange", () => {
        if (this.context?.state === "suspended")
          this.fail("Moteur audio suspendu : accompagnement arrêté.");
      });
    } catch (e) {
      await this.close();
      throw e;
    }
  }
  configure(project: LoopProject, assets: SampleAsset[]) {
    validateProject(project);
    if (!this.context) throw Error("Ouvre la sortie audio.");
    this.stop();
    for (const bus of this.buses.values()) bus.disconnect();
    this.buses.clear();
    this.buffers.clear();
    this.project = structuredClone(project);
    this.revision = project.id + ":" + project.updated;
    assets.forEach((asset) =>
      this.buffers.set(asset.id, bufferFor(this.context!, asset)),
    );
    const output = accompanimentBus(this.context);
    project.tracks.forEach((track) =>
      this.buses.set(track.id, trackBus(this.context!, track, output)),
    );
  }
  start() {
    if (!this.context || !this.project || this.context.state !== "running")
      throw Error("Prépare le LoopPad avant lecture.");
    this.stop();
    this.playing = true;
    this.origin = this.context.currentTime + 0.15;
    this.next = 0;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 25);
  }
  private schedule() {
    if (!this.playing || !this.context || !this.project) return;
    if (
      this.origin +
        stepTime(this.next, this.project.tempo, this.project.swing) <
      this.context.currentTime - 0.05
    ) {
      this.fail(
        "Planification audio en retard. La lecture est arrêtée pour préserver le calage.",
      );
      return;
    }
    while (
      this.origin +
        stepTime(this.next, this.project.tempo, this.project.swing) <
      this.context.currentTime + 0.12
    ) {
      const at =
          this.origin +
          stepTime(this.next, this.project.tempo, this.project.swing),
        step = this.next % 16;
      for (const track of this.project.tracks)
        if (track.steps[step]) this.trigger(track.id, at);
      this.onStep?.(step);
      this.next++;
    }
  }
  trigger(id: string, at = this.context?.currentTime || 0) {
    if (!this.context || !this.project) return;
    const track = this.project.tracks.find((t) => t.id === id),
      buffer = track?.assetId ? this.buffers.get(track.assetId) : undefined;
    if (!track || !buffer || track.muted) return;
    const start = Math.min(track.trimStart, buffer.duration),
      end =
        track.trimEnd > 0
          ? Math.min(track.trimEnd, buffer.duration)
          : buffer.duration;
    if (end <= start) return;
    const old = this.voices.get(id);
    try {
      old?.stop(at);
    } catch {
      /* previous voice ended */
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.buses.get(id)!);
    source.start(at, start, end - start);
    this.allVoices.add(source);
    source.onended = () => {
      this.allVoices.delete(source);
      source.disconnect();
      if (this.voices.get(id) === source) this.voices.delete(id);
    };
    this.voices.set(id, source);
  }
  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.allVoices.forEach((v) => {
      try {
        v.stop();
      } catch {}
    });
    this.allVoices.clear();
    this.voices.clear();
    this.onStep?.(-1);
  }
  async close() {
    this.stop();
    document.removeEventListener("visibilitychange", this.hidden);
    navigator.mediaDevices?.removeEventListener("devicechange", this.changed);
    this.context?.removeEventListener("sinkchange", this.changed);
    await this.context?.close().catch(() => {});
    this.context = undefined;
    this.buses.clear();
    this.buffers.clear();
  }
}
export async function mixAccompaniment(
  original: Pcm,
  project: LoopProject,
  assets: SampleAsset[],
  offsetSeconds: number,
): Promise<Pcm> {
  validateProject(project);
  const ctx = new OfflineAudioContext(
    2,
    original.channels[0].length,
    original.rate,
  );
  const raw = ctx.createBuffer(
    original.channels.length,
    original.channels[0].length,
    original.rate,
  );
  original.channels.forEach((c, i) =>
    raw.copyToChannel(c as Float32Array<ArrayBuffer>, i),
  );
  const piano = ctx.createBufferSource();
  piano.buffer = raw;
  piano.connect(ctx.destination);
  piano.start();
  const duration = original.channels[0].length / original.rate;
  const buffers = new Map(
    assets.map((asset) => [asset.id, bufferFor(ctx, asset)]),
  );
  const output = accompanimentBus(ctx);
  for (const track of project.tracks) {
    const buffer = track.assetId ? buffers.get(track.assetId) : undefined;
    if (!buffer || track.muted) continue;
    const bus = trackBus(ctx, track, output),
      start = track.trimStart,
      end =
        track.trimEnd > 0
          ? Math.min(track.trimEnd, buffer.duration)
          : buffer.duration;
    let previous: AudioBufferSourceNode | undefined;
    const first = Math.max(
      0,
      Math.floor(((offsetSeconds - buffer.duration) * project.tempo * 4) / 60) -
        2,
    );
    for (let index = first; ; index++) {
      const at = stepTime(index, project.tempo, project.swing) - offsetSeconds;
      if (at >= duration) break;
      if (!track.steps[index % 16] || at + end - start <= 0) continue;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(bus);
      const when = Math.max(0, at),
        seek = Math.max(0, -at);
      if (end - start - seek <= 0) continue;
      if (previous) previous.stop(when);
      source.start(when, start + seek, end - start - seek);
      previous = source;
    }
  }
  const rendered = await ctx.startRendering();
  return {
    rate: original.rate,
    channels: [rendered.getChannelData(0), rendered.getChannelData(1)],
  };
}
