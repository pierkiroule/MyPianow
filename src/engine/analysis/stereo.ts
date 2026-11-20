import type { Pcm } from "../../lib/types";
export function stereoEvidence(pcm: Pcm) {
  let l = 0,
    r = 0,
    cross = 0,
    difference = 0;
  const left = pcm.channels[0],
    right = pcm.channels[1];
  for (let i = 0; i < left.length; i++) {
    l += left[i] * left[i];
    if (right) {
      r += right[i] * right[i];
      cross += left[i] * right[i];
      difference += (left[i] - right[i]) ** 2;
    }
  }
  const db = (sum: number) =>
    20 * Math.log10(Math.max(1e-6, Math.sqrt(sum / Math.max(1, left.length))));
  return {
    leftDb: db(l),
    rightDb: right ? db(r) : null,
    correlation:
      right && l * r > 1e-15
        ? Math.max(-1, Math.min(1, cross / Math.sqrt(l * r)))
        : null,
    duplicated: !!right && l + r > 1e-12 && difference / (l + r) < 1e-6,
    silent: l + r < left.length * 1e-10,
  };
}
