import type { LoopProject } from "../loopPad/types";
import { channelMessage, midiTime } from "../midi/performance";
import {
  readPcm,
  saveChunk,
  saveTake,
  saveMidiBatch,
  readMidi,
} from "../../storage/database";
import { PRESETS, cloneFx, type Take, type MidiPacket } from "../../lib/types";
import { isUsb, openUsb, captureLock } from "../audio/devices";
export { isUsb, constraints, audioDevices } from "../audio/devices";
export class Recorder {
  private midiInput?: MIDIInput;
  private midiBuffer: MidiPacket[] = [];
  private midiIndex = 0;
  private midiTimer?: ReturnType<typeof setInterval>;
  private midiFailure?: Error;
  onMidi?: (count: number) => void;
  private receiveMidi = (event: MIDIMessageEvent) => {
    if (!this.take || !event.data) return;
    const data = channelMessage(event.data);
    if (!data) return;
    this.midiBuffer.push({
      takeId: this.take.id,
      index: this.midiIndex++,
      timeMs: midiTime(event.timeStamp),
      data,
    });
    this.onMidi?.(this.midiIndex);
    if (this.midiBuffer.length >= 512) this.flushMidi();
  };
  private midiState = () => {
    if (
      this.midiInput?.state === "disconnected" &&
      !this.ending &&
      !this.disposed
    ) {
      if (this.take?.midi) this.take.midi.interrupted = true;
      this.onInterrupted?.(
        "Connexion MIDI perdue. Prise interrompue, blocs sauvegardés conservés.",
      );
    }
  };
  private flushMidi() {
    const batch = this.midiBuffer.splice(0);
    if (!batch.length) return;
    this.queue = this.queue.then(async () => {
      if (this.midiFailure) return;
      try {
        await saveMidiBatch(batch);
      } catch (error) {
        this.midiFailure = Error(
          "Sauvegarde MIDI impossible : " + (error as Error).message,
        );
        this.onInterrupted?.(this.midiFailure.message);
      }
    });
  }
  private detachMidi() {
    clearInterval(this.midiTimer);
    this.midiInput?.removeEventListener("midimessage", this.receiveMidi);
    this.midiInput?.removeEventListener("statechange", this.midiState);
    this.flushMidi();
  }
  private contextChanged = () => {
    if (this.ctx?.state !== "running" && !this.ending && !this.disposed)
      this.onInterrupted?.("Moteur audio suspendu.");
  };
  private disposed = false;
  private releaseLock?: () => void;
  private stream?: MediaStream;
  private ctx?: AudioContext;
  private ownsContext = true;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private lock?: WakeLockSentinel;
  private queue = Promise.resolve();
  private failure?: Error;
  private queued = 0;
  private index = 0;
  private frames = 0;
  private ending?: Promise<Take>;
  private done?: () => void;
  private finished = false;
  take?: Take;
  onMeter?: (peak: number, seconds: number) => void;
  onInterrupted?: (reason: string) => void;
  async start(
    device: MediaDeviceInfo,
    native?: Take["native"],
    midiInput?: MIDIInput,
    options?: {
      context?: AudioContext;
      project?: LoopProject;
      loopOrigin?: number;
      maxSeconds?: number;
    },
  ) {
    if (!isUsb(device)) throw Error("Sélectionne une entrée USB reconnue.");
    try {
      this.releaseLock = await captureLock();
      const { stream, track, settings } = await openUsb(device);
      this.stream = stream;
      this.ownsContext = !options?.context;
      this.ctx =
        options?.context ||
        new AudioContext({ sampleRate: settings.sampleRate || 48000 });
      await this.ctx.resume();
      if (this.ctx.state !== "running")
        throw Error("Moteur suspendu. Garde la page visible.");
      await this.ctx.audioWorklet.addModule(
        import.meta.env.BASE_URL + "capture.worklet.js",
      );
      const channels = Math.min(2, settings.channelCount || 1);
      this.take = {
        id: crypto.randomUUID(),
        title: "Improvisation du " + new Date().toLocaleDateString("fr-FR"),
        created: Date.now(),
        rate: this.ctx.sampleRate,
        channels,
        frames: 0,
        status: "recording",
        native,
        accompaniment: options?.project
          ? {
              project: structuredClone(options.project),
              offsetSeconds: 0,
              include: false,
            }
          : undefined,
        capture: {
          source: track.label,
          inputLatency: (settings as MediaTrackSettings & { latency?: number })
            .latency,
          clock: "estimated",
        },
        midi: midiInput
          ? {
              name: midiInput.name || "Entrée MIDI",
              eventCount: 0,
              offsetMs: 0,
            }
          : undefined,
        fx: cloneFx(PRESETS.naturel),
        preset: "naturel",
      };
      await saveTake(this.take);
      if (midiInput) {
        await midiInput.open();
        this.midiInput = midiInput;
        midiInput.addEventListener("midimessage", this.receiveMidi);
        midiInput.addEventListener("statechange", this.midiState);
        this.midiTimer = setInterval(() => this.flushMidi(), 250);
      }
      const before = performance.now();
      const contextTime = this.ctx.currentTime;
      const clockOrigin = (before + performance.now()) / 2 - contextTime * 1000;
      this.node = new AudioWorkletNode(this.ctx, "usb-capture", {
        channelCount: channels,
        channelCountMode: "explicit",
        channelInterpretation: "discrete",
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.source = this.ctx.createMediaStreamSource(new MediaStream([track]));
      this.source.connect(this.node);
      this.node.connect(this.ctx.destination);
      this.node.port.onmessage = (e) => {
        if (Number.isFinite(e.data.startFrame) && this.take?.capture) {
          this.take.capture.audioStartMs =
            clockOrigin + (e.data.startFrame / this.take.rate) * 1000;
          if (this.take.accompaniment)
            this.take.accompaniment.offsetSeconds =
              e.data.startFrame / this.take.rate - (options?.loopOrigin || 0);
          const snapshot = structuredClone(this.take);
          this.queue = this.queue.then(async () => {
            try {
              await saveTake(snapshot);
            } catch (error) {
              this.failure = error as Error;
              this.onInterrupted?.("Horodatage non sauvegardé.");
            }
          });
        }
        if (e.data.pcm) {
          const pcm = e.data.pcm as Float32Array[];
          let peak = 0;
          for (const c of pcm)
            for (const v of c) peak = Math.max(peak, Math.abs(v));
          this.frames += pcm[0].length;
          this.onMeter?.(peak, this.frames / this.take!.rate);
          const chunk = {
            takeId: this.take!.id,
            index: this.index++,
            frames: pcm[0].length,
            channels: pcm.map((c) => c.buffer as ArrayBuffer),
          };
          this.queued++;
          this.queue = this.queue.then(async () => {
            try {
              if (this.failure) return;
              await saveChunk(chunk);
            } catch (e) {
              this.failure = Error(
                "Sauvegarde locale impossible : " + (e as Error).message,
              );
              this.onInterrupted?.(this.failure.message);
            } finally {
              this.queued--;
            }
          });
          if (this.queued > 80 && !this.failure) {
            this.failure = Error(
              "Stockage trop lent. La prise est interrompue pour préserver les blocs déjà écrits.",
            );
            this.onInterrupted?.(this.failure.message);
          }
        }
        if (e.data.done) {
          this.finished = true;
          this.done?.();
        }
        if (e.data.limit)
          this.onInterrupted?.("Durée maximale de la prise atteinte.");
      };
      track.addEventListener("ended", () => {
        if (!this.ending && !this.disposed)
          this.onInterrupted?.("Piano USB déconnecté.");
      });
      track.addEventListener("mute", () => {
        if (!this.ending && !this.disposed)
          this.onInterrupted?.("Entrée USB muette.");
      });
      this.ctx.addEventListener("statechange", this.contextChanged);
      this.node.port.postMessage({
        type: "start",
        maxSeconds: Math.max(30, Math.min(600, options?.maxSeconds || 180)),
      });
      try {
        this.lock = await navigator.wakeLock?.request("screen");
      } catch {
        /* Optional screen lock. */
      }
    } catch (e) {
      this.detachMidi();
      await this.queue;
      try {
        if (this.take) {
          this.take.status = "interrupted";
          this.take.frames = this.frames;
          if (this.take.midi)
            this.take.midi.eventCount = (await readMidi(this.take.id)).length;
          await saveTake(this.take);
        }
      } finally {
        await this.cleanup();
      }
      throw e;
    }
  }
  stop(reason?: string) {
    if (this.ending) return this.ending;
    this.ending = this.finish(reason);
    return this.ending;
  }
  private async finish(reason?: string) {
    if (!this.take) throw Error("Pas de prise active.");
    if (!this.finished)
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 1200);
        this.done = () => {
          clearTimeout(timeout);
          resolve();
        };
        this.node?.port.postMessage("stop");
      });
    this.detachMidi();
    await this.queue;
    const result = {
      ...this.take,
      frames: this.frames,
      status: (reason ||
      this.failure ||
      this.midiFailure ||
      !this.frames ||
      this.take.capture?.audioStartMs === undefined
        ? "interrupted"
        : "ready") as Take["status"],
    };
    // Calculate saved frames after storage failure; never report unsaved chunks as durable.
    if (this.failure) {
      try {
        const pcm = await readPcm(result);
        result.frames = pcm.channels[0].length;
      } catch {
        result.frames = 0;
      }
    }
    try {
      if (result.midi)
        result.midi.eventCount = (await readMidi(result.id)).length;
      await saveTake(result);
    } finally {
      await this.cleanup();
    }
    return result;
  }
  private async cleanup() {
    this.disposed = true;
    this.detachMidi();
    await this.queue;
    this.releaseLock?.();
    this.releaseLock = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    this.ctx?.removeEventListener("statechange", this.contextChanged);
    if (this.ownsContext) await this.ctx?.close().catch(() => {});
    await this.lock?.release().catch(() => {});
  }
}
