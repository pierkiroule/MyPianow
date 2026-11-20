import { describe, it, expect } from "vitest";
import { analyzeProbe, referencePcm, makeProbe } from "./routeProbe";
import type { Pcm } from "../lib/types";
function fixture(rate = 48000): Pcm {
  return {
    rate,
    channels: [new Float32Array(rate * 6), new Float32Array(rate * 6)],
  };
}
describe("duplex probe evidence", () => {
  it("finds a delayed, attenuated and polarity-inverted return at two sample rates", async () => {
    for (const rate of [44100, 48000]) {
      const pcm = fixture(rate),
        ref = referencePcm(rate);
      const start = 0.213,
        delay = 0.1473;
      ref.channels.forEach((source, index) =>
        pcm.channels[index].set(
          source.map((value) => -value * 0.22),
          Math.round((start + delay) * rate),
        ),
      );
      const result = await analyzeProbe(pcm, start);
      expect(result.verdict).toBe("returned");
      expect(
        result.hits.every((hit) => Math.abs(hit.delayMs - delay * 1000) < 1),
      ).toBe(true);
      expect(result.hits[0].channel).toBe(0);
      expect(result.hits[1].channel).toBe(1);
    }
  });
  it("does not call silence a validated hardware route", async () => {
    const result = await analyzeProbe(fixture(), 0.2);
    expect(result.verdict).toBe("not-detected");
    expect(result.reason).toContain("Confirme");
  });
  it("handles mono summed loopback and does not change the recording", async () => {
    const rate = 48000,
      reference = referencePcm(rate);
    const mono = new Float32Array(rate * 6);
    reference.channels.forEach((channel) =>
      channel.forEach((value, i) => (mono[i + rate / 2] += value * 0.5)),
    );
    const raw = mono.slice();
    expect((await analyzeProbe({ rate, channels: [mono] }, 0.25)).verdict).toBe(
      "returned",
    );
    expect(mono).toEqual(raw);
  });
  it("rejects a partial match, discontinuity, clipping and a noisy baseline", async () => {
    const pcm = fixture(),
      rate = pcm.rate;
    pcm.channels[0].set(
      makeProbe(rate, 0),
      Math.round((0.2 + 0.35 + 0.1) * rate),
    );
    expect((await analyzeProbe(pcm, 0.2)).verdict).toBe("inconclusive");
    expect((await analyzeProbe(pcm, 0.2, 1)).verdict).toBe("inconclusive");
    pcm.channels[0][0] = 1;
    expect((await analyzeProbe(pcm, 0.2)).verdict).toBe("inconclusive");
    const noise = fixture();
    noise.channels.forEach((c) => c.fill(0.01));
    expect((await analyzeProbe(noise, 0.2)).verdict).toBe("inconclusive");
  });
});
