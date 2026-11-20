import { midiSeconds } from "../engine/midi/performance";
import type { MidiPacket, Take } from "../lib/types";
const variable = (n: number) => {
  const bytes = [n & 127];
  while ((n = Math.floor(n / 128)) > 0) bytes.unshift((n & 127) | 128);
  return bytes;
};
export function exportMidi(events: MidiPacket[], take: Take) {
  if (take.capture?.audioStartMs === undefined)
    throw Error(
      "Origine audio indisponible pour exporter le MIDI synchronisé.",
    );
  const timeline = events
    .map((event, index) => ({
      tick: Math.round(Math.max(0, midiSeconds(event, take) || 0) * 1920),
      data: event.data,
      index,
    }))
    .sort((a, b) => a.tick - b.tick || a.index - b.index);
  const bytes = [0, 255, 81, 3, 7, 161, 32];
  let at = 0;
  for (const event of timeline) {
    bytes.push(...variable(event.tick - at), ...event.data);
    at = event.tick;
  }
  const end = Math.max(at, Math.round((take.frames / take.rate) * 1920));
  bytes.push(...variable(end - at));
  for (let channel = 0; channel < 16; channel++) {
    if (channel) bytes.push(0);
    bytes.push(0xb0 + channel, 64, 0, 0, 0xb0 + channel, 123, 0);
  }
  bytes.push(0, 255, 47, 0);
  const buffer = new ArrayBuffer(22 + bytes.length),
    view = new DataView(buffer),
    out = new Uint8Array(buffer);
  out.set([77, 84, 104, 100]);
  view.setUint32(4, 6);
  view.setUint16(8, 0);
  view.setUint16(10, 1);
  view.setUint16(12, 960);
  out.set([77, 84, 114, 107], 14);
  view.setUint32(18, bytes.length);
  out.set(bytes, 22);
  return new Blob([buffer], { type: "audio/midi" });
}
