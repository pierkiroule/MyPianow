import type { Fx, Pcm } from "./types";
function impulse(ctx: OfflineAudioContext) {
  const b = ctx.createBuffer(
    2,
    Math.ceil(ctx.sampleRate * 1.6),
    ctx.sampleRate,
  );
  let seed = 30121;
  for (let c = 0; c < 2; c++) {
    let smooth = 0;
    const a = b.getChannelData(c);
    for (let i = 0; i < a.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      smooth = 0.6 * smooth + 0.4 * (((seed >>> 0) / 4294967296) * 2 - 1);
      a[i] =
        smooth *
        Math.exp((-7 * i) / a.length) *
        Math.min(1, i / (ctx.sampleRate * 0.01));
    }
  }
  return b;
}
export function protectPeak(channels: Float32Array[], fx?: Fx) {
  let peak = 0;
  for (const c of channels)
    for (const x of c) {
      if (!Number.isFinite(x))
        throw Error("Rendu invalide. Original conservé.");
      peak = Math.max(peak, Math.abs(x));
    }
  const ceiling = 10 ** ((fx?.ceiling ?? -1) / 20);
  let sum = 0,
    n = 0;
  for (const c of channels)
    for (const v of c) {
      sum += v * v;
      n++;
    }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const desired =
    fx?.autoLevel && rms > 1e-6
      ? Math.min(4, 10 ** ((fx.targetRms ?? -20) / 20) / rms)
      : 1;
  const gain = peak > 0 ? Math.min(desired, ceiling / peak) : 1;
  for (const c of channels)
    if (gain !== 1) for (let i = 0; i < c.length; i++) c[i] *= gain;
  return 20 * Math.log10(gain);
}
export async function renderPcm(
  raw: Pcm,
  fx: Fx,
  signal: AbortSignal,
): Promise<Pcm> {
  if (signal.aborted) throw new DOMException("Annulé", "AbortError");
  const count = fx.room > 0 ? 2 : raw.channels.length,
    length =
      raw.channels[0].length + (fx.room > 0 ? Math.ceil(raw.rate * 1.8) : 0),
    ctx = new OfflineAudioContext(count, length, raw.rate),
    buffer = ctx.createBuffer(
      raw.channels.length,
      raw.channels[0].length,
      raw.rate,
    );
  raw.channels.forEach((c, i) =>
    buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i),
  );
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = (type: BiquadFilterType, freq: number, gain = 0) => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = freq;
    n.gain.value = gain;
    return n;
  };
  const hp = filter("highpass", 26),
    bass = filter("lowshelf", 160, fx.bass),
    mid = filter("peaking", 700, fx.mid),
    treble = filter("highshelf", 3000, fx.treble),
    cut = filter("lowpass", Math.min(fx.cutoff, raw.rate * 0.45));
  mid.Q.value = 0.65;
  cut.Q.value = 0.5;
  source.connect(hp).connect(bass).connect(mid).connect(treble).connect(cut);
  let tail: AudioNode = cut;
  for (const band of fx.bands || []) {
    const n = filter(
      band.type,
      Math.max(20, Math.min(raw.rate * 0.45, band.frequency)),
      Math.max(-12, Math.min(12, band.gain)),
    );
    n.Q.value = Math.max(0.1, Math.min(8, band.q));
    tail.connect(n);
    tail = n;
  }
  if (fx.compression > 0) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14 - (14 * fx.compression) / 100;
    comp.ratio.value = 1 + (2.5 * fx.compression) / 100;
    comp.knee.value = 15;
    comp.attack.value = 0.025;
    comp.release.value = 0.28;
    tail.connect(comp);
    tail = comp;
  }
  const gain = ctx.createGain();
  gain.gain.value = 10 ** (fx.gain / 20);
  tail.connect(gain);
  const dry = ctx.createGain();
  dry.gain.value = 1 - fx.room / 100;
  gain.connect(dry).connect(ctx.destination);
  if (fx.room > 0) {
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = 0.025;
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = fx.room / 100;
    gain.connect(delay).connect(conv).connect(wet).connect(ctx.destination);
  }
  source.start();
  const rendered = await ctx.startRendering();
  if (signal.aborted) throw new DOMException("Annulé", "AbortError");
  const channels = Array.from({ length: count }, (_, i) =>
    rendered.getChannelData(i),
  );
  applyWidth(channels, fx.width ?? 100);
  protectPeak(channels, fx);
  return { channels, rate: raw.rate };
}

export function applyWidth(channels: Float32Array[], percent: number) {
  if (channels.length !== 2) return;
  const width = Math.max(0, Math.min(1.5, percent / 100));
  for (let i = 0; i < channels[0].length; i++) {
    const m = (channels[0][i] + channels[1][i]) * 0.5,
      s = (channels[0][i] - channels[1][i]) * 0.5 * width;
    channels[0][i] = m + s;
    channels[1][i] = m - s;
  }
}
