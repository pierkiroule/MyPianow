import type { Pcm } from "../../lib/types";
export type ProbeHit = {
  channel: number;
  correlation: number;
  delayMs: number;
};
export type ProbeAnalysis = {
  verdict: "returned" | "not-detected" | "inconclusive";
  reason: string;
  hits: ProbeHit[];
  baselineDb: number;
  peak: number;
};
export const PROBE_OFFSETS = [0.35, 1.15] as const;
export function makeProbe(rate: number, index: number) {
  const frames = Math.round(rate * 0.18);
  const out = new Float32Array(frames);
  const f0 = index === 0 ? 650 : 2100,
    f1 = index === 0 ? 1750 : 900;
  for (let i = 0; i < frames; i++) {
    const time = i / rate,
      duration = frames / rate;
    const envelope = Math.min(1, time / 0.012, (duration - time) / 0.012);
    out[i] =
      0.04 *
      envelope *
      Math.sin(
        2 * Math.PI * (f0 * time + ((f1 - f0) * time * time) / (2 * duration)),
      );
  }
  return out;
}
export function referencePcm(rate: number): Pcm {
  const channels = [
    new Float32Array(Math.round(rate * 1.6)),
    new Float32Array(Math.round(rate * 1.6)),
  ];
  PROBE_OFFSETS.forEach((offset, i) =>
    channels[i].set(makeProbe(rate, i), Math.round(rate * offset)),
  );
  return { rate, channels };
}
function decimate(input: Float32Array, factor: number) {
  const out = new Float32Array(Math.floor(input.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += input[i * factor + j];
    out[i] = sum / factor;
  }
  return out;
}
function match(
  signal: Float32Array,
  template: Float32Array,
  low: number,
  high: number,
) {
  let energy = 0;
  for (const value of template) energy += value * value;
  let best = 0,
    at = low,
    windowEnergy = 0;
  high = Math.min(high, signal.length - template.length);
  for (let k = 0; k < template.length; k++)
    windowEnergy += signal[low + k] ** 2;
  for (let i = low; i <= high; i++) {
    let dot = 0;
    for (let k = 0; k < template.length; k++)
      dot += signal[i + k] * template[k];
    const correlation =
      windowEnergy > 1e-12
        ? Math.abs(dot) / Math.sqrt(energy * windowEnergy)
        : 0;
    if (correlation > best) {
      best = correlation;
      at = i;
    }
    windowEnergy += (signal[i + template.length] || 0) ** 2 - signal[i] ** 2;
    windowEnergy = Math.max(0, windowEnergy);
  }
  return { correlation: Math.min(1, best), at };
}
// Reports evidence only: lack of a match cannot establish a permanent physical route.
export async function analyzeProbe(
  pcm: Pcm,
  probeStartSeconds: number,
  gaps = 0,
): Promise<ProbeAnalysis> {
  const hits: ProbeHit[] = [];
  let peak = 0,
    baselineSum = 0,
    baselineCount = 0;
  const factor = Math.ceil(pcm.rate / 6000),
    rate = pcm.rate / factor;
  const baselineEnd = Math.max(
    1,
    Math.floor((probeStartSeconds + PROBE_OFFSETS[0] - 0.12) * pcm.rate),
  );
  for (const channel of pcm.channels)
    for (let i = 0; i < channel.length; i++) {
      const value = channel[i];
      if (!Number.isFinite(value))
        return {
          verdict: "inconclusive",
          reason: "Échantillons invalides.",
          hits,
          baselineDb: -120,
          peak: 0,
        };
      peak = Math.max(peak, Math.abs(value));
      if (i < baselineEnd) {
        baselineSum += value * value;
        baselineCount++;
      }
    }
  const baselineDb =
    20 *
    Math.log10(
      Math.max(1e-6, Math.sqrt(baselineSum / Math.max(1, baselineCount))),
    );
  if (
    gaps ||
    peak >= 0.98 ||
    probeStartSeconds < 0 ||
    pcm.channels.some((c) => c.length / pcm.rate < probeStartSeconds + 2.4)
  )
    return {
      verdict: "inconclusive",
      reason: "Capture interrompue, saturée ou trop courte.",
      hits,
      baselineDb,
      peak,
    };
  for (let p = 0; p < 2; p++) {
    const expected = (probeStartSeconds + PROBE_OFFSETS[p]) * rate;
    let best: ProbeHit = { channel: 0, correlation: 0, delayMs: 0 };
    for (let c = 0; c < pcm.channels.length; c++) {
      const result = match(
        decimate(pcm.channels[c], factor),
        decimate(makeProbe(pcm.rate, p), factor),
        Math.max(0, Math.round(expected - 0.1 * rate)),
        Math.round(expected + rate),
      );
      if (result.correlation > best.correlation)
        best = {
          channel: c,
          correlation: result.correlation,
          delayMs:
            (result.at / rate - probeStartSeconds - PROBE_OFFSETS[p]) * 1000,
        };
    }
    hits.push(best);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const matched = hits.filter((h) => h.correlation >= 0.6);
  if (matched.length === 2 && Math.abs(hits[0].delayMs - hits[1].delayMs) < 40)
    return {
      verdict: "returned",
      reason:
        "Les deux signaux sont retrouvés dans l’entrée USB. Les boucles risquent d’être enregistrées deux fois.",
      hits,
      baselineDb,
      peak,
    };
  if (matched.length || baselineDb > -48)
    return {
      verdict: "inconclusive",
      reason:
        "Un signal ressemble au test, ou du piano/bruit masque la mesure. Refaire le test sans jouer.",
      hits,
      baselineDb,
      peak,
    };
  return {
    verdict: "not-detected",
    reason:
      "Aucun retour correspondant aux deux signaux n’a été détecté au seuil du test. Confirme leur écoute sur le piano et vérifie la prise USB.",
    hits,
    baselineDb,
    peak,
  };
}
