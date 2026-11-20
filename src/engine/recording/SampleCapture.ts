import { captureLock } from "../audio/devices";
import type { Pcm } from "../../lib/types";
export async function captureSample(
  deviceId: string,
  signal: AbortSignal,
): Promise<Pcm> {
  if (!deviceId || deviceId === "default")
    throw Error("Choisis explicitement un micro du PC.");
  const ctx = new AudioContext({ latencyHint: "interactive" });
  let stream: MediaStream | undefined,
    release: (() => void) | undefined,
    node: AudioWorkletNode | undefined;
  try {
    await ctx.resume();
    release = await captureLock();
    stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    if (signal.aborted) throw new DOMException("Annulé", "AbortError");
    const track = stream.getAudioTracks()[0];
    if (track.getSettings().deviceId !== deviceId)
      throw Error("Micro demandé non confirmé.");
    await ctx.audioWorklet.addModule(
      import.meta.env.BASE_URL + "router.worklet.js",
    );
    const count = Math.min(2, track.getSettings().channelCount || 1);
    node = new AudioWorkletNode(ctx, "route-capture", {
      channelCount: count,
      channelCountMode: "explicit",
      channelInterpretation: "discrete",
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    ctx.createMediaStreamSource(stream).connect(node);
    node.connect(ctx.destination);
    return await new Promise<Pcm>((resolve, reject) => {
      const chunks: Float32Array[][] = [];
      const fail = () =>
        reject(new DOMException("Capture du sample interrompue", "AbortError"));
      const timeout = setTimeout(
        () => reject(Error("Aucun sample complet reçu.")),
        12000,
      );
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", fail);
        track.removeEventListener("ended", fail);
        document.removeEventListener("visibilitychange", hidden);
      };
      const hidden = () => {
        if (document.hidden) fail();
      };
      signal.addEventListener("abort", fail, { once: true });
      track.addEventListener("ended", fail, { once: true });
      document.addEventListener("visibilitychange", hidden);
      node!.port.onmessage = (event) => {
        if (event.data.pcm) chunks.push(event.data.pcm);
        if (event.data.done) {
          cleanup();
          const frames = chunks.reduce((n, c) => n + c[0].length, 0);
          const channels = Array.from(
            { length: count },
            () => new Float32Array(frames),
          );
          let offset = 0;
          for (const chunk of chunks) {
            channels.forEach((c, i) => c.set(chunk[i], offset));
            offset += chunk[0].length;
          }
          resolve({ rate: ctx.sampleRate, channels });
        }
      };
      const rejectOriginal = reject;
      reject = (error) => {
        cleanup();
        rejectOriginal(error);
      };
      if (signal.aborted) {
        fail();
        return;
      }
      node!.port.postMessage({ type: "capture", seconds: 8 });
    });
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
    node?.disconnect();
    await ctx.close().catch(() => {});
    release?.();
  }
}
