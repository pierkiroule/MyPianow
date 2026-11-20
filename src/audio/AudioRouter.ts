import { captureLock, openUsb } from "./usb";
import { analyzeProbe, referencePcm, type ProbeAnalysis } from "./routeProbe";
import type { Pcm } from "../lib/types";
export type RouterInfo = {
  input: string;
  deviceId: string;
  channels: number;
  sampleRate: number;
  requestedOutput: string;
  sinkId?: string;
  canSelectOutput: boolean;
  trackSettings: MediaTrackSettings;
  baseLatency: number;
  outputLatency?: number;
};
export type RouteRecording = {
  kind: "piano" | "duplex";
  pcm: Pcm;
  firstFrame: number;
  gaps: number;
  reference?: Pcm;
  referenceOffsetSeconds?: number;
  analysis?: ProbeAnalysis;
  created: number;
};
type SinkContext = AudioContext & {
  setSinkId?: (id: string) => Promise<void>;
  sinkId?: string;
};
type Capture = {
  kind: RouteRecording["kind"];
  chunks: Float32Array[][];
  firstFrame?: number;
  reference?: Pcm;
  referenceOffsetSeconds?: number;
  resolve: (clip: RouteRecording) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};
export class AudioRouter {
  onMeter?: (peak: number) => void;
  onFault?: (message: string) => void;
  info?: RouterInfo;
  private context?: SinkContext;
  private stream?: MediaStream;
  private input?: MediaStreamAudioSourceNode;
  private recorder?: AudioWorkletNode;
  private playback?: AudioBufferSourceNode;
  private playbackBus?: GainNode;
  private release?: () => void;
  private capture?: Capture;
  private closed = false;
  private opened = false;
  private fault = (message: string) => {
    this.onFault?.(message);
    void this.close();
  };
  private hidden = () => {
    if (document.hidden) this.fault("Page masquée : diagnostic arrêté.");
  };
  private changed = () =>
    this.fault("Périphériques modifiés : reconnecte et refais le test.");
  private stateChanged = () => {
    if (this.context?.state !== "running" && !this.closed)
      this.fault("Moteur audio suspendu : diagnostic arrêté.");
  };
  private ensureOpen() {
    if (this.closed) throw new DOMException("Diagnostic annulé", "AbortError");
  }
  async open(device: MediaDeviceInfo, outputId = "") {
    if (this.opened || this.closed)
      throw Error("Crée une nouvelle session de diagnostic.");
    this.opened = true;
    try {
      // Resume from the user's opening gesture before waiting for permissions.
      this.context = new AudioContext({ latencyHint: "interactive" });
      await this.context.resume();
      this.ensureOpen();
      if (this.context.state !== "running")
        throw Error("Moteur audio suspendu : garde la page visible.");
      this.release = await captureLock();
      this.ensureOpen();
      const { stream, track, settings } = await openUsb(device);
      this.stream = stream;
      this.ensureOpen();
      if (outputId && outputId !== "default") {
        if (!this.context.setSinkId)
          throw Error("Ce navigateur laisse Android choisir la sortie audio.");
        await this.context.setSinkId(outputId);
        this.ensureOpen();
      }
      await this.context.audioWorklet.addModule(
        import.meta.env.BASE_URL + "router.worklet.js",
      );
      this.ensureOpen();
      const channels = Math.min(2, settings.channelCount || 1);
      this.recorder = new AudioWorkletNode(this.context, "route-capture", {
        channelCount: channels,
        channelCountMode: "explicit",
        channelInterpretation: "discrete",
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.input = this.context.createMediaStreamSource(
        new MediaStream([track]),
      );
      // The only connection from the USB input ends at a worklet producing zeros.
      this.input.connect(this.recorder);
      this.recorder.connect(this.context.destination);
      this.playbackBus = this.context.createGain();
      this.playbackBus.gain.value = 1;
      this.playbackBus.connect(this.context.destination);
      this.recorder.port.onmessage = (event) => this.receive(event.data);
      this.info = {
        input: track.label,
        deviceId: settings.deviceId || "",
        channels,
        sampleRate: this.context.sampleRate,
        requestedOutput: outputId || "default",
        sinkId: this.context.sinkId,
        canSelectOutput: typeof this.context.setSinkId === "function",
        trackSettings: settings,
        baseLatency: this.context.baseLatency,
        outputLatency: this.context.outputLatency,
      };
      track.addEventListener("ended", this.changed);
      track.addEventListener("mute", this.changed);
      navigator.mediaDevices.addEventListener("devicechange", this.changed);
      this.context.addEventListener("sinkchange", this.changed);
      this.context.addEventListener("statechange", this.stateChanged);
      document.addEventListener("visibilitychange", this.hidden);
      window.addEventListener("pagehide", this.changed);
      return this.info;
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  record(kind: RouteRecording["kind"]): Promise<RouteRecording> {
    if (this.closed || !this.recorder || !this.context || this.capture)
      return Promise.reject(
        Error("Ouvre une entrée USB et attends la fin du test en cours."),
      );
    return new Promise((resolve, reject) => {
      this.capture = {
        kind,
        chunks: [],
        resolve,
        reject,
        timeout: setTimeout(
          () => this.fault("Aucun bloc audio complet reçu à temps."),
          10000,
        ),
      };
      this.recorder!.port.postMessage({
        type: "capture",
        seconds: kind === "piano" ? 5 : 6,
      });
    });
  }
  private receive(data: {
    peak?: number;
    firstFrame?: number;
    pcm?: Float32Array[];
    done?: boolean;
    frames?: number;
    gaps?: number;
  }) {
    if (this.closed) return;
    if (data.peak !== undefined) this.onMeter?.(data.peak);
    const pending = this.capture;
    if (!pending) return;
    if (data.firstFrame !== undefined) {
      pending.firstFrame = data.firstFrame;
      if (pending.kind === "duplex") {
        const ctx = this.context!;
        const reference = referencePcm(ctx.sampleRate);
        const buffer = ctx.createBuffer(
          2,
          reference.channels[0].length,
          reference.rate,
        );
        reference.channels.forEach((channel, index) =>
          buffer.copyToChannel(new Float32Array(channel), index),
        );
        const start = ctx.currentTime + 0.2;
        if (start - data.firstFrame / ctx.sampleRate > 2) {
          this.fault("Horloge retardée : recommence le test au premier plan.");
          return;
        }
        pending.reference = reference;
        pending.referenceOffsetSeconds =
          start - data.firstFrame / ctx.sampleRate;
        this.playback = ctx.createBufferSource();
        this.playback.buffer = buffer;
        this.playback.connect(this.playbackBus!);
        this.playback.start(start);
      }
    }
    if (data.pcm) pending.chunks.push(data.pcm);
    if (data.done) {
      clearTimeout(pending.timeout);
      this.capture = undefined;
      this.playback?.disconnect();
      this.playback = undefined;
      const frames = pending.chunks.reduce(
        (count, chunk) => count + chunk[0].length,
        0,
      );
      if (
        !frames ||
        pending.firstFrame === undefined ||
        frames !== data.frames
      ) {
        pending.reject(Error("Capture incomplète."));
        return;
      }
      const channels = Array.from(
        { length: this.info!.channels },
        () => new Float32Array(frames),
      );
      let offset = 0;
      for (const chunk of pending.chunks) {
        channels.forEach((channel, i) => channel.set(chunk[i], offset));
        offset += chunk[0].length;
      }
      const clip: RouteRecording = {
        kind: pending.kind,
        pcm: { channels, rate: this.context!.sampleRate },
        firstFrame: pending.firstFrame,
        gaps: data.gaps || 0,
        reference: pending.reference,
        referenceOffsetSeconds: pending.referenceOffsetSeconds,
        created: Date.now(),
      };
      if (clip.referenceOffsetSeconds !== undefined)
        void analyzeProbe(
          clip.pcm,
          clip.referenceOffsetSeconds,
          clip.gaps,
        ).then(
          (analysis) => pending.resolve({ ...clip, analysis }),
          pending.reject,
        );
      else pending.resolve(clip);
    }
  }
  async close() {
    this.closed = true;
    if (this.capture) {
      clearTimeout(this.capture.timeout);
      this.capture.reject(new DOMException("Diagnostic arrêté", "AbortError"));
      this.capture = undefined;
    }
    document.removeEventListener("visibilitychange", this.hidden);
    window.removeEventListener("pagehide", this.changed);
    navigator.mediaDevices?.removeEventListener("devicechange", this.changed);
    this.context?.removeEventListener("sinkchange", this.changed);
    this.context?.removeEventListener("statechange", this.stateChanged);
    this.stream?.getTracks().forEach((track) => {
      track.removeEventListener("ended", this.changed);
      track.removeEventListener("mute", this.changed);
      track.stop();
    });
    try {
      this.playback?.stop();
    } catch {
      /* A completed source is already silent. */
    }
    this.playback?.disconnect();
    this.playbackBus?.disconnect();
    this.input?.disconnect();
    if (this.recorder) {
      this.recorder.port.onmessage = null;
      this.recorder.disconnect();
    }
    await this.context?.close().catch(() => {});
    this.release?.();
    this.release = undefined;
  }
}
