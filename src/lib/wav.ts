import type { Pcm } from "./types";
export function wavHeader(frames: number, channels: number, rate: number) {
  const size = frames * channels * 3,
    buffer = new ArrayBuffer(44 + size + (size % 2)),
    d = new DataView(buffer);
  const str = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) d.setUint8(at + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  d.setUint32(4, buffer.byteLength - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  d.setUint32(16, 16, true);
  d.setUint16(20, 1, true);
  d.setUint16(22, channels, true);
  d.setUint32(24, rate, true);
  d.setUint32(28, rate * channels * 3, true);
  d.setUint16(32, channels * 3, true);
  d.setUint16(34, 24, true);
  str(36, "data");
  d.setUint32(40, size, true);
  return { buffer, view: d };
}
export async function encodeWav(pcm: Pcm, signal?: AbortSignal) {
  const count = pcm.channels.length,
    n = pcm.channels[0].length,
    { buffer, view } = wavHeader(n, count, pcm.rate);
  let at = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < count; c++) {
      const x = pcm.channels[c][i];
      if (!Number.isFinite(x)) throw Error("Échantillon audio invalide.");
      const v = Math.round(
        Math.max(-1, Math.min(1, x)) * (x < 0 ? 8388608 : 8388607),
      );
      view.setUint8(at++, v & 255);
      view.setUint8(at++, (v >> 8) & 255);
      view.setUint8(at++, (v >> 16) & 255);
    }
    if (i % 65536 === 0) {
      if (signal?.aborted) throw new DOMException("Annulé", "AbortError");
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}
export function download(blob: Blob, title: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = title;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
