import type { Pcm } from "../../lib/types";
export function rmsOverWindow(pcm: Pcm, frames = pcm.channels[0]?.length || 0) {
  const length = Math.min(
    frames,
    ...pcm.channels.map((channel) => channel.length),
  );
  if (!length || !pcm.channels.length) return 0;
  let sum = 0;
  for (const channel of pcm.channels)
    for (let i = 0; i < length; i++) sum += channel[i] * channel[i];
  return Math.sqrt(sum / (length * pcm.channels.length));
}
