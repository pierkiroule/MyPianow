import { describe, it, expect, vi } from "vitest";
import { stepTime, newProject, validateProject } from "./types";
import { LoopEngine } from "./LoopEngine";
describe("sample-clock loop scheduling", () => {
  it("applies swing only to offbeats and rejects malformed imported patterns", () => {
    expect(stepTime(0, 120, 0.5)).toBe(0);
    expect(stepTime(1, 120, 0.5)).toBeCloseTo(0.15625);
    expect(stepTime(2, 120, 0.5)).toBe(0.25);
    const project = newProject();
    project.tracks[0].steps = [];
    expect(() => validateProject(project)).toThrow();
  });
  it("schedules on the audio clock, supports pad playback and stops scheduled voices", () => {
    vi.useFakeTimers();
    const project = newProject();
    project.tempo = 120;
    project.tracks[0].assetId = "a";
    project.tracks[0].steps[0] = true;
    const sources: {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    }[] = [];
    const node = () => ({
      type: "",
      frequency: { value: 0 },
      gain: { value: 0 },
      pan: { value: 0 },
      connect: vi.fn(function (this: unknown) {
        return this;
      }),
      disconnect: vi.fn(),
    });
    const ctx = {
      state: "running",
      sampleRate: 48000,
      currentTime: 0,
      destination: node(),
      createBuffer: () => ({ copyToChannel: vi.fn(), duration: 1 }),
      createBiquadFilter: node,
      createGain: node,
      createStereoPanner: node,
      createDynamicsCompressor: () => ({
        ...node(),
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
      }),
      createBufferSource: () => {
        const source = {
          ...node(),
          start: vi.fn(),
          stop: vi.fn(),
          buffer: null,
          onended: null,
        };
        sources.push(source);
        return source;
      },
    };
    const engine = new LoopEngine();
    engine.context = ctx as unknown as AudioContext;
    engine.configure(project, [
      {
        id: "a",
        name: "A",
        rate: 48000,
        frames: 48000,
        channels: [new Float32Array(48000).buffer],
        created: 0,
      },
    ]);
    engine.start();
    expect(sources).toHaveLength(0);
    ctx.currentTime = 0.05;
    vi.advanceTimersByTime(25);
    expect(sources[0].start).toHaveBeenCalledWith(0.15, 0, 1);
    engine.trigger(project.tracks[0].id, 0.1);
    engine.stop();
    expect(sources[0].stop).toHaveBeenLastCalledWith();
    expect(sources.every((source) => source.stop.mock.calls.length > 0)).toBe(
      true,
    );
    vi.useRealTimers();
  });
});
