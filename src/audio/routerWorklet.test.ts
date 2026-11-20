import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
it("captures separate stereo channels and exact duration while output stays silent, flags missing clock blocks", () => {
  const messages: {
    pcm?: Float32Array[];
    done?: boolean;
    frames?: number;
    gaps?: number;
    firstFrame?: number;
  }[] = [];
  let Processor: new () => {
    port: { onmessage: (event: { data: unknown }) => void };
    process: (input: Float32Array[][], output: Float32Array[][]) => void;
  };
  const scope = {
    AudioWorkletProcessor: class {
      port = {
        postMessage: (data: (typeof messages)[number]) => messages.push(data),
      };
    },
    registerProcessor: (_name: string, ctor: typeof Processor) => {
      Processor = ctor;
    },
    currentFrame: 128,
    sampleRate: 48000,
    Float32Array,
    Math,
  };
  runInNewContext(readFileSync("public/router.worklet.js", "utf8"), scope);
  const node = new Processor!();
  node.port.onmessage({ data: { type: "capture", seconds: 1 } });
  for (let i = 0; i < 375; i++) {
    if (i === 100) scope.currentFrame += 128;
    const output = new Float32Array(128).fill(0.8);
    node.process(
      [[new Float32Array(128).fill(0.2), new Float32Array(128).fill(-0.4)]],
      [[output]],
    );
    expect(output.every((value) => value === 0)).toBe(true);
    scope.currentFrame += 128;
  }
  const chunks = messages
    .filter((message) => message.pcm)
    .map((message) => message.pcm!);
  expect(chunks.reduce((n, channels) => n + channels[0].length, 0)).toBe(48000);
  expect(chunks[0][0][0]).toBeCloseTo(0.2);
  expect(chunks[0][1][0]).toBeCloseTo(-0.4);
  expect(messages.find((message) => message.firstFrame)?.firstFrame).toBe(128);
  expect(messages.find((message) => message.done)).toMatchObject({
    frames: 48000,
    gaps: 1,
  });
});
