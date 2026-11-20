import { midiSeconds } from "../midi/performance";
import type { Pcm, Take, MidiPacket } from "../../lib/types";
export type AnalysisWindow = {
  time: number;
  rmsDb: number;
  peakDb: number;
  bassFraction: number;
  notes: number;
  velocity: number;
  register: number;
  chord: number;
  pedal: number;
};
export type AudioAnalysis = {
  rmsDb: number;
  peakDb: number;
  crestDb: number;
  dynamicRangeDb: number;
  bands: number[];
  correlation: number | null;
  sideRatio: number;
  windows: AnalysisWindow[];
  midi: {
    notes: number;
    velocitySpread: number;
    pedalEvents: number;
    alignment: "estimated" | "missing";
  };
};
const db = (value: number) => 20 * Math.log10(Math.max(1e-6, value));
const percentile = (values: number[], fraction: number) =>
  values.length ? values[Math.floor((values.length - 1) * fraction)] : 0;
export function analyze(
  pcm: Pcm,
  events: MidiPacket[] = [],
  take?: Take,
): AudioAnalysis {
  const { channels, rate } = pcm,
    n = channels[0].length;
  const hop = Math.max(1, Math.round(rate * 0.5)),
    windows: AnalysisWindow[] = [];
  let sum = 0,
    peak = 0,
    left = 0,
    right = 0,
    cross = 0,
    side = 0,
    totalStereo = 0;
  const energies = [0, 0, 0, 0],
    states = [0, 0, 0],
    alpha = [180, 700, 3000].map(
      (f) => 1 - Math.exp((-2 * Math.PI * f) / (rate / 4)),
    );
  for (let start = 0; start < n; start += hop) {
    let winSum = 0,
      winPeak = 0,
      winLow = 0,
      winBands = 0;
    for (let i = start; i < Math.min(n, start + hop); i++) {
      let mono = 0;
      for (const channel of channels) {
        const value = channel[i];
        if (!Number.isFinite(value)) throw Error("Audio non fini.");
        winSum += value * value;
        winPeak = Math.max(winPeak, Math.abs(value));
        mono += value / channels.length;
      }
      if (channels.length === 2) {
        const l = channels[0][i],
          r = channels[1][i];
        left += l * l;
        right += r * r;
        cross += l * r;
        side += (l - r) ** 2 * 0.25;
        totalStereo += (l * l + r * r) * 0.5;
      }
      if (i % 4 === 0) {
        states.forEach((v, j) => (states[j] = v + alpha[j] * (mono - v)));
        const bands = [
          states[0],
          states[1] - states[0],
          states[2] - states[1],
          mono - states[2],
        ];
        bands.forEach((v, j) => {
          const power = v * v;
          energies[j] += power;
          winBands += power;
          if (j === 0) winLow += power;
        });
      }
    }
    const frames = Math.min(hop, n - start);
    sum += winSum;
    peak = Math.max(peak, winPeak);
    windows.push({
      time: start / rate,
      rmsDb: db(Math.sqrt(winSum / (frames * channels.length))),
      peakDb: db(winPeak),
      bassFraction: winBands ? winLow / winBands : 0,
      notes: 0,
      velocity: 0,
      register: 0,
      chord: 0,
      pedal: 0,
    });
  }
  const velocities: number[] = [];
  let pedalEvents = 0,
    pedal = 0,
    chordTime = -1,
    chord = 0;
  if (take?.capture?.audioStartMs !== undefined) {
    const ordered = events
      .map((event) => ({ event, time: midiSeconds(event, take)! }))
      .sort((a, b) => a.time - b.time);
    let at = 0;
    for (const window of windows) {
      while (at < ordered.length && ordered[at].time < window.time + 0.5) {
        const { event, time } = ordered[at++],
          [status, key, value] = event.data;
        if ((status & 240) === 176 && key === 64) {
          pedal = value;
          pedalEvents++;
        }
        if (time < window.time) continue;
        if ((status & 240) === 144 && value > 0) {
          window.notes++;
          window.velocity += value;
          window.register += key;
          velocities.push(value);
          if (time - chordTime < 0.06) chord++;
          else {
            chord = 1;
            chordTime = time;
          }
          window.chord = Math.max(window.chord, chord);
        }
      }
      window.pedal = pedal;
      if (window.notes) {
        window.velocity /= window.notes;
        window.register /= window.notes;
      }
    }
  }
  const levels = windows
      .map((w) => w.rmsDb)
      .filter((v) => v > -65)
      .sort((a, b) => a - b),
    sorted = [...velocities].sort((a, b) => a - b),
    energy = energies.reduce((a, b) => a + b, 0),
    rmsDb = db(Math.sqrt(sum / Math.max(1, n * channels.length))),
    peakDb = db(peak);
  return {
    rmsDb,
    peakDb,
    crestDb: peakDb - rmsDb,
    dynamicRangeDb: percentile(levels, 0.9) - percentile(levels, 0.1),
    bands: energies.map((e) => (energy ? e / energy : 0)),
    correlation:
      channels.length === 2 && left > 1e-12 && right > 1e-12
        ? Math.max(-1, Math.min(1, cross / Math.sqrt(left * right)))
        : null,
    sideRatio: totalStereo ? side / totalStereo : 0,
    windows,
    midi: {
      notes: velocities.length,
      velocitySpread: percentile(sorted, 0.9) - percentile(sorted, 0.1),
      pedalEvents,
      alignment:
        take?.capture?.audioStartMs !== undefined ? "estimated" : "missing",
    },
  };
}
