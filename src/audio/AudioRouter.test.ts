import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { AudioRouter } from "./AudioRouter";
class Node extends EventTarget {
  connections: Node[] = [];
  buffer: unknown;
  gain = { value: 0 };
  port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: vi.fn(),
  };
  connect(node: Node) {
    this.connections.push(node);
    return node;
  }
  disconnect() {
    this.connections = [];
  }
  start = vi.fn();
  stop = vi.fn();
}
class Context extends EventTarget {
  static instances: Context[] = [];
  destination = new Node();
  input = new Node();
  bus = new Node();
  playback = new Node();
  sampleRate = 48000;
  currentTime = 1;
  state = "running";
  baseLatency = 0.004;
  outputLatency = 0.012;
  audioWorklet = { addModule: vi.fn(async () => {}) };
  constructor() {
    super();
    Context.instances.push(this);
  }
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.state = "closed";
  });
  createMediaStreamSource() {
    return this.input;
  }
  createGain() {
    return this.bus;
  }
  createBufferSource() {
    return this.playback;
  }
  createBuffer() {
    return { copyToChannel: vi.fn() };
  }
}
class Worklet extends Node {
  static instances: Worklet[] = [];
  constructor() {
    super();
    Worklet.instances.push(this);
  }
}
const device = {
  deviceId: "usb",
  label: "USB audio",
  kind: "audioinput",
} as MediaDeviceInfo;
let track: EventTarget & {
  readyState: string;
  label: string;
  getSettings: () => MediaTrackSettings;
  stop: ReturnType<typeof vi.fn>;
};
let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Context.instances = [];
  Worklet.instances = [];
  track = Object.assign(new EventTarget(), {
    readyState: "live",
    label: "USB audio",
    getSettings: () => ({
      deviceId: "usb",
      channelCount: 2,
      sampleRate: 48000,
    }),
    stop: vi.fn(),
  });
  getUserMedia = vi.fn(async () => ({
    getAudioTracks: () => [track],
    getTracks: () => [track],
  }));
  vi.stubGlobal("navigator", {
    mediaDevices: Object.assign(new EventTarget(), { getUserMedia }),
  });
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("AudioWorkletNode", Worklet);
  vi.stubGlobal(
    "MediaStream",
    class {
      constructor(_tracks: unknown) {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("isolated USB audio routing", () => {
  it("keeps the input on a silent worklet; only an independent source reaches playback bus", async () => {
    const router = new AudioRouter();
    await router.open(device);
    const ctx = Context.instances[0],
      worklet = Worklet.instances[0];
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({ deviceId: { exact: "usb" } }),
      }),
    );
    expect(ctx.input.connections).toEqual([worklet]);
    expect(worklet.connections).toEqual([ctx.destination]);
    expect(ctx.bus.connections).toEqual([ctx.destination]);
    expect(ctx.input.connections).not.toContain(ctx.bus);
    const pending = router.record("duplex");
    const rejected = expect(pending).rejects.toThrow("Diagnostic arrêté");
    worklet.port.onmessage!({ data: { firstFrame: 48000 } });
    expect(ctx.playback.connections).toEqual([ctx.bus]);
    expect(ctx.playback.start).toHaveBeenCalledWith(1.2);
    await router.close();
    await rejected;
    expect(track.stop).toHaveBeenCalled();
    expect(ctx.playback.stop).toHaveBeenCalled();
    expect(ctx.input.connections).toEqual([]);
  });
  it("assembles a USB-only clip and keeps it separate from the probe reference", async () => {
    const router = new AudioRouter();
    await router.open(device);
    const node = Worklet.instances[0],
      promise = router.record("piano");
    node.port.onmessage!({ data: { firstFrame: 48000 } });
    node.port.onmessage!({
      data: {
        pcm: [new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])],
      },
    });
    node.port.onmessage!({ data: { done: true, frames: 2, gaps: 0 } });
    const clip = await promise;
    expect(clip.reference).toBeUndefined();
    expect(clip.pcm.channels[1][1]).toBeCloseTo(0.4);
    await router.close();
  });
  it("refuses a substituted internal source and an unsupported explicit output without fallback", async () => {
    track.getSettings = () => ({ deviceId: "internal" });
    await expect(new AudioRouter().open(device)).rejects.toThrow(
      "Source USB non confirmée",
    );
    expect(track.stop).toHaveBeenCalled();
    track.getSettings = () => ({ deviceId: "usb", channelCount: 1 });
    await expect(
      new AudioRouter().open(device, "unavailable-output"),
    ).rejects.toThrow("Android choisir");
    expect(Context.instances.every((ctx) => ctx.state === "closed")).toBe(true);
  });
  it("stops on device changes and ignores late worklet callbacks", async () => {
    const router = new AudioRouter(),
      fault = vi.fn(),
      meter = vi.fn();
    router.onFault = fault;
    router.onMeter = meter;
    await router.open(device);
    const receive = Worklet.instances[0].port.onmessage!;
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
    expect(fault).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    receive({ data: { peak: 0.8 } });
    expect(meter).not.toHaveBeenCalled();
    await router.close();
  });
});
