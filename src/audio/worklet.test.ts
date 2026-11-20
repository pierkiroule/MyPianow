import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
it("records mono PCM, flushes its final partial block, and emits only silence", () => {
  const messages: { pcm?: Float32Array[]; done?: boolean }[] = [];
  let Constructor: new () => {
    port: { onmessage: (e: { data: string }) => void };
    process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
  };
  runInNewContext(readFileSync("public/capture.worklet.js", "utf8"), {
    AudioWorkletProcessor: class {
      port = {
        postMessage: (v: unknown) =>
          messages.push(v as (typeof messages)[number]),
      };
    },
    registerProcessor: (_n: string, c: typeof Constructor) => {
      Constructor = c;
    },
    sampleRate: 48000,
    Float32Array,
    Math,
  });
  const p = new Constructor!();
  p.port.onmessage({ data: "start" });
  for (let i = 0; i < 33; i++) {
    const out = new Float32Array(128).fill(1);
    p.process([[new Float32Array(128).fill(0.2)]], [[out]]);
    expect(out.every((x) => x === 0)).toBe(true);
  }
  p.port.onmessage({ data: "stop" });
  expect(messages[0].pcm?.length).toBe(1);
  expect(messages[0].pcm?.[0].length).toBe(4096);
  expect(messages[1].pcm?.[0].length).toBe(128);
  expect(messages[2].done).toBe(true);
});
