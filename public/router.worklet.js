// Input capture terminates in silence. Playback probes are never fed from this node.
class RouteCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.meterFrames = 0;
    this.peak = 0;
    this.port.onmessage = (e) => {
      if (e.data.type === "capture") {
        this.active = true;
        this.frames = 0;
        this.n = 0;
        this.firstFrame = null;
        this.nextFrame = null;
        this.gaps = 0;
        this.limit = Math.round(
          sampleRate * Math.min(60, Math.max(1, e.data.seconds)),
        );
      }
      if (e.data.type === "cancel") {
        this.active = false;
        this.n = 0;
      }
    };
  }
  flush() {
    if (!this.n) return;
    const pcm = this.parts.map((c) => c.slice(0, this.n));
    this.port.postMessage(
      { pcm },
      pcm.map((c) => c.buffer),
    );
    this.n = 0;
  }
  process(inputs, outputs) {
    outputs[0].forEach((c) => c.fill(0));
    const input = inputs[0];
    if (!input?.length) return true;
    for (const c of input)
      for (const v of c) this.peak = Math.max(this.peak, Math.abs(v));
    this.meterFrames += input[0].length;
    if (this.meterFrames >= 4096) {
      this.port.postMessage({ peak: this.peak });
      this.meterFrames = 0;
      this.peak = 0;
    }
    if (!this.active) return true;
    if (this.firstFrame === null) {
      this.firstFrame = currentFrame;
      this.port.postMessage({ firstFrame: currentFrame });
    }
    if (this.nextFrame !== null && currentFrame !== this.nextFrame) this.gaps++;
    this.nextFrame = currentFrame + input[0].length;
    let offset = 0;
    while (offset < input[0].length && this.active) {
      if (!this.n) this.parts = input.map(() => new Float32Array(4096));
      const count = Math.min(
        input[0].length - offset,
        4096 - this.n,
        this.limit - this.frames,
      );
      for (let c = 0; c < input.length; c++)
        this.parts[c].set(input[c].subarray(offset, offset + count), this.n);
      this.n += count;
      this.frames += count;
      offset += count;
      if (this.n === 4096) this.flush();
      if (this.frames === this.limit) {
        this.flush();
        this.active = false;
        this.port.postMessage({
          done: true,
          frames: this.frames,
          gaps: this.gaps,
        });
      }
    }
    return true;
  }
}
registerProcessor("route-capture", RouteCapture);
