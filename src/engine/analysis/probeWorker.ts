import type { Pcm } from "../../lib/types";
import type { ProbeAnalysis } from "../routing/routeProbe";
import type { stereoEvidence } from "./stereo";
function run<T>(pcm: Pcm, mode: string, offset = 0, gaps = 0): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../../workers/analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(Error("Analyse du diagnostic trop longue."));
    }, 30000);
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      if (event.data.error) reject(Error(event.data.error));
      else resolve(event.data.result);
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(Error(event.message));
    };
    const channels = pcm.channels.map((c) => new Float32Array(c));
    worker.postMessage(
      { pcm: { rate: pcm.rate, channels }, mode, offset, gaps },
      channels.map((c) => c.buffer),
    );
  });
}
export const probeInWorker = (pcm: Pcm, offset: number, gaps: number) =>
  run<ProbeAnalysis>(pcm, "probe", offset, gaps);
export const stereoInWorker = (pcm: Pcm) =>
  run<ReturnType<typeof stereoEvidence>>(pcm, "stereo");
