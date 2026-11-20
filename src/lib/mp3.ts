import type { Pcm } from "./types";
export function encodeMp3(
  pcm: Pcm,
  onProgress?: (n: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../audio/mp3.worker.ts", import.meta.url),
      { type: "module" },
    );
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(Error("Encodage trop long. Le WAV reste disponible."));
    }, 180000);
    worker.onmessage = (e) => {
      if (e.data.progress !== undefined) onProgress?.(e.data.progress);
      if (e.data.blob || e.data.error) {
        clearTimeout(timeout);
        worker.terminate();
        if (e.data.error) reject(Error(e.data.error));
        else resolve(e.data.blob);
      }
    };
    worker.onerror = (e) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(Error(e.message));
    };
    const channels = pcm.channels.map((c) => new Float32Array(c));
    worker.postMessage(
      { channels, rate: pcm.rate },
      channels.map((c) => c.buffer),
    );
  });
}
