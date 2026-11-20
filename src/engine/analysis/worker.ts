import type { Pcm, Take, MidiPacket } from "../../lib/types";
import type { AudioAnalysis } from "./analyze";
export function analyzeInWorker(
  pcm: Pcm,
  events: MidiPacket[],
  take: Take | undefined,
  signal: AbortSignal,
): Promise<AudioAnalysis> {
  if (signal.aborted)
    return Promise.reject(new DOMException("Annulé", "AbortError"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../../workers/analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
    const finish = () => {
      worker.terminate();
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      finish();
      reject(new DOMException("Annulé", "AbortError"));
    };
    const timeout = setTimeout(() => {
      finish();
      reject(Error("Analyse trop longue. Original conservé."));
    }, 180000);
    signal.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event) => {
      finish();
      if (event.data.error) reject(Error(event.data.error));
      else resolve(event.data.result);
    };
    worker.onerror = (event) => {
      finish();
      reject(Error(event.message));
    };
    const channels = pcm.channels.map((c) => new Float32Array(c));
    worker.postMessage(
      { pcm: { rate: pcm.rate, channels }, events, take },
      channels.map((c) => c.buffer),
    );
  });
}
