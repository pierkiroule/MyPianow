import type { MidiPacket, Take } from "../../lib/types";

// Web MIDI timestamps and performance.now share a time origin in conforming browsers.
export function midiTime(
  stamp: number,
  now = performance.now(),
  origin = performance.timeOrigin,
) {
  if (!Number.isFinite(stamp) || stamp < 0) return now;
  return stamp > 1e12 ? stamp - origin : stamp;
}
export function channelMessage(data: Uint8Array): number[] | null {
  const status = data[0];
  if (status < 0x80 || status >= 0xf0) return null;
  const size = (status & 0xe0) === 0xc0 ? 2 : 3;
  if (data.length !== size || Array.from(data.slice(1)).some((v) => v > 127))
    return null;
  return Array.from(data);
}
export function midiSeconds(event: MidiPacket, take: Take) {
  if (take.capture?.audioStartMs === undefined) return null;
  return (
    (event.timeMs - take.capture.audioStartMs + (take.midi?.offsetMs || 0)) /
    1000
  );
}
export function noteTimeline(events: MidiPacket[], take: Take) {
  const open = new Map<
    string,
    { start: number; pitch: number; velocity: number }[]
  >();
  const notes: {
    start: number;
    end: number;
    pitch: number;
    velocity: number;
    truncated: boolean;
  }[] = [];
  const duration = take.frames / take.rate;
  for (const event of events) {
    const time = midiSeconds(event, take);
    if (time === null) continue;
    const [status, pitch, velocity] = event.data;
    const key = `${status & 15}:${pitch}`;
    if ((status & 0xf0) === 0x90 && velocity > 0) {
      const queue = open.get(key) || [];
      queue.push({ start: time, pitch, velocity });
      open.set(key, queue);
    } else if (
      (status & 0xf0) === 0x80 ||
      ((status & 0xf0) === 0x90 && velocity === 0)
    ) {
      const note = open.get(key)?.shift();
      if (note) notes.push({ ...note, end: time, truncated: false });
    }
  }
  for (const queue of open.values())
    for (const note of queue)
      notes.push({ ...note, end: duration, truncated: true });
  return notes;
}
