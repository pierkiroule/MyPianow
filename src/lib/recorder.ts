import { readPcm, saveChunk, saveTake } from "./storage";
import { PRESETS, type Take } from "./types";
export const isUsb = (d: { deviceId: string; label: string }) =>
  d.deviceId !== "default" &&
  !!d.deviceId &&
  /usb/i.test(d.label) &&
  !/midi/i.test(d.label);
export const constraints = (id: string): MediaStreamConstraints => ({
  video: false,
  audio: {
    deviceId: { exact: id },
    channelCount: { ideal: 2 },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
});
export async function audioDevices() {
  if (!navigator.mediaDevices?.enumerateDevices)
    throw Error("Capture audio indisponible. Utilise Chrome en HTTPS.");
  return (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "audioinput" && isUsb(d),
  );
}
export class Recorder {
  private disposed = false;
  private releaseLock?: () => void;
  private stream?: MediaStream;
  private ctx?: AudioContext;
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
  async start(device: MediaDeviceInfo, native?: Take["native"]) {
    if (!isUsb(device)) throw Error("Sélectionne une entrée USB reconnue.");
    try {
      if (navigator.locks)
        await new Promise<void>((resolve, reject) => {
          void navigator.locks
            .request(
              "mypianow-capture",
              { ifAvailable: true },
              async (lock) => {
                if (!lock) {
                  reject(Error("Un autre onglet enregistre déjà."));
                  return;
                }
                await new Promise<void>((release) => {
                  this.releaseLock = release;
                  resolve();
                });
              },
            )
            .catch(reject);
        });
      this.stream = await navigator.mediaDevices.getUserMedia(
        constraints(device.deviceId),
      );
      const track = this.stream.getAudioTracks()[0],
        settings = track.getSettings();
      if (
        track.readyState !== "live" ||
        settings.deviceId !== device.deviceId ||
        !isUsb({ deviceId: settings.deviceId || "", label: track.label })
      )
        throw Error(
          "Source USB non confirmée. Aucun micro de secours ne sera utilisé.",
        );
      this.ctx = new AudioContext({ sampleRate: settings.sampleRate || 48000 });
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
        fx: { ...PRESETS.naturel },
        preset: "naturel",
      };
      await saveTake(this.take);
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
            if (this.failure) return;
            try {
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
        if (e.data.limit) this.onInterrupted?.("Limite de 3 minutes atteinte.");
      };
      track.addEventListener("ended", () => {
        if (!this.ending && !this.disposed)
          this.onInterrupted?.("Piano USB déconnecté.");
      });
      track.addEventListener("mute", () => {
        if (!this.ending && !this.disposed)
          this.onInterrupted?.("Entrée USB muette.");
      });
      this.ctx.addEventListener("statechange", () => {
        if (this.ctx?.state !== "running" && !this.ending && !this.disposed)
          this.onInterrupted?.("Moteur audio suspendu.");
      });
      this.node.port.postMessage("start");
      try {
        this.lock = await navigator.wakeLock?.request("screen");
      } catch {
        /* Optional screen lock. */
      }
    } catch (e) {
      await this.cleanup();
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
    await this.queue;
    await this.cleanup();
    const result = {
      ...this.take,
      frames: this.frames,
      status: (reason || this.failure
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
    await saveTake(result);
    return result;
  }
  private async cleanup() {
    this.disposed = true;
    this.releaseLock?.();
    this.releaseLock = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.node?.disconnect();
    await this.ctx?.close().catch(() => {});
    await this.lock?.release().catch(() => {});
  }
}
