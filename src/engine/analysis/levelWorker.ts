import type { Pcm } from "../../lib/types";
export function levelInWorker(pcm: Pcm, signal: AbortSignal): Promise<number> {
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
      reject(Error("Mesure RMS trop longue."));
    }, 30000);
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
    const channels = pcm.channels.map((c) => c.slice());
    worker.postMessage(
      { mode: "level", pcm: { rate: pcm.rate, channels } },
      channels.map((c) => c.buffer),
    );
  });
}
